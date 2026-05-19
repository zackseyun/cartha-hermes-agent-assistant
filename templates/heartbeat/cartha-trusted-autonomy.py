#!/usr/bin/env python3
"""Trusted Autonomy Mode for the local Cartha Agent.

This is intentionally not a permission bypass. It is a standing-authorization
executor for task classes Zack has approved: inspect repos, edit files, run
tests/builds, commit, and ordinary non-force pushes inside known local roots.

The runner uses a small model loop:
  observe task/context -> request one JSON action -> execute guarded shell -> repeat

It stops when the task is completed, blocked by a safety guard, or it needs
explicit human approval for irreversible / high-risk operations.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

# Python 3.11 added datetime.UTC. The launcher on this Mac can run under
# Xcode's Python 3.9, so keep an explicit compatibility alias.
UTC = timezone.utc
from pathlib import Path
from typing import Any

HOME = Path.home()
HERMES_HOME = Path(os.environ.get("HERMES_HOME", str(HOME / ".hermes"))).expanduser()
SCRIPT_DIR = Path(__file__).resolve().parent
POLICY_PATH = HERMES_HOME / "heartbeat-config" / "policy.json"
ENV_FILE = HERMES_HOME / ".env"
LOG_PATH = HERMES_HOME / "logs" / "cartha-autonomy.log"
RUNS_DIR = HERMES_HOME / "autonomy-runs"
RUNTIME_EVENT_PY = SCRIPT_DIR / "hermes-runtime-event.py"

OLLAMA_URL = os.environ.get("CARTHA_AUTONOMY_OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

DEFAULT_ALLOWED_ROOTS = [
    str(HOME / ".hermes" / "scripts"),
    str(HOME / ".hermes" / "hermes-agent"),
    str(HOME / "Documents" / "GitHub"),
    str(HOME / "My Drive" / "Moltbot-Shared" / "Documents" / "GitHub"),
]

DEFAULT_MODEL = os.environ.get("CARTHA_AUTONOMY_MODEL", "deepseek/deepseek-v4-flash")
DEFAULT_LOCAL_MODEL = os.environ.get("HEARTBEAT_MODEL", "qwen3.6:35b-hermes-256k")

MAX_OBSERVATION_CHARS = 9000
MAX_OUTPUT_CHARS = 12000


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def log(line: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(f"{now()} {line.rstrip()}\n")


def lifecycle_event_paths(run_id: str, runs_dir: Path = RUNS_DIR) -> tuple[Path, Path]:
    return runs_dir / f"{run_id}.events.jsonl", runs_dir / "events.jsonl"


def emit_lifecycle_event(
    run_id: str,
    event: str,
    payload: Any = None,
    *,
    runs_dir: Path = RUNS_DIR,
) -> dict[str, Any]:
    """Append a durable lifecycle event to the per-run and global JSONL logs.

    These hooks are intentionally best-effort: event persistence should make
    interrupted autonomy runs inspectable, but should not become another reason
    a safe task fails.
    """
    record: dict[str, Any] = {
        "ts": now(),
        "run_id": run_id,
        "event": event,
    }
    if payload:
        record.update(payload)

    try:
        runs_dir.mkdir(parents=True, exist_ok=True)
        line = json.dumps(record, ensure_ascii=False, default=str)
        for path in lifecycle_event_paths(run_id, runs_dir):
            with path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
                f.flush()
                os.fsync(f.fileno())
    except Exception as exc:
        try:
            log(f"lifecycle event write failed run_id={run_id} event={event}: {exc}")
        except Exception:
            pass
    return record


def emit_runtime_event(
    runtime_task_id: str,
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    status: str = "",
    title: str = "",
    run_id: str = "",
    item_id: str = "",
) -> None:
    """Mirror autonomy lifecycle into the cross-run Hermes task ledger."""
    task_id = str(runtime_task_id or "").strip()
    if not task_id or not RUNTIME_EVENT_PY.exists():
        return
    try:
        subprocess.run(
            [
                sys.executable,
                str(RUNTIME_EVENT_PY),
                "event",
                "--task-id", task_id,
                "--type", event_type,
                "--status", status,
                "--title", title[:220],
                "--payload-json", json.dumps(payload or {}, ensure_ascii=False),
                "--run-id", run_id,
                "--item-id", item_id,
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception as exc:
        log(f"runtime event failed task_id={task_id} type={event_type}: {exc}")


def finish_runtime_task(
    runtime_task_id: str,
    *,
    status: str,
    summary: str,
    details: str,
    next_steps: list[str],
    artifact_path: Path,
    run_id: str,
) -> None:
    task_id = str(runtime_task_id or "").strip()
    if not task_id or not RUNTIME_EVENT_PY.exists():
        return
    try:
        subprocess.run(
            [
                sys.executable,
                str(RUNTIME_EVENT_PY),
                "finish-task",
                "--task-id", task_id,
                "--status", status,
                "--summary", summary[:1200],
                "--details", details[:4000],
                "--next-steps-json", json.dumps(next_steps[:8], ensure_ascii=False),
                "--artifact-path", str(artifact_path),
                "--run-id", run_id,
                "--title", "Trusted Autonomy finished",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception as exc:
        log(f"runtime finish failed task_id={task_id} run_id={run_id}: {exc}")


def load_policy() -> dict[str, Any]:
    try:
        return json.loads(POLICY_PATH.read_text())
    except Exception:
        return {}


def load_dotenv_key(key: str) -> str | None:
    if not ENV_FILE.exists():
        return None
    try:
        for raw in ENV_FILE.read_text().splitlines():
            raw = raw.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            k, _, v = raw.partition("=")
            if k.strip() == key:
                return v.strip().strip('"').strip("'")
    except Exception:
        return None
    return None


def allowed_roots_from_policy(policy: dict[str, Any]) -> list[Path]:
    cfg = policy.get("trusted_autonomy") if isinstance(policy.get("trusted_autonomy"), dict) else {}
    roots = cfg.get("allowed_roots") or DEFAULT_ALLOWED_ROOTS
    out: list[Path] = []
    for raw in roots:
        try:
            p = Path(os.path.expandvars(os.path.expanduser(str(raw)))).resolve()
            if p.exists():
                out.append(p)
        except Exception:
            continue
    # Always allow the scripts checkout so the agent can maintain itself.
    scripts = SCRIPT_DIR.resolve()
    if scripts not in out:
        out.insert(0, scripts)
    return out


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except Exception:
        return False


def validate_cwd(cwd: str | None, roots: list[Path]) -> tuple[bool, Path, str]:
    base = Path(cwd or str(SCRIPT_DIR)).expanduser()
    if not base.is_absolute():
        base = (SCRIPT_DIR / base)
    try:
        resolved = base.resolve()
    except Exception as exc:
        return False, SCRIPT_DIR, f"invalid cwd: {exc}"
    if not resolved.exists():
        return False, resolved, "cwd does not exist"
    if not any(is_relative_to(resolved, root) for root in roots):
        root_list = ", ".join(str(r) for r in roots)
        return False, resolved, f"cwd is outside trusted roots ({root_list})"
    return True, resolved, "ok"


BLOCK_PATTERNS = [
    (r"\bsudo\b", "sudo is outside standing authorization"),
    (r"\bsu\s+-", "switching users is outside standing authorization"),
    (r"\brm\s+(-[^\s]*[rf][^\s]*|-[^\s]*[fr][^\s]*)\s+(/|~|\$HOME|\.{1,2})(\s|$)", "dangerous recursive delete"),
    (r"\bfind\s+/(?:\s|.)*-delete\b", "root filesystem delete"),
    (r"\bdd\s+if=", "raw disk writes are blocked"),
    (r"\bmkfs\b|\bdiskutil\s+(erase|partition|apfs\s+delete)", "disk erase/partition is blocked"),
    (r"\bshutdown\b|\breboot\b|\bhalt\b", "power actions are blocked"),
    (r"\bsecurity\s+(find|dump|export|unlock|set-key|delete-key)", "keychain/secret extraction is blocked"),
    (r"(\bcat\b|\bless\b|\bgrep\b|\brg\b).*(~/.ssh|~/.gnupg|~/.aws/credentials|~/.hermes/.env|OPENROUTER_API_KEY|API_KEY|TOKEN|SECRET)", "secret reads are blocked"),
    (r"\b(printenv|env)\b(?!\s+[A-Za-z_][A-Za-z0-9_]*=)", "dumping full environment is blocked"),
    (r"\bcurl\b.*\|\s*(sh|bash|zsh)\b", "curl-piped shell is blocked"),
    (r"\bchmod\s+-R\s+777\b", "unsafe permission broadening is blocked"),
    (r"\bgit\s+push\b.*(--force|-f|--mirror)", "force push is blocked"),
    (r"\bgit\s+reset\s+--hard\b", "hard reset is blocked"),
    (r"\bgit\s+clean\b.*-[^\s]*[xfd]", "destructive git clean is blocked"),
]

APPROVAL_PATTERNS = [
    (r"\bnpm\s+publish\b|\byarn\s+npm\s+publish\b|\bpnpm\s+publish\b", "package publishing needs approval"),
    (r"\bfastlane\s+deliver\b|\beas\s+submit\b|\bapp-store-connect\b", "store submission needs approval"),
    (r"\bterraform\s+(apply|destroy)\b", "infrastructure mutation needs approval"),
    (r"\bkubectl\s+(delete|apply|scale|rollout)\b", "cluster mutation needs approval"),
    (r"\baws\b.*\b(delete|terminate|put-|update-|create-)\b", "AWS mutation needs approval"),
    (r"\b(drop|truncate)\s+(database|table)\b", "database destructive operation needs approval"),
]


@dataclass
class GuardResult:
    ok: bool
    decision: str
    reason: str
    cwd: Path | None = None


def guard_command(command: str, cwd: str | None, roots: list[Path], timeout: int) -> GuardResult:
    stripped = (command or "").strip()
    if not stripped:
        return GuardResult(False, "blocked", "empty command")
    if "\0" in stripped:
        return GuardResult(False, "blocked", "NUL byte in command")
    if len(stripped) > 5000:
        return GuardResult(False, "blocked", "command too long")
    if timeout > 900:
        return GuardResult(False, "needs_approval", "timeout above 15 minutes needs approval")
    ok, resolved, reason = validate_cwd(cwd, roots)
    if not ok:
        return GuardResult(False, "blocked", reason, resolved)
    lower = stripped.lower()
    for pattern, why in BLOCK_PATTERNS:
        if re.search(pattern, stripped, re.IGNORECASE | re.DOTALL):
            return GuardResult(False, "blocked", why, resolved)
    for pattern, why in APPROVAL_PATTERNS:
        if re.search(pattern, lower, re.IGNORECASE | re.DOTALL):
            return GuardResult(False, "needs_approval", why, resolved)
    return GuardResult(True, "allowed", "allowed by trusted autonomy policy", resolved)


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 300] + f"\n\n…[truncated {len(text) - limit + 300} chars]…\n" + text[-250:]


def run_shell(command: str, cwd: Path, timeout: int) -> dict[str, Any]:
    started = time.time()
    try:
        result = subprocess.run(
            ["/bin/zsh", "-lc", command],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=safe_env(),
        )
        elapsed = time.time() - started
        return {
            "ok": result.returncode == 0,
            "returncode": result.returncode,
            "elapsed_seconds": round(elapsed, 2),
            "stdout": truncate(result.stdout or "", MAX_OUTPUT_CHARS // 2),
            "stderr": truncate(result.stderr or "", MAX_OUTPUT_CHARS // 2),
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "returncode": 124,
            "elapsed_seconds": timeout,
            "stdout": truncate(exc.stdout or "", MAX_OUTPUT_CHARS // 2) if isinstance(exc.stdout, str) else "",
            "stderr": f"timed out after {timeout}s",
        }
    except Exception as exc:
        return {
            "ok": False,
            "returncode": 1,
            "elapsed_seconds": round(time.time() - started, 2),
            "stdout": "",
            "stderr": str(exc),
        }


def safe_env() -> dict[str, str]:
    """Preserve enough PATH/runtime context without dumping secrets to children."""
    allowed = {
        "HOME", "PATH", "SHELL", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "SSH_AUTH_SOCK",
        "HERMES_HOME", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL",
        "ANDROID_HOME", "JAVA_HOME", "FLUTTER_ROOT",
    }
    env = {k: v for k, v in os.environ.items() if k in allowed}
    env.setdefault("HOME", str(HOME))
    env.setdefault("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
    env.setdefault("HERMES_HOME", str(HERMES_HOME))
    return env


SYSTEM_PROMPT = """You are Cartha Agent Trusted Autonomy Mode.

Your job is to accomplish Zack's explicit task, not merely discuss it.
Work in a loop: inspect, edit, run tests/verification, commit/push when that is the expected finish state, then return a concise result.

Standing authorization:
- You may inspect and modify files inside trusted local roots.
- You may run tests, linters, builds, app-specific smoke checks, git status/diff/add/commit, and ordinary non-force git push.
- You may use established local scripts in trusted roots.

Hard limits:
- Do not read secrets, tokens, private keys, or full environment dumps.
- Do not use sudo, force push, hard reset, recursive deletes of broad paths, package publishing, store submission, cloud/infrastructure mutation, database destructive operations, or anything irreversible.
- If the next useful step hits a hard limit, return status "needs_approval" with the exact approval needed.
- If blocked by missing credentials/tooling or unclear intent, return status "blocked" with the blocker.

Respond with STRICT JSON only. No Markdown fences.
Allowed actions:
1) {"action":"shell","cwd":"/absolute/trusted/path","command":"...","timeout_seconds":120,"reason":"why this advances the task"}
2) {"action":"respond","status":"completed|partial|blocked|needs_approval","summary":"short answer to Zack","details":"what you did / found","next_steps":["..."]}

Pick exactly one action each turn. Prefer shell while useful work remains. Only respond completed after verification or a concrete blocker."""


def build_user_prompt(task: str, source: str, context: str, observations: list[dict[str, Any]], roots: list[Path]) -> str:
    obs = json.dumps(observations[-8:], indent=2)
    return f"""TASK FROM ZACK:
{task}

SOURCE: {source}

TRUSTED ROOTS:
{chr(10).join("- " + str(r) for r in roots)}

HEARTBEAT CONTEXT (may be stale, use only when relevant):
{truncate(context or "(none)", 6000)}

RECENT OBSERVATIONS:
{truncate(obs, MAX_OBSERVATION_CHARS)}

Choose the next JSON action."""


def parse_json_action(raw: str) -> dict[str, Any]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{(?:.|\n)*\}", raw)
        if not match:
            raise
        obj = json.loads(match.group(0))
    if not isinstance(obj, dict):
        raise ValueError("model returned non-object JSON")
    return obj


def call_openrouter(system: str, user: str, max_tokens: int = 900, timeout: int = 90) -> str | None:
    key = os.environ.get("OPENROUTER_API_KEY") or load_dotenv_key("OPENROUTER_API_KEY")
    if not key:
        return None
    body = {
        "model": DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.05,
        "max_tokens": max_tokens,
    }
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://hermes.local/trusted-autonomy",
            "X-Title": "Cartha Agent Trusted Autonomy",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
        return data["choices"][0]["message"]["content"]
    except Exception as exc:
        log(f"openrouter failed: {exc}")
        return None


def local_model_candidates() -> list[str]:
    """Return local planner models to try, strongest/preferred first.

    Ollama returns HTTP 404 when a configured model tag is stale. Keep a
    short compatibility chain so Trusted Autonomy does not fail just because a
    local model was renamed or replaced.
    """
    raw_models = [
        os.environ.get("CARTHA_AUTONOMY_LOCAL_MODEL"),
        os.environ.get("HEARTBEAT_MODEL"),
        os.environ.get("CARTHA_AUTONOMY_LOCAL_MODELS"),
        DEFAULT_LOCAL_MODEL,
        "qwen3.6:35b-hermes-256k",
        "gemma4:31b-hermes",
        "gemma4:31b",
        "llama3.1:8b",
    ]
    out: list[str] = []
    for raw in raw_models:
        if not raw:
            continue
        for model in str(raw).split(","):
            model = model.strip()
            if model and model not in out:
                out.append(model)
    return out


def call_ollama(system: str, user: str, timeout: int = 180) -> str:
    last_error: Exception | None = None
    for model in local_model_candidates():
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "think": False,
            "keep_alive": os.environ.get("HEARTBEAT_KEEP_ALIVE", "15m"),
            "options": {"temperature": 0.0, "num_predict": 900},
        }
        req = urllib.request.Request(
            OLLAMA_URL,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read())
            if model != local_model_candidates()[0]:
                log(f"ollama fallback model used: {model}")
            return data.get("message", {}).get("content", "")
        except Exception as exc:
            last_error = exc
            log(f"ollama model {model!r} failed: {exc}")
            continue
    if last_error is not None:
        raise last_error
    raise RuntimeError("no local Ollama models configured")


def call_planner(task: str, source: str, context: str, observations: list[dict[str, Any]], roots: list[Path]) -> dict[str, Any]:
    user = build_user_prompt(task, source, context, observations, roots)
    raw = call_openrouter(SYSTEM_PROMPT, user)
    provider = "openrouter"
    if raw is None:
        provider = "ollama"
        raw = call_ollama(SYSTEM_PROMPT, user)
    log(f"planner provider={provider} raw={truncate(raw, 1200)!r}")
    return parse_json_action(raw)


def default_policy_cfg(policy: dict[str, Any]) -> dict[str, Any]:
    cfg = policy.get("trusted_autonomy") if isinstance(policy.get("trusted_autonomy"), dict) else {}
    return {
        "enabled": bool(cfg.get("enabled", False)),
        "max_steps": int(cfg.get("max_steps", 10)),
        "default_timeout_seconds": int(cfg.get("default_timeout_seconds", 120)),
        "max_total_seconds": int(cfg.get("max_total_seconds", 900)),
    }


def run_autonomy(task: str, source: str, context: str, policy: dict[str, Any], runtime_task_id: str = "") -> dict[str, Any]:
    cfg = default_policy_cfg(policy)
    roots = allowed_roots_from_policy(policy)
    run_id = f"auto-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:6]}"
    artifact_path = RUNS_DIR / f"{run_id}.json"
    events_path, global_events_path = lifecycle_event_paths(run_id)
    started = time.time()
    observations: list[dict[str, Any]] = [{
        "type": "start",
        "task": task,
        "source": source,
        "run_id": run_id,
        "runtime_task_id": runtime_task_id,
    }]
    status = "blocked"
    summary = "Trusted Autonomy did not finish."
    details = ""
    next_steps: list[str] = []

    log(f"run start id={run_id} source={source} task={task!r}")
    emit_lifecycle_event(run_id, "run_start", {
        "source": source,
        "task": task,
        "runtime_task_id": runtime_task_id,
        "artifact_path": str(artifact_path),
        "events_path": str(events_path),
        "global_events_path": str(global_events_path),
    })
    emit_runtime_event(runtime_task_id, "turn.started", {
        "source": source,
        "task": task,
        "artifact_path": str(artifact_path),
        "autonomy_events_path": str(events_path),
    }, status="running", title="Trusted Autonomy started", run_id=run_id)
    try:
        for step in range(1, cfg["max_steps"] + 1):
            if time.time() - started > cfg["max_total_seconds"]:
                status = "partial"
                summary = "I stopped because the trusted-autonomy time budget was reached."
                details = f"Run {run_id} reached {cfg['max_total_seconds']}s."
                next_steps = ["Ask me to continue if you want me to keep going."]
                break
            try:
                action = call_planner(task, source, context, observations, roots)
            except Exception as exc:
                status = "blocked"
                summary = "Trusted Autonomy could not plan the next step."
                details = str(exc)
                next_steps = ["I can fall back to a normal Cartha Agent answer."]
                observations.append({"type": "planner_error", "error": str(exc)})
                break

            action_name = str(action.get("action") or "").lower()
            observations.append({"type": "model_action", "step": step, "action": action})
            emit_lifecycle_event(run_id, "planner_action", {
                "step": step,
                "action": action_name,
                "planner": action,
            })
            emit_runtime_event(runtime_task_id, "planner.action", {
                "step": step,
                "action": action_name,
                "planner": action,
            }, status="running", title=f"Planner chose {action_name or 'unknown'}", run_id=run_id, item_id=f"{run_id}:planner:{step}")
            if action_name == "respond":
                status = str(action.get("status") or "completed")
                summary = str(action.get("summary") or "(no summary)")[:1200]
                details = str(action.get("details") or "")
                raw_next = action.get("next_steps") or []
                next_steps = raw_next if isinstance(raw_next, list) else [str(raw_next)]
                emit_runtime_event(runtime_task_id, "agent.response", {
                    "step": step,
                    "status": status,
                    "summary": summary,
                    "details": details,
                    "next_steps": next_steps,
                }, status=status, title=summary, run_id=run_id, item_id=f"{run_id}:response:{step}")
                break

            if action_name != "shell":
                status = "blocked"
                summary = f"Trusted Autonomy returned an unsupported action: {action_name or '(empty)'}."
                details = json.dumps(action)[:1200]
                next_steps = ["Try again with a more concrete task."]
                emit_runtime_event(runtime_task_id, "agent.blocked", {
                    "step": step,
                    "reason": "unsupported_action",
                    "action": action,
                }, status=status, title=summary, run_id=run_id, item_id=f"{run_id}:blocked:{step}")
                break

            command = str(action.get("command") or "")
            cwd_raw = str(action.get("cwd") or str(SCRIPT_DIR))
            timeout = int(action.get("timeout_seconds") or cfg["default_timeout_seconds"])
            guard = guard_command(command, cwd_raw, roots, timeout)
            if not guard.ok:
                status = guard.decision
                summary = f"I stopped before a risky or unauthorized step: {guard.reason}."
                details = f"Command was: {command[:500]}"
                next_steps = ["Reply with explicit approval or a safer narrower task if you want me to continue."]
                observations.append({
                    "type": "guard_stop",
                    "decision": guard.decision,
                    "reason": guard.reason,
                    "command": command,
                    "cwd": str(guard.cwd or cwd_raw),
                })
                emit_lifecycle_event(run_id, "guard_stop", {
                    "step": step,
                    "decision": guard.decision,
                    "reason": guard.reason,
                    "command": command,
                    "cwd": str(guard.cwd or cwd_raw),
                })
                emit_runtime_event(runtime_task_id, "guard.stopped", {
                    "step": step,
                    "decision": guard.decision,
                    "reason": guard.reason,
                    "command": command,
                    "cwd": str(guard.cwd or cwd_raw),
                }, status=guard.decision, title=guard.reason, run_id=run_id, item_id=f"{run_id}:guard:{step}")
                break

            emit_lifecycle_event(run_id, "shell_start", {
                "step": step,
                "cwd": str(guard.cwd),
                "command": command,
                "timeout_seconds": timeout,
                "reason": str(action.get("reason") or ""),
            })
            emit_runtime_event(runtime_task_id, "command.started", {
                "step": step,
                "cwd": str(guard.cwd),
                "command": command,
                "timeout_seconds": timeout,
                "reason": str(action.get("reason") or ""),
            }, status="running", title=truncate(command, 160), run_id=run_id, item_id=f"{run_id}:command:{step}")
            result = run_shell(command, guard.cwd or SCRIPT_DIR, timeout)
            emit_lifecycle_event(run_id, "shell_end", {
                "step": step,
                "cwd": str(guard.cwd),
                "command": command,
                "ok": bool(result.get("ok")),
                "returncode": result.get("returncode"),
                "elapsed_seconds": result.get("elapsed_seconds"),
                "stdout": truncate(str(result.get("stdout") or ""), 1000),
                "stderr": truncate(str(result.get("stderr") or ""), 1000),
            })
            emit_runtime_event(runtime_task_id, "command.completed" if result.get("ok") else "command.failed", {
                "step": step,
                "cwd": str(guard.cwd),
                "command": command,
                "ok": bool(result.get("ok")),
                "returncode": result.get("returncode"),
                "elapsed_seconds": result.get("elapsed_seconds"),
                "stdout": truncate(str(result.get("stdout") or ""), 1000),
                "stderr": truncate(str(result.get("stderr") or ""), 1000),
            }, status="running", title=truncate(command, 160), run_id=run_id, item_id=f"{run_id}:command:{step}")
            observations.append({
                "type": "shell_result",
                "step": step,
                "cwd": str(guard.cwd),
                "command": command,
                **result,
            })
        else:
            status = "partial"
            summary = "I reached the trusted-autonomy step limit before fully finishing."
            details = f"Run {run_id} used {cfg['max_steps']} steps."
            next_steps = ["Ask me to continue and I will pick up from the current state."]
    finally:
        RUNS_DIR.mkdir(parents=True, exist_ok=True)
        artifact = {
            "run_id": run_id,
            "task": task,
            "source": source,
            "status": status,
            "summary": summary,
            "details": details,
            "next_steps": next_steps,
            "elapsed_seconds": round(time.time() - started, 2),
            "artifact_path": str(artifact_path),
            "events_path": str(events_path),
            "global_events_path": str(global_events_path),
            "observations": observations,
        }
        artifact_path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
        emit_lifecycle_event(run_id, "run_artifact_path", {
            "artifact_path": str(artifact_path),
            "events_path": str(events_path),
            "global_events_path": str(global_events_path),
            "status": status,
        })
        emit_runtime_event(runtime_task_id, "artifact.written", {
            "artifact_path": str(artifact_path),
            "autonomy_events_path": str(events_path),
            "global_autonomy_events_path": str(global_events_path),
            "status": status,
        }, status=status, title="Run artifact written", run_id=run_id, item_id=f"{run_id}:artifact")
        emit_lifecycle_event(run_id, "final_response", {
            "status": status,
            "summary": summary,
            "details": details,
            "next_steps": next_steps,
            "artifact_path": str(artifact_path),
            "events_path": str(events_path),
        })
        finish_runtime_task(
            runtime_task_id,
            status=status,
            summary=summary,
            details=details,
            next_steps=next_steps,
            artifact_path=artifact_path,
            run_id=run_id,
        )
        log(f"run end id={run_id} status={status} summary={summary!r}")
    return artifact


def self_test() -> int:
    roots = [SCRIPT_DIR.resolve()]
    ok, cwd, reason = validate_cwd(str(SCRIPT_DIR), roots)
    assert ok, reason
    assert guard_command("git status --short", str(SCRIPT_DIR), roots, 30).ok
    assert not guard_command("sudo rm -rf /", str(SCRIPT_DIR), roots, 30).ok
    assert guard_command("npm publish", str(SCRIPT_DIR), roots, 30).decision == "needs_approval"
    assert guard_command("git push --force origin main", str(SCRIPT_DIR), roots, 30).decision == "blocked"
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        event = emit_lifecycle_event("self-test", "planner_action", {"step": 1}, runs_dir=tmp_dir)
        per_run, global_log = lifecycle_event_paths("self-test", tmp_dir)
        assert event["event"] == "planner_action"
        assert per_run.exists(), per_run
        assert global_log.exists(), global_log
        assert json.loads(per_run.read_text().splitlines()[-1])["event"] == "planner_action"
    print("trusted autonomy self-test ok")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", default="")
    parser.add_argument("--source", default="unknown")
    parser.add_argument("--context", default="")
    parser.add_argument("--context-file", default="")
    parser.add_argument("--runtime-task-id", default="")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()

    task = args.task.strip()
    if not task and not sys.stdin.isatty():
        task = sys.stdin.read().strip()
    if not task:
        print(json.dumps({"status": "blocked", "summary": "No task text provided."}))
        return 2

    context = args.context
    if args.context_file:
        try:
            context = Path(args.context_file).read_text(encoding="utf-8")
        except Exception as exc:
            context = f"(could not read context file: {exc})"

    policy = load_policy()
    result = run_autonomy(task, args.source, context, policy, args.runtime_task_id)
    print(json.dumps(result))
    return 0 if result.get("status") in {"completed", "partial", "blocked", "needs_approval"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
