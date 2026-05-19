#!/usr/bin/env python3
"""
Cartha Agent heartbeat — Phase 2 (system custodian with deepseek concurrence).

Local model (qwen3.6:35b-hermes-256k) reads activity + OpenClaw context + pending jobs + a
system snapshot (memory, top processes, cleanup-target sizes) and picks ONE tool:

  noop                  nothing actionable
  journal_entry         record a one-line note
  notify_user           transient Cartha Agent bubble
  show_visual           chart/status visual in the Cartha Agent bubble
  mark_job_done         a pending agent-sync job clearly finished
  escalate              urgent / ambiguous — hand off to deepseek-v4-flash
  propose_quit_app      ask deepseek for concurrence, then quit if approved + on allowlist
  propose_cleanup       ask deepseek for concurrence, then run a cleanup action

All destructive actions (quit + cleanup) go through deepseek-v4-flash for a second
opinion in Phase 2. In Phase 3 the second opinion is skipped for allowlisted
quits and enabled cleanup actions (still skipped for unknown targets).

Reads context as JSON on stdin:
  {"activity": "...", "context": "...", "pending": "...", "system": "..."}

Policy: ~/.hermes/heartbeat-config/policy.json
Journal: ~/.hermes/heartbeat-journal.md
Log:     /tmp/hermes-heartbeat.log
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

HOME = Path.home()
JOURNAL = HOME / ".hermes" / "heartbeat-journal.md"
POLICY_PATH = HOME / ".hermes" / "heartbeat-config" / "policy.json"
ENV_FILE = HOME / ".hermes" / ".env"
CLEANUP_SH = HOME / ".hermes" / "scripts" / "heartbeat-cleanup.sh"
BUBBLE_BIN = HOME / ".hermes" / "scripts" / "hermes-bubble" / "hermes-bubble"
VISUAL_RENDERER = HOME / ".hermes" / "scripts" / "cartha-visual.py"
IOS_TESTFLIGHT_SH = HOME / ".hermes" / "scripts" / "cartha-ios-testflight.sh"
TRUSTED_AUTONOMY_SH = HOME / ".hermes" / "scripts" / "cartha-trusted-autonomy.py"
IMSG_SH = HOME / "scripts" / "imsg.sh"
REPLIES_FILE = HOME / ".hermes" / "heartbeat-replies.jsonl"

def _load_env_keys_from_dotenv(path: Path, prefix: str = "HEARTBEAT_") -> None:
    """Load HEARTBEAT_* keys from ~/.hermes/.env into os.environ so cron-launched
    runs can pick up config from .env without bash sourcing (which breaks on
    values that contain unquoted spaces like MESSAGING_CWD).
    """
    if not path.exists():
        return
    try:
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if not key.startswith(prefix):
                continue
            if key in os.environ:
                continue  # don't clobber an explicit override
            os.environ[key] = value.strip().strip('"').strip("'")
    except Exception:
        pass


_load_env_keys_from_dotenv(ENV_FILE)

AFK_THRESHOLD_SECS = int(os.environ.get("HEARTBEAT_AFK_THRESHOLD", "300"))  # 5 min default
IMSG_TARGET = os.environ.get("HEARTBEAT_IMSG_TARGET", "")  # phone (+1...) or email handle; empty = skip

MODEL = os.environ.get("HEARTBEAT_MODEL", "qwen3.6:35b-hermes-256k")
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
KEEP_ALIVE = os.environ.get("HEARTBEAT_KEEP_ALIVE", "15m")
PHASE_OVERRIDE = os.environ.get("HEARTBEAT_PHASE")  # "1", "2", or "3"

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
ESCALATION_MODEL = os.environ.get("HEARTBEAT_ESCALATION_MODEL", "deepseek/deepseek-v4-flash")

# Local SearXNG instance for web_search tool. See ~/.hermes/searxng/settings.yml.
SEARXNG_URL = os.environ.get("HEARTBEAT_SEARXNG_URL", "http://127.0.0.1:8888")

# ms-365-mcp-server binary for read_calendar_today / read_mail_recent tools.
# We spawn the server in stdio mode per call (resilient — no long-running
# socket, no OAuth client plumbing, reuses MSAL cache from prior --login).
MS365_MCP_NODE = os.environ.get("HEARTBEAT_NODE_BIN", "/opt/homebrew/bin/node")
MS365_MCP_JS = os.environ.get(
    "HEARTBEAT_MS365_MCP_JS",
    str(HOME / ".npm-global" / "lib" / "node_modules" / "@softeria" / "ms-365-mcp-server" / "dist" / "index.js"),
)

# Pre-deepseek dedup: how many recent escalations to compare against before
# allowing another deepseek call on the same situation.
DEDUP_LOOKBACK_N = int(os.environ.get("HEARTBEAT_DEDUP_LOOKBACK", "10"))


# ---------- helpers ----------

def ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def journal_append(line: str) -> None:
    JOURNAL.parent.mkdir(parents=True, exist_ok=True)
    with JOURNAL.open("a") as f:
        f.write(line.rstrip() + "\n")


def normalize_reason(s: str) -> str:
    """Stable fingerprint of an escalation reason — strip timestamps/dates so
    semantically identical reasons match for dedup. Used by the pre-deepseek
    check to avoid burning cloud calls on the same situation tick after tick."""
    s = (s or "").lower()
    s = re.sub(r"\d{1,2}:\d{2}(:\d{2})?", "", s)  # times like 11:18
    s = re.sub(r"20\d{2}-\d{2}-\d{2}", "", s)  # dates like 2026-05-15
    s = re.sub(r"\d+\s*(min|minute|hour|second|sec|h|m|s)s?\b", "", s)
    s = re.sub(r"\W+", " ", s).strip()
    return s[:120]


def recent_escalation_reasons(n: int = 10) -> list[str]:
    """Read the last n [ESCALATE urgency=...] reasons from the journal so we
    can dedup near-identical escalations before hitting deepseek."""
    try:
        text = JOURNAL.read_text()
    except Exception:
        return []
    # Match both [ESCALATE urgency=low] and [ESCALATE-FALLBACK urgency=low]
    matches = re.findall(r"\[ESCALATE(?:-FALLBACK|-SKIPPED-DEDUP)?\s+urgency=\w+\]\s*(.+?)(?:\n|$)", text)
    return matches[-n:]


# ---------- safe shell + url + search backends for new local tools ----------

# Tightly-whitelisted read-only diagnostic commands. Each label maps to an
# argv list. No shell metacharacters, no user-controlled args, no shell=True.
SAFE_SHELL_COMMANDS: dict = {
    "uptime": ["uptime"],
    "last": ["last", "-10"],
    "battery": ["pmset", "-g", "batt"],
    "disk": ["df", "-h"],
    "system_info": ["system_profiler", "SPSoftwareDataType"],
    "hardware_info": ["system_profiler", "SPHardwareDataType"],
    "wifi": ["/usr/sbin/networksetup", "-getairportnetwork", "en0"],
    "boot_time": ["sysctl", "-n", "kern.boottime"],
    "loadavg": ["sysctl", "-n", "vm.loadavg"],
    "running_processes_count": ["bash", "-c", "ps -A | wc -l"],
    "uname": ["uname", "-a"],
    "memory_pressure": ["memory_pressure"],
    "date": ["date"],
}


def run_safe_shell_query(label: str) -> tuple[bool, str]:
    argv = SAFE_SHELL_COMMANDS.get(label)
    if not argv:
        return (False, f"unknown command label '{label}'. Allowed: {sorted(SAFE_SHELL_COMMANDS.keys())}")
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=10)
        out = (r.stdout or "").strip()
        if r.returncode != 0:
            return (False, f"exit={r.returncode}: {(r.stderr or out)[:400]}")
        return (True, out[:1500])
    except subprocess.TimeoutExpired:
        return (False, "timeout (>10s)")
    except Exception as e:
        return (False, f"exception: {e}")


def run_fetch_url(url: str) -> tuple[bool, str]:
    if not (url.startswith("http://") or url.startswith("https://")):
        return (False, "url must start with http:// or https://")
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "CarthaHermesAgentAssistant/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            ctype = (r.headers.get("content-type") or "").lower()
            if not any(k in ctype for k in ("text", "json", "xml", "html")):
                return (False, f"content-type {ctype} not textual — refusing to fetch")
            raw = r.read(64 * 1024).decode("utf-8", errors="replace")
        return (True, raw[:5000])
    except Exception as e:
        return (False, f"fetch failed: {e}")


def call_ms365_mcp(tool_name: str, arguments: dict, timeout: int = 30) -> tuple[bool, str]:
    """Spawn the ms-365-mcp-server in stdio mode, do the MCP handshake, call
    one tool, return the result text. Returns (ok, text). Future-proof because:
      - Stateless per call — no long-running service, no port, no socket leak.
      - Reuses MSAL-cached Microsoft 365 credentials from prior `--login`.
      - Standard MCP JSON-RPC over stdio — protocol is stable and versioned.
      - If a single call hangs, the timeout kills it without affecting others.
    """
    if not Path(MS365_MCP_JS).exists():
        return (False, f"ms-365-mcp-server not installed at {MS365_MCP_JS}. Run: npm install -g @softeria/ms-365-mcp-server")
    argv = [MS365_MCP_NODE, MS365_MCP_JS, "--preset", "mail,calendar", "--read-only"]
    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except Exception as e:
        return (False, f"failed to spawn ms-365-mcp-server: {e}")

    def send(msg: dict) -> None:
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()

    def read_response(want_id: int, deadline: float) -> dict | None:
        """Read JSON-RPC frames until we see the matching id; skip notifications/logs."""
        assert proc.stdout is not None
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                return None
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if obj.get("id") == want_id:
                return obj
            # else: notification or unrelated response — keep reading
        return None

    deadline = time.time() + timeout
    try:
        # 1. initialize
        send({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "cartha-hermes-agent-heartbeat", "version": "0.2.0"},
            },
        })
        init_resp = read_response(1, deadline)
        if not init_resp or "error" in init_resp:
            return (False, f"mcp initialize failed: {init_resp}")

        # 2. notifications/initialized (no response expected)
        send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

        # 3. tools/call
        send({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments or {}},
        })
        call_resp = read_response(2, deadline)
        if not call_resp:
            return (False, f"mcp {tool_name} timed out after {timeout}s")
        if "error" in call_resp:
            err = call_resp["error"]
            msg = err.get("message", str(err))
            # Common auth-missing pattern: surface a friendly hint
            if "token" in msg.lower() or "login" in msg.lower() or "unauthorized" in msg.lower() or "auth" in msg.lower():
                return (False, f"ms365 not logged in — run: ~/.npm-global/bin/ms-365-mcp-server --login (orig: {msg})")
            return (False, f"mcp {tool_name} error: {msg}")
        result = call_resp.get("result", {})
        if result.get("isError"):
            # Tool ran but returned an error
            content = result.get("content", [])
            err_text = " ".join(c.get("text", "") for c in content if isinstance(c, dict))[:400]
            if any(k in err_text.lower() for k in ("token", "login", "unauthorized", "401")):
                return (False, f"ms365 not logged in — run: ~/.npm-global/bin/ms-365-mcp-server --login (orig: {err_text})")
            return (False, f"mcp {tool_name} tool error: {err_text}")
        # Concatenate text content blocks
        content = result.get("content", [])
        text_parts = []
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                text_parts.append(c.get("text", ""))
        return (True, "\n".join(text_parts)[:6000])
    finally:
        try:
            if proc.stdin and not proc.stdin.closed:
                proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)


def run_web_search(query: str, max_results: int = 5) -> tuple[bool, str]:
    """Query the local SearXNG instance and return top results as text."""
    if not query:
        return (False, "empty query")
    max_results = max(1, min(int(max_results or 5), 10))
    try:
        from urllib.parse import urlencode
        qs = urlencode({"q": query, "format": "json", "safesearch": "0"})
        req = urllib.request.Request(
            f"{SEARXNG_URL}/search?{qs}",
            headers={"User-Agent": "CarthaHermesAgentAssistant/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        results = (data.get("results") or [])[:max_results]
        if not results:
            return (True, f"(no results for: {query})")
        lines = []
        for i, rs in enumerate(results, 1):
            title = (rs.get("title") or "").strip()[:140]
            url = (rs.get("url") or "").strip()
            snippet = (rs.get("content") or "").strip()[:280]
            lines.append(f"{i}. {title}\n   {url}\n   {snippet}")
        return (True, "\n\n".join(lines))
    except Exception as e:
        return (False, f"searxng call failed: {e}")


def idle_seconds() -> int:
    """Seconds since last user keyboard/mouse input. macOS HIDIdleTime in ns."""
    try:
        r = subprocess.run(["ioreg", "-c", "IOHIDSystem"], capture_output=True, text=True, timeout=5)
        m = re.search(r'"HIDIdleTime"\s*=\s*(\d+)', r.stdout)
        if m:
            return int(m.group(1)) // 1_000_000_000
    except Exception:
        pass
    return 0


def is_afk() -> bool:
    return idle_seconds() >= AFK_THRESHOLD_SECS


def send_imessage(title: str, message: str) -> bool:
    """Send an iMessage via Messages.app + AppleScript.

    Target comes from HEARTBEAT_IMSG_TARGET — a phone (+1...) or email handle.
    Bypasses imsg.sh/BlueBubbles because the local BlueBubbles instance
    has private_api disabled and the AppleScript fallback often hangs.
    """
    if not IMSG_TARGET:
        print("imsg: HEARTBEAT_IMSG_TARGET not set, skipping")
        return False
    target = IMSG_TARGET.replace('"', '')
    body = f"🛎️ {title}\n{message}"
    safe_body = body.replace('\\', '\\\\').replace('"', '\\"')
    # Use 1st service of type iMessage; Messages.app must be signed in.
    script = (
        f'tell application "Messages"\n'
        f'  set theService to 1st service whose service type = iMessage\n'
        f'  set theBuddy to buddy "{target}" of theService\n'
        f'  send "{safe_body}" to theBuddy\n'
        f'end tell'
    )
    try:
        r = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode == 0:
            return True
        print(f"imsg osascript failed: {(r.stderr or r.stdout)[:200]}")
        return False
    except subprocess.TimeoutExpired:
        print("imsg osascript timeout — Messages.app may need Automation permission")
        return False
    except Exception as e:
        print(f"imsg send failed: {e}")
        return False


def show_bubble(title: str, message: str, severity: str = "info",
                duration: float = 8.0, persistent: bool = False,
                sound: str = "", allow_reply: bool = False,
                reply_id: str = "",
                actions: list[str] | None = None,
                image_path: str = "",
                replace_key: str = "") -> bool:
    """Fire the SwiftUI Siri-style overlay. Background, non-blocking.

    When `allow_reply` is True, the bubble shows a TextField; on submit it
    appends a JSON line to REPLIES_FILE which the next heartbeat tick reads.
    """
    if not BUBBLE_BIN.exists():
        safe_t = title.replace('"', "'")[:120]
        safe_m = message.replace('"', "'")[:300]
        subprocess.run(["osascript", "-e",
                        f'display notification "{safe_m}" with title "{safe_t}"'],
                       capture_output=True, timeout=10)
        return True
    cmd = [
        str(BUBBLE_BIN),
        "--title", title[:200],
        # Keep enough of the response for the expandable/markdown bubble to be
        # useful for drafts and operational summaries. The Swift UI still starts
        # compact, so this does not make every notification visually huge.
        "--message", message[:2400],
        "--severity", severity,
        "--duration", str(duration),
    ]
    if persistent:
        cmd.append("--persistent")
    if sound:
        cmd += ["--sound", sound]
    if image_path:
        cmd += ["--image", image_path]
    if replace_key:
        cmd += ["--replace-key", replace_key]
    if allow_reply:
        cmd += [
            "--allow-reply",
            "--reply-id", reply_id or "",
            "--reply-out", str(REPLIES_FILE),
        ]
    if actions:
        # Use ASCII unit-separator (0x1F) so labels can contain commas/spaces safely
        joined = "\x1f".join(a[:24] for a in actions[:5])
        cmd += ["--actions", joined]
    try:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
        return True
    except Exception as e:
        print(f"show_bubble failed: {e}")
        return False


def notify_macos(title: str, message: str, severity: str = "info",
                 persistent: bool = False, reply_id: str = "",
                 actions: list[str] | None = None,
                 force_reply: bool = False,
                 image_path: str = "",
                 replace_key: str = "") -> bool:
    """Top-level notify entry point.

    Always shows the floating bubble. FYI/notable/warning suggestions stay
    non-blocking in the corner. Inline reply + centered blocking presentation is
    reserved for dialog/input-needed calls or direct user-task answers
    (force_reply=True). Chips (actions) are passed through when provided. If
    user is AFK or severity is 'warning', also sends an iMessage when configured.
    """
    allow_reply = persistent or force_reply
    if persistent or force_reply:
        sound = "Glass"
    elif severity == "warning":
        sound = "Tink"
    else:
        sound = ""
    if not replace_key and not allow_reply and not persistent:
        replace_key = "cartha-agent-visual" if image_path else "cartha-agent-notice"
    show_bubble(
        title, message,
        severity=severity,
        duration=(18.0 if image_path else (12.0 if severity == "warning" else (8.0 if severity == "notable" else 5.0))),
        persistent=persistent,
        sound=sound,
        allow_reply=allow_reply,
        reply_id=reply_id,
        actions=actions,
        image_path=image_path,
        replace_key=replace_key,
    )
    if severity == "warning" or is_afk():
        body = message
        if actions:
            body += "\n\nOptions: " + " · ".join(actions)
        send_imessage(title, body)
    return True



def parse_reply_items(replies: str) -> list[dict]:
    """Parse the JSONL reply queue drained by heartbeat.sh."""
    if not replies or replies.startswith("(no user replies"):
        return []
    items: list[dict] = []
    for line in replies.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                items.append(obj)
        except Exception:
            continue
    return items


def normalized_command_text(text: str) -> str:
    text = (text or "").lower()
    text = text.replace("’", "'").replace("‘", "'").replace("`", "'")
    text = text.replace("test flight", "testflight")
    # Keep + for version-ish text, but normalize everything else to spaces.
    text = re.sub(r"[^a-z0-9+]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _reply_text(item: dict) -> str:
    return str(item.get("reply") or item.get("text") or item.get("message") or "")


def _reply_source(item: dict) -> str:
    return str(item.get("source") or "")


def _is_ios_testflight_prompt(item: dict) -> bool:
    rid = str(item.get("id") or "")
    title = str(item.get("title") or "")
    hay = f"{rid} {title}".lower()
    return rid.startswith("ios-tf-") or "testflight" in hay or "test flight" in hay


def detect_ios_testflight_reply(items: list[dict]) -> dict | None:
    """Deterministic fast path for scarce iOS TestFlight uploads.

    This bypasses the local LLM so clicking a proposal chip or saying
    “Cartha/Hermes, let's deploy iOS” reliably dispatches the workflow.
    """
    affirmative = {
        "yes", "y", "approve", "approved", "upload", "upload it",
        "deploy", "deploy it", "deploy ios", "deploy iphone", "ship it",
        "do it", "yes upload", "yes deploy", "deploy ios now",
    }
    negative = {"no", "n", "skip", "no skip", "don t upload", "dont upload", "do not upload", "not now"}
    later = {"later", "snooze", "remind me later"}

    for item in items:
        raw = _reply_text(item)
        text = normalized_command_text(raw)
        rid = str(item.get("id") or "")
        source = _reply_source(item)
        is_prompt = _is_ios_testflight_prompt(item)

        if is_prompt:
            if text in later:
                return {"action": "later", "proposal_id": rid, "raw": raw}
            if text in negative or "skip" in text:
                return {"action": "skip", "proposal_id": "" if rid.startswith("ios-tf-fail-") else rid, "raw": raw}
            if text in affirmative or ("deploy" in text and "ios" in text) or ("upload" in text and "testflight" in text):
                return {"action": "deploy" if rid.startswith("ios-tf-fail-") else "approve", "proposal_id": rid, "raw": raw}

        direct = source in {"alfred", "cartha-voice", "voice", "cartha-voice-reply", "voice-reply"} or str(item.get("mode") or "") == "followup"
        if direct:
            wants_deploy = (
                ("deploy" in text and "ios" in text)
                or ("upload" in text and "testflight" in text)
                or ("ship" in text and "testflight" in text)
                or ("release" in text and "testflight" in text)
                or ("lets deploy ios" in text)
                or ("let s deploy ios" in text)
            )
            if wants_deploy and not any(word in text for word in ("don t", "dont", "do not", "skip", "cancel")):
                return {"action": "deploy", "proposal_id": "", "raw": raw}
    return None


def run_ios_testflight_action(action: dict) -> tuple[bool, str]:
    if not IOS_TESTFLIGHT_SH.exists():
        return (False, f"Missing deploy helper: {IOS_TESTFLIGHT_SH}")
    kind = action.get("action")
    raw = str(action.get("raw") or "")[:180]
    proposal_id = str(action.get("proposal_id") or "")
    reason = f"Cartha Agent command: {raw}" if raw else "Cartha Agent requested iOS TestFlight upload"

    if kind == "later":
        return (True, "Left the iOS TestFlight proposal pending for later.")
    if kind == "skip":
        if proposal_id:
            cmd = [str(IOS_TESTFLIGHT_SH), "skip", proposal_id]
        else:
            return (True, "No deploy requested.")
    elif kind == "approve":
        if proposal_id:
            cmd = [str(IOS_TESTFLIGHT_SH), "approve", proposal_id, reason]
        else:
            cmd = [str(IOS_TESTFLIGHT_SH), "deploy"]
    elif kind == "deploy":
        cmd = [str(IOS_TESTFLIGHT_SH), "deploy"]
    else:
        return (False, f"Unknown iOS TestFlight action: {kind}")

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=75)
        out = ((r.stdout or "") + ("\n" + r.stderr if r.stderr else "")).strip()
        return (r.returncode == 0, out[:2400] or f"{kind} completed")
    except subprocess.TimeoutExpired:
        return (False, "Timed out trying to dispatch the iOS TestFlight workflow.")
    except Exception as e:
        return (False, f"Failed to dispatch iOS TestFlight workflow: {e}")


def render_visual(spec: dict | None) -> str:
    """Render a chart/status card spec into a local PNG and return its path."""
    if not isinstance(spec, dict) or not spec:
        return ""
    if not VISUAL_RENDERER.exists():
        print(f"visual renderer missing: {VISUAL_RENDERER}")
        return ""
    try:
        r = subprocess.run(
            [sys.executable, str(VISUAL_RENDERER), "--spec", json.dumps(spec)],
            capture_output=True,
            text=True,
            timeout=12,
        )
        raw = (r.stdout or "").strip()
        data = json.loads(raw) if raw else {}
        path = str(data.get("path") or "")
        if r.returncode == 0 and data.get("ok") and path and Path(path).exists():
            return path
        print(f"visual render failed rc={r.returncode}: {raw[:240]} {(r.stderr or '')[:160]}")
    except Exception as e:
        print(f"visual render failed: {e}")
    return ""


def _extract_json_object(text: str) -> dict | None:
    """Best-effort parse of a single JSON object from model text."""
    if not text:
        return None
    candidates = [text.strip()]
    fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    candidates = fenced + candidates
    brace = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if brace:
        candidates.append(brace.group(0))
    for candidate in candidates:
        try:
            obj = json.loads(candidate)
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue
    return None


def parse_direct_answer(raw: str) -> tuple[str, dict | None]:
    """Direct-task escalations may return JSON with optional visual spec."""
    obj = _extract_json_object(raw)
    if not obj:
        return (raw.strip(), None)
    answer = str(obj.get("answer") or obj.get("message") or obj.get("text") or raw).strip()
    visual = obj.get("visual")
    if not isinstance(visual, dict):
        visual = None
    return (answer, visual)


def load_policy() -> dict:
    try:
        with POLICY_PATH.open() as f:
            return json.load(f)
    except Exception as e:
        print(f"WARN: could not load policy ({e}); using safe defaults")
        return {
            "phase": 1,
            "quit_app": {"allowlist": [], "denylist": []},
            "cleanup": {"enabled_actions": []},
        }


def load_openrouter_key() -> str | None:
    if not ENV_FILE.exists():
        return None
    for line in ENV_FILE.read_text().splitlines():
        m = re.match(r"^\s*OPENROUTER_API_KEY=(.+)$", line)
        if m:
            return m.group(1).strip()
    return None


# ---------- tool definitions ----------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "noop",
            "description": "Nothing in the heartbeat context needs action or recording.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "journal_entry",
            "description": "Append a short note to the journal. Use for notable but non-urgent observations. If severity is 'warning', a macOS notification will also be fired.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "severity": {"type": "string", "enum": ["info", "notable", "warning"]},
                },
                "required": ["summary", "severity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "notify_user",
            "description": "Surface a soft suggestion to Zack via a transient floating bubble (auto-dismisses after 8s). Use for patterns worth flagging that don't need urgent attention: build cadence, stale processes, churn, behaviors worth changing. Observation only — no destructive action.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "short title"},
                    "message": {"type": "string", "description": "the suggestion, <= 200 chars"},
                    "severity": {"type": "string", "enum": ["info", "notable", "warning"]},
                },
                "required": ["title", "message", "severity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "show_visual",
            "description": "Show Zack a chart/status visual in Cartha Agent's larger centered bubble. Prefer this over plain notify_user whenever numbers, comparisons, trends, progress, rankings, costs, timings, memory/CPU/disk/process status, or multi-metric health are easier to understand visually. Do not use it for pure text, one-line acknowledgements, or simple timers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "short visual title"},
                    "message": {"type": "string", "description": "1-2 sentence takeaway explaining what the visual means"},
                    "severity": {"type": "string", "enum": ["info", "notable", "warning", "critical"]},
                    "blocking": {"type": "boolean", "description": "true only if this should stay until dismissed; false for normal visual summaries"},
                    "visual": {
                        "type": "object",
                        "description": "Chart spec. Supported kinds: bar, line, progress, stat_grid. For bar/line use labels + values. For progress use segments [{label,value,max,status,note}]. For stat_grid use metrics [{label,value,delta,status,note}]. Include title, subtitle, unit when helpful.",
                        "properties": {
                            "kind": {"type": "string", "enum": ["bar", "line", "progress", "stat_grid"]},
                            "title": {"type": "string"},
                            "subtitle": {"type": "string"},
                            "unit": {"type": "string"},
                            "labels": {"type": "array", "items": {"type": "string"}},
                            "values": {"type": "array", "items": {"type": "number"}},
                            "segments": {"type": "array", "items": {"type": "object"}},
                            "metrics": {"type": "array", "items": {"type": "object"}},
                            "footer": {"type": "string"}
                        }
                    },
                },
                "required": ["title", "message", "severity", "visual"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "notify_user_dialog",
            "description": "HIGH-ATTENTION variant: large centered blocking bubble + Glass sound + warning-tinted UI, requires user input. Stays open with an inline text reply field, suggested-action chips (if you provide them), and a Send button. Use for things that need a decision from Zack: production incidents, ambiguous failures, choices between remediation paths. Always also iMessages Zack.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "message": {"type": "string", "description": "the alert content, <= 280 chars"},
                    "reason": {"type": "string", "description": "why this rises to dialog-level attention"},
                    "suggested_actions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of 2-4 short chip labels (<=24 chars each) that Zack can click to reply quickly, e.g. ['Acknowledge', 'Investigate now', 'Snooze 30m', 'Escalate further']. A freeform text reply is always available too. Leave empty if no obvious choices."
                    }
                },
                "required": ["title", "message", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mark_job_done",
            "description": "A pending agent-sync job clearly finished successfully.",
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id": {"type": "string"},
                    "result": {"type": "string"},
                },
                "required": ["job_id", "result"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_timer",
            "description": "Schedule a notification to fire after a delay. Use this for reminders, timers, snooze-and-remind. The bubble appears at the specified time (sound for warning severity). Examples: 'remind me in 10 seconds', 'set a 5-minute timer for the pasta', 'snooze this and check back in 30 min'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "delay_seconds": {"type": "integer", "description": "How many seconds to wait before firing. Range: 1 to 86400 (1 day)."},
                    "title": {"type": "string", "description": "Short title for the timer bubble (e.g. 'Timer: pasta done', 'Reminder')"},
                    "message": {"type": "string", "description": "Body of the notification when the timer fires"},
                    "severity": {"type": "string", "enum": ["info", "notable", "warning"], "description": "warning = plays sound; info/notable = silent"},
                },
                "required": ["delay_seconds", "title", "message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web via the local SearXNG instance. Use this BEFORE escalating for factual, current-events, version-lookup, weather, or any user question whose answer lives on the public web. Results are surfaced to Zack as a bubble — you do NOT need to also escalate. Cheap and local; prefer over deepseek for anything fact-shaped.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "natural-language search query"},
                    "answer": {"type": "string", "description": "your one-sentence framing of what Zack will see; used as the bubble title"},
                    "max_results": {"type": "integer", "description": "1-10, default 5"},
                },
                "required": ["query", "answer"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "safe_shell_query",
            "description": "Run ONE tightly-whitelisted read-only macOS diagnostic command and return its output to the journal. Use this BEFORE escalating any system-state question that a single shell command can answer. Allowed labels: uptime, last (last 10 logins/reboots), battery, disk, system_info, hardware_info, wifi, boot_time, loadavg, running_processes_count, uname, memory_pressure, date. Cheap, fully local, no second-opinion needed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "label": {
                        "type": "string",
                        "enum": ["uptime", "last", "battery", "disk", "system_info", "hardware_info", "wifi", "boot_time", "loadavg", "running_processes_count", "uname", "memory_pressure", "date"]
                    },
                    "purpose": {"type": "string", "description": "one-sentence reason — what will you do with the output"},
                },
                "required": ["label", "purpose"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "Fetch a specific URL (HTML/JSON/XML/text only, binary refused, capped at ~5KB) and journal the content. Use to inspect a URL Zack mentioned, a result from web_search, or a known status page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "purpose": {"type": "string", "description": "one-sentence reason"},
                },
                "required": ["url", "purpose"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_calendar_today",
            "description": "Read today's calendar events from Microsoft 365 (Outlook). Use for 'what's on my calendar', 'next meeting', 'when's my X meeting' questions. Calls the ms-365-mcp-server via stdio — read-only, uses cached MSAL credentials. Surfaces a compact summary bubble to Zack.",
            "parameters": {
                "type": "object",
                "properties": {
                    "purpose": {"type": "string", "description": "one-sentence reason — what Zack asked or what trigger prompted this"},
                    "hours_ahead": {"type": "integer", "description": "how many hours from now to include (1-24, default 24)"},
                },
                "required": ["purpose"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_mail_recent",
            "description": "Read recent Microsoft 365 (Outlook) inbox messages. Use for 'any urgent mail', 'did the X email come', 'inbox status' questions. Calls ms-365-mcp-server via stdio — read-only. Surfaces a compact summary bubble.",
            "parameters": {
                "type": "object",
                "properties": {
                    "purpose": {"type": "string", "description": "one-sentence reason"},
                    "max_messages": {"type": "integer", "description": "1-20, default 10"},
                    "unread_only": {"type": "boolean", "description": "true to filter to unread, default false"},
                },
                "required": ["purpose"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "escalate",
            "description": "Reach the senior model (deepseek-v4-flash, cloud) for a second opinion. Use SPARINGLY — only for: (a) multi-step planning that local tools cannot resolve, (b) genuinely novel patterns not seen recently, (c) destructive proposals needing concurrence, (d) anything you cannot answer with web_search / safe_shell_query / fetch_url / your training. Do NOT escalate for: 'no new signal' ticks, internal errors (Ollama down, snapshot missing), repeated identical observations already in the journal, or any question that maps to a local tool.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string"},
                    "urgency": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["reason", "urgency"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_quit_app",
            "description": "Propose quitting a GUI app to free memory. Only use for apps that are clearly idle and have a large RSS. Will be gated by the safety allowlist AND a second opinion from the stronger model.",
            "parameters": {
                "type": "object",
                "properties": {
                    "app_name": {"type": "string", "description": "exact macOS app name (e.g. 'Slack', 'Spotify')"},
                    "rss_mb": {"type": "number", "description": "resident memory in MB observed in the system snapshot"},
                    "reason": {"type": "string"},
                },
                "required": ["app_name", "rss_mb", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_cleanup",
            "description": "Propose running a cleanup action. Will be gated by enabled_actions policy AND a second opinion from the stronger model.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": [
                            "empty_trash",
                            "clean_xcode_derived_data",
                            "clean_ios_simulator_caches",
                            "clean_tmp_old",
                            "clean_npm_cache",
                            "clean_yarn_cache",
                            "clean_pip_cache",
                            "clean_homebrew_cache",
                            "clean_docker_images",
                        ],
                    },
                    "expected_freed_mb": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["action", "reason"],
            },
        },
    },
]

SYSTEM_PROMPT = """You are the Cartha Hermes Agent Assistant — a quiet system custodian that runs every 30 minutes on Zack's MacBook Pro M4 Max (128 GB unified memory). You're the LOCAL brain; you handle routine and factual work yourself and only reach the senior cloud model for genuinely hard situations.

You receive: recent local activity, OpenClaw personal context, pending agent-sync jobs, a system state report (already-computed memory_pressure and cpu_pressure tiers, top processes by RSS, running GUI apps, cleanup-target sizes), and the last 10 heartbeat journal entries.

Your job is to call EXACTLY ONE tool. Never reply in prose. Available tools:

  Default / no-action:
  - noop: context is quiet, no action needed
  - journal_entry: record a notable but non-urgent observation (warning severity also notifies)

  Local research (call THESE before escalating):
  - web_search: query the local SearXNG instance (no API key, no rate limit). Use for any factual/current-events/version/weather lookup — never escalate these.
  - safe_shell_query: one read-only macOS diagnostic command (uptime, last, battery, disk, system_info, hardware_info, wifi, boot_time, loadavg, running_processes_count, uname, memory_pressure, date). Use for system-state questions a single command can answer.
  - fetch_url: pull HTML/JSON/XML/text content of a specific URL (capped at ~5KB).
  - read_calendar_today: today's Microsoft 365 calendar events. Use for "what's on my calendar", "next meeting", "free at 3pm".
  - read_mail_recent: recent Microsoft 365 inbox. Use for "any urgent mail", "did X email come".

  Surface to user:
  - notify_user: SOFT suggestion via a floating bubble that auto-dismisses (8s). Use after web_search / safe_shell_query when you have an answer Zack should see.
  - show_visual: VISUAL-FIRST chart/status bubble. Prefer this when quantities, rankings, comparisons, trends, progress, costs, timings, memory/CPU/disk/process status, or health summaries are clearer as a picture.
  - notify_user_dialog: HIGH-ATTENTION alert via a persistent bubble + sound + iMessage. Supports `suggested_actions` (chip buttons). Use for things requiring immediate human decision.
  - set_timer: schedule a delayed notification (1s to 24h) for reminders/timers.
  - mark_job_done: a pending agent-sync job clearly finished

  Escalation (cloud, expensive — use sparingly):
  - escalate: senior model second-opinion. ONLY for: multi-step planning local tools can't resolve, genuinely novel patterns, or destructive-action concurrence. Never for: 'no new signal' ticks, internal errors, repeated identical observations, or questions a local tool can answer.

  Destructive (gated by Phase 2 second-opinion):
  - propose_quit_app: free RAM by quitting a clearly-idle high-memory app
  - propose_cleanup: tidy a cache or build-artifact directory that's grown large

Decision rules:

0. VISUAL-FIRST rule — when communicating numeric state, comparisons, rankings, progress, trends, timing/cost deltas, resource usage, queue/job health, or multi-metric status, use `show_visual` instead of plain `notify_user` whenever a compact chart/status card would make Zack understand it faster. Do not force visuals for pure text, one-line acknowledgements, reminders/timers, or situations where `notify_user_dialog` is required for input.

1. CRITICAL APPS ARE NEVER PROPOSED FOR QUIT. The denylist will reject it anyway: IDEs (Cursor, Code, Xcode, Android Studio, JetBrains), terminals (Terminal, iTerm, Warp, Ghostty), browsers (Safari, Chrome, Arc, Firefox), Claude, Hermes, Cartha Agent, Cartha, Messages, Mail, Notes, Simulator, Docker, OrbStack, 1Password, recorders (OBS, QuickTime), video-call apps (Zoom, Teams, FaceTime).

2. Only propose `propose_quit_app` for an app that:
   (a) is on the allowlist (Slack, Discord, Spotify, Music, Photos, App Store, Calendar, Reminders, Activity Monitor, System Settings, Maps, Weather, News, Stocks, Podcasts, TV), AND
   (b) appears by EXACT NAME in the RUNNING GUI APPS section of the system snapshot, AND
   (c) has aggregated RSS > 500 MB across its processes in the top-procs list.
   Never invent an app name not in the snapshot.

3. "In-use" guard for cleanup — DO NOT propose a cleanup whose toolchain is implied to be active in RECENT ACTIVITY:
   - If activity mentions Flutter / Xcode / iOS / Swift / cartha_ai_mobile / simulator → DO NOT propose `clean_xcode_derived_data` or `clean_ios_simulator_caches`. Their next build needs them.
   - If activity mentions node / npm / yarn / pnpm / next / react → DO NOT propose `clean_npm_cache` or `clean_yarn_cache`.
   - If activity mentions pip / python install / poetry / uv → DO NOT propose `clean_pip_cache`.
   - If activity mentions brew install/upgrade → DO NOT propose `clean_homebrew_cache`.
   - If activity mentions docker build/run/compose → DO NOT propose `clean_docker_images`.

4. ANTI-LOOP awareness — read RECENT HEARTBEAT ACTIONS:
   - If you already did the same cleanup (`[CLEANUP]` or `[CLEANUP-P3]` of the same action) in the last few entries, do NOT propose it again. Try a different target or noop.
   - If a quit was VETOED for an app, don't immediately re-propose the same quit.
   - If escalations are stacking on the same incident without resolution, prefer journal_entry over another escalate.

5. Prefer cleanup over quitting apps when both help. Cleanup is reversible; quitting an app is more intrusive.

6. Prefer noop unless you see real signal. Thresholds for "real signal":
   - Xcode DerivedData > 5 GB (AND no recent Flutter/Xcode activity)
   - iOS simulator caches > 5 GB (AND no recent iOS activity)
   - trash > 1 GB
   - tmp files older than 7d > 100 entries
   - app on allowlist with aggregated RSS > 500 MB

7. Use the pre-computed pressure tiers (memory_pressure, cpu_pressure: LOW/MEDIUM/HIGH) — don't re-derive them. If memory_pressure is HIGH and nothing safe is available, prefer `escalate` over forcing a risky action.

8. ESCALATION DISCIPLINE — escalation is the EXCEPTION, not the default. Walk this decision tree before calling `escalate`:
   (a) Can you answer from your own training (general knowledge, programming, well-known facts)? → answer directly via `notify_user` or `journal_entry`. Do not escalate.
   (b) Is the answer on the public web (news, current versions, weather, lookups)? → call `web_search`. Do not escalate.
   (c) Is the answer in a macOS shell command (uptime, battery, last reboot, disk, wifi, etc.)? → call `safe_shell_query`. Do not escalate.
   (d) Is the answer at a specific URL? → call `fetch_url`. Do not escalate.
   (d2) Is it about Zack's calendar or inbox? → call `read_calendar_today` or `read_mail_recent`. Do not escalate.
   (e) Is this a destructive proposal (quit app, cleanup)? → call the propose_* tool; Phase 2 handles the second opinion automatically.
   (f) Is the situation a no-op tick (no new signal, system nominal, no open user threads)? → `noop`. Never escalate.
   (g) Is this a recurring observation already in the last 10 journal entries with similar wording? → `noop` or `journal_entry` once at most. Never re-escalate.
   (h) Is this an internal error (Ollama unreachable, snapshot missing, SSH timeout)? → `journal_entry` once per error-class. Never escalate transient infra errors.
   Only if NONE of (a)-(h) apply AND the situation is genuinely novel + needs multi-step reasoning → `escalate`.

8b. USER REPLIES — if the USER REPLIES section has entries, Zack is talking to you. Three flavors:

  (i) **Reply to a prior notification** (`source` absent or != "alfred"; has a `title` matching a notification you fired). Honor what he said:
   - "Acknowledge" / "Got it" / similar → `journal_entry(info)` recording his ack, move on.
   - "Snooze 30m" → `journal_entry` noting the snooze; treat the underlying issue as muted until the snooze expires.
   - "Dismiss" / "Stop tracking" / "Drop it" → `journal_entry(info)` recording dismissal; do NOT re-escalate the underlying topic in future ticks.
   - "Investigate now" / custom directive asking for deeper info → run a `safe_shell_query` or `web_search` if applicable; only escalate if neither fits.
   - Destructive directive ("kill that process", "ignore from now on") → `escalate` so deepseek can confirm safety.

  (ii) **Ad-hoc task from Alfred or voice** (`source: "alfred"` or `source: "cartha-voice"`, title: "Cartha Agent task"). Zack typed or dictated an unsolicited request. He expects a real response — work the decision tree above:
   - Factual / web-shaped question ("what's the weather", "latest npm version of react", "did X release yet") → `web_search`.
   - System-state question ("when did my Mac last reboot", "battery health", "disk usage") → `safe_shell_query`.
   - URL inspection ("what does this PR comment say", "is example.com up") → `fetch_url`.
   - Question you can answer from training (definitions, well-known facts, code explanation, short reasoning) → `notify_user` with your answer.
   - Action that maps to a tool (quit an app, clean a cache, set a timer) → call that tool.
   - Ambiguous request needing clarification → `notify_user_dialog` with chips for the likely interpretations.
   - Only escalate when the request requires multi-step reasoning OR sensitive judgment local tools cannot resolve.

  (iii) **Voice follow-up reply** (`source: "cartha-voice-reply"` or `mode: "followup"`). Zack said "reply ..." after the wake word. Treat this as a continuation of the latest Cartha Agent exchange. Apply the same decision tree; escalate only if no local tool fits the follow-up.

9. SUGGESTION MODE — use `notify_user` when you spot a pattern worth flagging that doesn't need destructive action. Examples:
   - Excessive Flutter/iOS build cadence (multiple builds per hour for the same target)
   - Long-running stale processes (>24h with no output, suspicious uptime)
   - Warm models loaded but unused for cycles
   - Repeated cleanup churn (same target growing back rapidly between cycles)
   - Behaviors worth changing (e.g. "consider hourly build instead of per-commit")
   Severity guide: info = FYI, notable = worth your attention, warning = something likely needs intervention soon.
   `notify_user` is observation-only — no destructive action is taken. Prefer it over `journal_entry` when the user would benefit from immediate awareness.

10. CHIPS for `notify_user_dialog` — when calling `notify_user_dialog`, set `suggested_actions` to a small list (2-4) of short chip labels the user can click. Examples:
   - For an incident alert: ["Acknowledge", "Investigate now", "Page on-call", "Snooze 30m"]
   - For a security warning: ["Review now", "Kill the process", "It's expected", "Snooze 1h"]
   - For an ambiguous failure: ["Retry the job", "Look into it", "Ignore"]
   Always pick options that are concrete and would meaningfully change what happens next. Zack can always type a custom reply — chips are just shortcuts.

Always exactly one tool call. No prose."""


# ---------- ollama + openrouter calls ----------

def call_local(user_content: str) -> dict:
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "tools": TOOLS,
        "stream": False,
        "think": False,
        "keep_alive": KEEP_ALIVE,
        "options": {"temperature": 0.0, "num_predict": 512},
    }
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def call_deepseek(system: str, user: str, timeout: int = 60, max_tokens: int = 400) -> str | None:
    """Call deepseek-v4-flash via OpenRouter. Returns content string or None on failure."""
    key = load_openrouter_key()
    if not key:
        print("WARN: no OPENROUTER_API_KEY; cannot call deepseek")
        return None
    body = {
        "model": ESCALATION_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens,
    }
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://hermes.local/heartbeat",
            "X-Title": "Cartha Agent Heartbeat",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"deepseek call failed: {e}")
        return None


# ---------- second opinion ----------

SECOND_OPINION_SYSTEM = """You are the senior system custodian. The junior agent (a smaller local model) has proposed a destructive action on Zack's MacBook. Your job is to confirm or veto.

Respond in EXACTLY this format (no prose outside it):
  DECISION: CONFIRM
  REASON: <one sentence>

or:

  DECISION: VETO
  REASON: <one sentence>

Confirm only if:
- The action is clearly safe and reversible-enough
- No critical workflow is implied to be in progress in the context
- The justification matches the observed state

When in doubt, VETO."""


def second_opinion(context_bundle: str, proposal: str) -> tuple[bool, str]:
    user = f"""=== CONTEXT THE JUNIOR AGENT SAW ===
{context_bundle}

=== PROPOSED ACTION ===
{proposal}

Decide CONFIRM or VETO."""
    resp = call_deepseek(SECOND_OPINION_SYSTEM, user)
    if not resp:
        return (False, "deepseek unreachable — defaulting to VETO")
    m = re.search(r"DECISION:\s*(CONFIRM|VETO)", resp, re.IGNORECASE)
    decision = (m.group(1).upper() if m else "VETO")
    rm = re.search(r"REASON:\s*(.+?)(?:\n|$)", resp, re.IGNORECASE | re.DOTALL)
    reason = (rm.group(1).strip() if rm else resp.strip())[:300]
    return (decision == "CONFIRM", reason)


# ---------- action executors ----------

def quit_app_macos(app_name: str) -> tuple[bool, str]:
    # Use graceful tell-to-quit so the app can show save dialogs if needed.
    # Note: most allowlisted apps don't have unsaved-doc state; if they prompt,
    # they'll just stay open and we journal that.
    safe_name = app_name.replace('"', '\\"')
    try:
        r = subprocess.run(
            ["osascript", "-e", f'tell application "{safe_name}" to quit'],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode == 0:
            return (True, "quit signal sent")
        return (False, (r.stderr or r.stdout or "unknown error").strip()[:200])
    except subprocess.TimeoutExpired:
        return (False, "osascript timeout (app may have prompted for save)")
    except Exception as e:
        return (False, f"exception: {e}")


def run_cleanup(action: str) -> tuple[bool, str]:
    try:
        r = subprocess.run(
            ["bash", str(CLEANUP_SH), action],
            capture_output=True, text=True, timeout=300,
        )
        out = (r.stdout or "").strip()
        if r.returncode == 0 and out.startswith("OK"):
            return (True, out)
        return (False, (out or r.stderr or "unknown error")[:300])
    except subprocess.TimeoutExpired:
        return (False, "cleanup timed out (>5min)")
    except Exception as e:
        return (False, f"exception: {e}")


# ---------- main routing ----------

def parse_args(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return {"_raw": raw}
    return {}


def infer_tool_from_content(content: str) -> tuple[str, dict] | None:
    """Recover a tool_call from raw content when qwen emits structured JSON in
    message.content instead of message.tool_calls. Returns (tool_name, args) or None.
    """
    if not content:
        return None
    # Bare verdict recovery: model sometimes emits "noop" as a final word after
    # reasoning prose. Treat that as a structured noop call.
    last = content.strip().splitlines()[-1].strip().rstrip(".").lower() if content.strip() else ""
    if last in {"noop", "no action", "no action needed", "no_action"}:
        return ("noop", {})
    # Find first JSON object in the content
    m = re.search(r"\{.*\}", content, re.DOTALL)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    # Sometimes qwen wraps the call as {"name": "...", "arguments": {...}}
    if "name" in obj and "arguments" in obj and isinstance(obj.get("arguments"), dict):
        return (str(obj["name"]), obj["arguments"])
    keys = set(obj.keys())
    # Infer from arg signature — order matters: more specific signatures first
    if {"title", "message", "severity", "visual"} <= keys:
        return ("show_visual", obj)
    if {"title", "message", "reason"} <= keys:
        return ("notify_user_dialog", obj)
    if {"title", "message", "severity"} <= keys:
        return ("notify_user", obj)
    if {"query", "answer"} <= keys:
        return ("web_search", obj)
    if {"label", "purpose"} <= keys:
        return ("safe_shell_query", obj)
    if {"url", "purpose"} <= keys:
        return ("fetch_url", obj)
    if {"purpose", "hours_ahead"} <= keys:
        return ("read_calendar_today", obj)
    if {"purpose", "max_messages"} <= keys or {"purpose", "unread_only"} <= keys:
        return ("read_mail_recent", obj)
    if {"app_name", "reason"} <= keys:
        return ("propose_quit_app", obj)
    if {"action", "reason"} <= keys:
        return ("propose_cleanup", obj)
    if {"job_id", "result"} <= keys:
        return ("mark_job_done", obj)
    if {"reason", "urgency"} <= keys:
        return ("escalate", obj)
    if {"summary", "severity"} <= keys:
        return ("journal_entry", obj)
    return None


def has_direct_user_task(replies: str) -> bool:
    return any(
        needle in (replies or "")
        for needle in (
            '"source": "alfred"', '"source":"alfred"',
            '"source": "url"', '"source":"url"',
            '"source": "cartha-voice"', '"source":"cartha-voice"',
            '"source": "voice"', '"source":"voice"',
            '"source": "cartha-voice-reply"', '"source":"cartha-voice-reply"',
            '"source": "voice-reply"', '"source":"voice-reply"',
            '"mode": "followup"', '"mode":"followup"',
        )
    )


def trusted_autonomy_enabled(policy: dict) -> bool:
    cfg = policy.get("trusted_autonomy")
    return isinstance(cfg, dict) and bool(cfg.get("enabled"))


def direct_user_task_items(items: list[dict]) -> list[dict]:
    direct_sources = {
        "alfred",
        "url",
        "cartha-voice",
        "voice",
        "cartha-voice-reply",
        "voice-reply",
    }
    out: list[dict] = []
    for item in items:
        source = _reply_source(item)
        mode = str(item.get("mode") or "")
        text = _reply_text(item).strip()
        if not text:
            continue
        if source in direct_sources or mode in {"task", "followup"}:
            out.append(item)
    return out


def run_trusted_autonomy_task(item: dict, context_bundle: str) -> dict:
    task_text = _reply_text(item).strip()
    source = _reply_source(item) or str(item.get("mode") or "unknown")
    if not TRUSTED_AUTONOMY_SH.exists():
        return {
            "status": "blocked",
            "summary": "Trusted Autonomy runner is missing.",
            "details": str(TRUSTED_AUTONOMY_SH),
            "next_steps": ["Restore cartha-trusted-autonomy.py."],
        }
    context_path = Path("/tmp") / f"cartha-autonomy-context-{uuid.uuid4().hex}.txt"
    try:
        context_path.write_text(context_bundle, encoding="utf-8")
        result = subprocess.run(
            [
                sys.executable,
                str(TRUSTED_AUTONOMY_SH),
                "--task", task_text,
                "--source", source,
                "--context-file", str(context_path),
            ],
            capture_output=True,
            text=True,
            timeout=1800,
        )
        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()
        if result.returncode != 0 and not stdout:
            return {
                "status": "blocked",
                "summary": "Trusted Autonomy failed before producing a result.",
                "details": stderr[:1200] or f"exit={result.returncode}",
                "next_steps": ["Check ~/.hermes/logs/cartha-autonomy.log."],
            }
        # The runner writes one final JSON object to stdout. If any incidental
        # logging slips in, use the last JSON-looking line.
        for line in reversed(stdout.splitlines() or [stdout]):
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                continue
        return {
            "status": "blocked",
            "summary": "Trusted Autonomy produced an unreadable result.",
            "details": (stdout + "\n" + stderr)[:1200],
            "next_steps": ["Check ~/.hermes/logs/cartha-autonomy.log."],
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "partial",
            "summary": "Trusted Autonomy hit the 30-minute outer timeout.",
            "details": "The background run was stopped by the heartbeat wrapper.",
            "next_steps": ["Reply 'continue' if you want me to keep going."],
        }
    except Exception as exc:
        return {
            "status": "blocked",
            "summary": "Trusted Autonomy could not start.",
            "details": str(exc),
            "next_steps": ["Check the local Cartha Agent scripts checkout."],
        }
    finally:
        try:
            context_path.unlink(missing_ok=True)
        except Exception:
            pass


def format_autonomy_message(result: dict) -> str:
    status = str(result.get("status") or "unknown")
    summary = str(result.get("summary") or "(no summary)")
    details = str(result.get("details") or "")
    next_steps = result.get("next_steps") or []
    lines = [summary]
    if details:
        lines.append("")
        lines.append(details[:1200])
    if isinstance(next_steps, list) and next_steps:
        lines.append("")
        lines.append("Next: " + " · ".join(str(x) for x in next_steps[:3]))
    artifact_path = result.get("artifact_path")
    if artifact_path:
        lines.append("")
        lines.append(f"Run artifact: {artifact_path}")
    return "\n".join(lines)[:2200]


def has_voice_followup(replies: str) -> bool:
    return any(
        needle in (replies or "")
        for needle in (
            '"source": "cartha-voice-reply"', '"source":"cartha-voice-reply"',
            '"source": "voice-reply"', '"source":"voice-reply"',
            '"mode": "followup"', '"mode":"followup"',
        )
    )


def has_voice_user_task(replies: str) -> bool:
    return any(
        needle in (replies or "")
        for needle in (
            '"source": "cartha-voice"', '"source":"cartha-voice"',
            '"source": "voice"', '"source":"voice"',
            '"source": "cartha-voice-reply"', '"source":"cartha-voice-reply"',
            '"source": "voice-reply"', '"source":"voice-reply"',
            '"mode": "followup"', '"mode":"followup"',
        )
    )


def main() -> int:
    payload = json.load(sys.stdin)
    activity = payload.get("activity") or "(none)"
    context = payload.get("context") or "(none)"
    pending = payload.get("pending") or "(none)"
    system = payload.get("system") or "(none)"
    recent_actions = payload.get("recent_actions") or "(no prior heartbeat actions)"
    replies = payload.get("replies") or "(no user replies in queue)"

    policy = load_policy()
    phase = int(PHASE_OVERRIDE) if PHASE_OVERRIDE else int(policy.get("phase", 1))
    allowlist = set(policy.get("quit_app", {}).get("allowlist", []))
    denylist = set(policy.get("quit_app", {}).get("denylist", []))
    enabled_cleanups = set(policy.get("cleanup", {}).get("enabled_actions", []))

    user_content = (
        f"=== RECENT ACTIVITY (last 30m) ===\n{activity}\n\n"
        f"=== OPENCLAW PERSONAL CONTEXT (rolling) ===\n{context}\n\n"
        f"=== PENDING JOBS (EC2 agent-sync) ===\n{pending}\n\n"
        f"=== SYSTEM SNAPSHOT ===\n{system}\n\n"
        f"=== RECENT HEARTBEAT ACTIONS (last 10 journal entries) ===\n{recent_actions}\n\n"
        f"=== USER REPLIES (just submitted via Cartha Agent bubble) ===\n{replies}\n"
    )

    reply_items = parse_reply_items(replies)
    ios_action = detect_ios_testflight_reply(reply_items)
    if ios_action:
        ok, detail = run_ios_testflight_action(ios_action)
        action_name = ios_action.get("action", "deploy")
        tag = "IOS-TESTFLIGHT" if ok else "IOS-TESTFLIGHT-FAILED"
        journal_append(f"- {ts()} — [{tag}] {action_name}: {detail[:800]}")
        if action_name == "later":
            notify_macos("iOS TestFlight — left pending", detail, severity="info", replace_key="cartha-testflight-result")
        elif action_name == "skip":
            notify_macos("iOS TestFlight skipped", detail, severity="info", replace_key="cartha-testflight-result")
        elif ok:
            notify_macos("iOS TestFlight deploy queued", detail, severity="notable", replace_key="cartha-testflight-result")
        else:
            notify_macos(
                "iOS TestFlight deploy needs attention",
                detail,
                severity="warning",
                force_reply=True,
                reply_id=f"ios-tf-fail-{uuid.uuid4().hex[:8]}",
                actions=["Retry deploy iOS", "Skip", "Investigate"],
                replace_key="cartha-testflight-result",
            )
        return 0

    if trusted_autonomy_enabled(policy):
        direct_items = direct_user_task_items(reply_items)
        if direct_items:
            item = direct_items[0]
            source = _reply_source(item)
            voice_task = source in {"cartha-voice", "voice", "cartha-voice-reply", "voice-reply"} or str(item.get("mode") or "") == "followup"
            result = run_trusted_autonomy_task(item, user_content)
            status = str(result.get("status") or "unknown")
            severity = "warning" if status in {"blocked", "needs_approval"} else ("notable" if status == "partial" else "info")
            tag = {
                "completed": "AUTONOMY-COMPLETE",
                "partial": "AUTONOMY-PARTIAL",
                "needs_approval": "AUTONOMY-NEEDS-APPROVAL",
                "blocked": "AUTONOMY-BLOCKED",
            }.get(status, "AUTONOMY")
            message = format_autonomy_message(result)
            journal_append(f"- {ts()} — [{tag}] {_reply_text(item)[:160]} → {str(result.get('summary') or '')[:800]}")
            run_id = result.get("run_id")
            if run_id:
                journal_append(f"  ↳ run_id={run_id}")
            artifact_path = result.get("artifact_path")
            if artifact_path:
                journal_append(f"  ↳ artifact={artifact_path}")
            notify_macos(
                "Cartha Agent",
                message,
                severity=severity,
                force_reply=True,
                replace_key=("cartha-agent-voice" if voice_task else ""),
            )
            return 0

    t0 = time.time()
    try:
        resp = call_local(user_content)
    except Exception as e:
        print(f"ollama call failed: {e}", file=sys.stderr)
        journal_append(f"- {ts()} — heartbeat ERROR: ollama unreachable ({e})")
        return 1
    dt = time.time() - t0

    msg = resp.get("message", {})
    tool_calls = msg.get("tool_calls") or []
    print(f"phase={phase} model={MODEL} latency={dt:.1f}s tool_calls={len(tool_calls)}")

    name = ""
    args: dict = {}

    if tool_calls:
        tc = tool_calls[0]
        name = tc.get("function", {}).get("name", "")
        args = parse_args(tc.get("function", {}).get("arguments"))
    else:
        # qwen sometimes emits the tool call as raw JSON in content with 7 tools.
        # Try to recover by inferring tool from arg signature.
        content = (msg.get("content") or "").strip()
        inferred = infer_tool_from_content(content)
        if inferred:
            name, args = inferred
            print(f"recovered tool from content: {name}")
        else:
            print(f"WARN: no tool_calls; content fallback: {content[:200]!r}")
            if content and content.lower() not in {"ok", "ok."}:
                journal_append(f"- {ts()} — (no tool) {content[:200]}")
            return 0

    print(f"chosen tool: {name}  args: {json.dumps(args)[:300]}")

    if has_voice_followup(replies) and name in {"noop", "journal_entry", "notify_user"}:
        name = "escalate"
        args = {
            "reason": "Zack gave a voice follow-up reply. Continue the latest Cartha Agent exchange using recent heartbeat actions as context.",
            "urgency": "low",
        }
        print("overrode tool to escalate for voice follow-up reply")

    # --- non-destructive tools ---

    if name == "noop":
        return 0

    if name == "journal_entry":
        sev = args.get("severity", "info")
        summary = args.get("summary", "(no summary)")
        journal_append(f"- {ts()} — [{sev}] {summary}")
        if sev == "warning":
            notify_macos("Cartha Agent heartbeat", summary[:200], severity="warning")
        return 0

    if name == "notify_user":
        sev = args.get("severity", "info")
        title = args.get("title", "Cartha Agent heartbeat")
        message = args.get("message", "(no message)")
        afk = is_afk()
        rid = f"sug-{uuid.uuid4().hex[:8]}"
        notify_macos(title, message, severity=sev, persistent=False, reply_id=rid)
        afk_tag = " AFK→iMessage" if afk else ""
        reply_tag = " replyable" if sev == "warning" else ""
        journal_append(f"- {ts()} — [SUGGEST {sev}{afk_tag}{reply_tag} id={rid}] {title}: {message}")
        return 0

    if name == "show_visual":
        sev = args.get("severity", "info")
        title = args.get("title", "Cartha Agent visual")
        message = args.get("message", "(no message)")
        visual = args.get("visual") if isinstance(args.get("visual"), dict) else {}
        visual.setdefault("title", title)
        visual.setdefault("subtitle", message)
        visual.setdefault("severity", sev)
        image_path = render_visual(visual)
        blocking = bool(args.get("blocking", False)) or sev == "critical"
        rid = f"vis-{uuid.uuid4().hex[:8]}"
        notify_macos(
            title, message,
            severity=sev,
            persistent=blocking,
            reply_id=rid,
            image_path=image_path,
        )
        visual_tag = f" visual={image_path}" if image_path else " visual=render-failed"
        journal_append(f"- {ts()} — [VISUAL {sev} id={rid}{visual_tag}] {title}: {message}")
        return 0

    if name == "notify_user_dialog":
        title = args.get("title", "Cartha Agent — attention needed")
        message = args.get("message", "(no message)")
        reason = args.get("reason", "(no reason)")
        actions_arg = args.get("suggested_actions") or []
        if isinstance(actions_arg, str):
            try:
                actions_arg = json.loads(actions_arg)
            except Exception:
                actions_arg = [a.strip() for a in actions_arg.split(",") if a.strip()]
        if not isinstance(actions_arg, list):
            actions_arg = []
        afk = is_afk()
        rid = f"dlg-{uuid.uuid4().hex[:8]}"
        notify_macos(title, message, severity="warning", persistent=True,
                     reply_id=rid, actions=actions_arg)
        afk_tag = " AFK" if afk else ""
        chips_tag = f" chips={len(actions_arg)}" if actions_arg else ""
        journal_append(f"- {ts()} — [DIALOG{afk_tag}{chips_tag} id={rid}] {title}: {message} (reason: {reason})")
        return 0

    if name == "mark_job_done":
        job_id = args.get("job_id", "?")
        result = args.get("result", "")
        journal_append(f"- {ts()} — [job-done] {job_id}: {result}")
        return 0

    if name == "set_timer":
        delay = int(args.get("delay_seconds") or 0)
        title = args.get("title", "Timer")
        message = args.get("message", "")
        sev = args.get("severity", "notable")
        if delay <= 0 or delay > 86400:
            journal_append(f"- {ts()} — [TIMER-INVALID] delay={delay}s out of range (1..86400)")
            return 0
        # Spawn a fully detached bg process: sleep N, then fire the bubble.
        # Use a subshell + & so the process survives this script's exit
        # (it gets reparented to launchd).
        bubble = str(BUBBLE_BIN)
        sound_arg = '--sound Glass ' if sev == "warning" else ''
        safe_title = title.replace('"', "'")[:200]
        safe_msg = message.replace('"', "'")[:600]
        # Shell-quote our bubble invocation
        cmd = (
            f'( sleep {delay} && '
            f'"{bubble}" --title "{safe_title}" --message "{safe_msg}" '
            f'--severity {sev} {sound_arg}--duration 12 --replace-key cartha-agent-timer '
            f'</dev/null >/dev/null 2>&1 & )'
        )
        try:
            subprocess.Popen(
                ["bash", "-c", cmd],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            from datetime import timedelta
            fires_at = (datetime.now() + timedelta(seconds=delay)).strftime("%H:%M:%S")
            journal_append(f"- {ts()} — [TIMER {sev} delay={delay}s fires={fires_at}] {title}: {message}")
            # Also immediately confirm via bubble so the user knows it was scheduled
            notify_macos(
                title=f"Timer set ({delay}s)",
                message=f"{title} — fires at {fires_at}",
                severity="info",
            )
        except Exception as e:
            journal_append(f"- {ts()} — [TIMER-FAILED] {title}: {e}")
        return 0

    if name == "web_search":
        query = (args.get("query") or "").strip()
        answer = (args.get("answer") or query or "Web search").strip()
        max_results = int(args.get("max_results") or 5)
        ok, body = run_web_search(query, max_results)
        tag = "WEB-SEARCH" if ok else "WEB-SEARCH-FAILED"
        journal_append(f"- {ts()} — [{tag}] {answer} (q={query[:120]!r})")
        for line in body.split("\n"):
            if line.strip():
                journal_append(f"  ↳ {line[:300]}")
        if ok:
            # Surface a compact summary as a bubble so Zack actually sees the answer.
            rid = f"web-{uuid.uuid4().hex[:8]}"
            preview = body[:380]
            notify_macos(
                title=f"Web: {answer[:80]}",
                message=preview,
                severity="info",
                persistent=False,
                reply_id=rid,
            )
            journal_append(f"  ↳ surfaced to user via bubble (id={rid})")
        return 0

    if name == "safe_shell_query":
        label = (args.get("label") or "").strip()
        purpose = (args.get("purpose") or "(no purpose)").strip()
        ok, body = run_safe_shell_query(label)
        tag = "SHELL-QUERY" if ok else "SHELL-QUERY-FAILED"
        journal_append(f"- {ts()} — [{tag} label={label}] {purpose}")
        for line in body.split("\n")[:20]:
            if line.strip():
                journal_append(f"  ↳ {line[:300]}")
        # If this was triggered by a direct user task, also surface as a bubble.
        if has_direct_user_task(replies) and ok:
            rid = f"shq-{uuid.uuid4().hex[:8]}"
            preview = body[:380]
            notify_macos(
                title=f"{label}: {purpose[:60]}",
                message=preview,
                severity="info",
                persistent=False,
                reply_id=rid,
                replace_key=("cartha-agent-voice" if has_voice_user_task(replies) else ""),
            )
            journal_append(f"  ↳ surfaced to user via bubble (id={rid})")
        return 0

    if name == "fetch_url":
        url = (args.get("url") or "").strip()
        purpose = (args.get("purpose") or "(no purpose)").strip()
        ok, body = run_fetch_url(url)
        tag = "FETCH-URL" if ok else "FETCH-URL-FAILED"
        journal_append(f"- {ts()} — [{tag}] {purpose} ({url[:200]})")
        # Truncate body for journal — full content goes to bubble preview only if ok
        preview = body[:400].replace("\n", " ")
        journal_append(f"  ↳ {preview}")
        if has_direct_user_task(replies) and ok:
            rid = f"url-{uuid.uuid4().hex[:8]}"
            notify_macos(
                title=f"URL: {purpose[:60]}",
                message=body[:380],
                severity="info",
                persistent=False,
                reply_id=rid,
                replace_key=("cartha-agent-voice" if has_voice_user_task(replies) else ""),
            )
            journal_append(f"  ↳ surfaced to user via bubble (id={rid})")
        return 0

    if name == "read_calendar_today":
        purpose = (args.get("purpose") or "(no purpose)").strip()
        hours_ahead = max(1, min(int(args.get("hours_ahead") or 24), 24))
        # Build the ISO datetime window for "now to N hours from now"
        from datetime import timezone, timedelta
        now_utc = datetime.now(timezone.utc)
        start_iso = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        end_iso = (now_utc + timedelta(hours=hours_ahead)).strftime("%Y-%m-%dT%H:%M:%SZ")
        ok, body = call_ms365_mcp(
            "get-calendar-view",
            {"startDateTime": start_iso, "endDateTime": end_iso, "$top": 25, "$orderby": "start/dateTime"},
        )
        tag = "CALENDAR" if ok else "CALENDAR-FAILED"
        journal_append(f"- {ts()} — [{tag}] {purpose} (window={hours_ahead}h)")
        for line in body.split("\n")[:25]:
            if line.strip():
                journal_append(f"  ↳ {line[:300]}")
        if has_direct_user_task(replies):
            rid = f"cal-{uuid.uuid4().hex[:8]}"
            preview = body[:380] if ok else f"Calendar lookup failed: {body[:240]}"
            notify_macos(
                title=f"Calendar: {purpose[:60]}",
                message=preview,
                severity="info" if ok else "warning",
                persistent=False,
                reply_id=rid,
                replace_key=("cartha-agent-voice" if has_voice_user_task(replies) else ""),
            )
            journal_append(f"  ↳ surfaced to user via bubble (id={rid})")
        return 0

    if name == "read_mail_recent":
        purpose = (args.get("purpose") or "(no purpose)").strip()
        max_messages = max(1, min(int(args.get("max_messages") or 10), 20))
        unread_only = bool(args.get("unread_only"))
        mcp_args: dict = {"$top": max_messages, "$orderby": "receivedDateTime DESC"}
        if unread_only:
            mcp_args["$filter"] = "isRead eq false"
        ok, body = call_ms365_mcp("list-mail-messages", mcp_args)
        tag = "MAIL" if ok else "MAIL-FAILED"
        journal_append(f"- {ts()} — [{tag}] {purpose} (max={max_messages}, unread_only={unread_only})")
        for line in body.split("\n")[:25]:
            if line.strip():
                journal_append(f"  ↳ {line[:300]}")
        if has_direct_user_task(replies):
            rid = f"mail-{uuid.uuid4().hex[:8]}"
            preview = body[:380] if ok else f"Mail lookup failed: {body[:240]}"
            notify_macos(
                title=f"Mail: {purpose[:60]}",
                message=preview,
                severity="info" if ok else "warning",
                persistent=False,
                reply_id=rid,
                replace_key=("cartha-agent-voice" if has_voice_user_task(replies) else ""),
            )
            journal_append(f"  ↳ surfaced to user via bubble (id={rid})")
        return 0

    if name == "escalate":
        reason = args.get("reason", "(no reason)")
        urgency = args.get("urgency", "?")
        # If the user has just sent a direct Alfred/voice task, address them directly.
        direct_task_in_replies = has_direct_user_task(replies)
        voice_followup = has_voice_followup(replies)
        voice_task_in_replies = has_voice_user_task(replies)

        # --- pre-deepseek dedup: skip if we'd be saying the same thing as a recent escalation.
        # Only applies to autonomous (non-user-task) escalations — user tasks always need a response.
        if not direct_task_in_replies:
            current_fp = normalize_reason(reason)
            recent_fps = {normalize_reason(r) for r in recent_escalation_reasons(DEDUP_LOOKBACK_N)}
            if current_fp and current_fp in recent_fps:
                journal_append(
                    f"- {ts()} — [ESCALATE-SKIPPED-DEDUP urgency={urgency}] {reason} "
                    f"(matched a recent escalation fingerprint — skipping deepseek call)"
                )
                return 0
        if direct_task_in_replies:
            deeper_sys = (
                "You are the Cartha Agent, replying directly to Zack after he submitted a task. "
                "Return STRICT JSON only: {\"answer\":\"1-4 concise sentences to Zack\", "
                "\"visual\": null or {\"kind\":\"bar|line|progress|stat_grid\", ...}}. "
                "Use the system snapshot, activity, and pending jobs in the context to ground your answer when relevant. "
                "If the task is a voice follow-up reply, use RECENT HEARTBEAT ACTIONS as the conversation history and continue the latest Cartha Agent exchange; if the antecedent is unclear, ask one concise clarification. "
                "Use first person ('I checked...', 'I'd suggest...'). If the answer contains numbers, rankings, "
                "status/progress, costs, timings, memory/process/resource comparisons, or a multi-metric health summary, "
                "include a compact visual spec. For bar/line use labels+values; for progress use segments; for stat_grid use metrics. "
                "Set visual to null for pure text, simple acknowledgements, or anything that would be forced."
            )
        else:
            deeper_sys = (
                "You are the senior on-call agent. Summarize the situation in <=4 sentences "
                "and list the top 2-3 concrete next actions. No prose padding."
            )
        deeper = call_deepseek(
            deeper_sys,
            f"=== CONTEXT ===\n{user_content}\n\n=== JUNIOR ESCALATION REASON ===\n{reason}",
            max_tokens=(800 if direct_task_in_replies else 400),
        )
        if deeper:
            visual_path = ""
            surfaced_text = deeper.strip()
            if direct_task_in_replies:
                surfaced_text, visual_spec = parse_direct_answer(deeper)
                if visual_spec:
                    visual_spec.setdefault("title", "Cartha Agent")
                    visual_spec.setdefault("subtitle", surfaced_text[:180])
                    visual_spec.setdefault("severity", "info")
                    visual_path = render_visual(visual_spec)
            journal_append(f"- {ts()} — [ESCALATE urgency={urgency}] {reason}")
            journal_append(f"  ↳ deepseek: {surfaced_text[:800]}")
            # If this escalation is responding to a user task, surface deepseek's
            # answer in a bubble with an inline reply field so they can follow up.
            if direct_task_in_replies:
                rid = f"resp-{uuid.uuid4().hex[:8]}"
                notify_macos(
                    title="Cartha Agent",
                    message=surfaced_text,
                    severity="info",
                    persistent=False,
                    force_reply=True,
                    reply_id=rid,
                    image_path=visual_path,
                    replace_key=("cartha-agent-voice" if voice_task_in_replies else ""),
                )
                visual_tag = f" visual={visual_path}" if visual_path else ""
                follow_tag = " followup" if voice_followup else ""
                journal_append(f"  ↳ surfaced to user via bubble (id={rid}{visual_tag}{follow_tag})")
        else:
            journal_append(f"- {ts()} — [ESCALATE-FALLBACK urgency={urgency}] {reason} (deepseek unreachable)")
            if direct_task_in_replies:
                # Fall-back: surface a "couldn't reach the strong model" bubble so the user isn't left hanging
                notify_macos(
                    title="Cartha Agent — couldn't reach deepseek",
                    message=f"I tried to answer but the OpenRouter call failed. Reason qwen logged: {reason[:300]}",
                    severity="info",
                    persistent=False,
                    force_reply=True,
                    replace_key=("cartha-agent-voice" if voice_task_in_replies else ""),
                )
        return 0

    # --- destructive tools ---

    if name == "propose_quit_app":
        app = args.get("app_name", "")
        rss = args.get("rss_mb", 0)
        reason = args.get("reason", "(no reason)")

        # Hard safety: denylist always wins
        if app in denylist:
            journal_append(f"- {ts()} — [BLOCKED-QUIT] {app}: on denylist ({reason})")
            return 0
        if app not in allowlist:
            journal_append(f"- {ts()} — [BLOCKED-QUIT] {app}: not on allowlist ({reason})")
            return 0

        if phase == 1:
            journal_append(f"- {ts()} — [DRYRUN-QUIT] {app} rss={rss}MB — {reason}")
            return 0

        if phase >= 3:
            ok, detail = quit_app_macos(app)
            tag = "QUIT" if ok else "QUIT-FAILED"
            journal_append(f"- {ts()} — [{tag}-P3] {app} rss={rss}MB — {reason} ({detail})")
            return 0

        # Phase 2: second opinion
        proposal = f"Quit GUI app '{app}' (RSS={rss}MB on the allowlist). Reason: {reason}"
        confirmed, opinion = second_opinion(user_content, proposal)
        if confirmed:
            ok, detail = quit_app_macos(app)
            tag = "QUIT" if ok else "QUIT-FAILED"
            journal_append(f"- {ts()} — [{tag}] {app} rss={rss}MB — {reason} ({detail}) [deepseek: {opinion[:200]}]")
        else:
            journal_append(f"- {ts()} — [VETOED-QUIT] {app} rss={rss}MB — {reason} [deepseek: {opinion[:200]}]")
        return 0

    if name == "propose_cleanup":
        action = args.get("action", "")
        expected = args.get("expected_freed_mb", 0)
        reason = args.get("reason", "(no reason)")

        if action not in enabled_cleanups:
            journal_append(f"- {ts()} — [BLOCKED-CLEANUP] {action}: not in enabled_actions ({reason})")
            return 0

        if phase == 1:
            journal_append(f"- {ts()} — [DRYRUN-CLEANUP] {action} expected~{expected}MB — {reason}")
            return 0

        if phase >= 3:
            ok, detail = run_cleanup(action)
            tag = "CLEANUP" if ok else "CLEANUP-FAILED"
            journal_append(f"- {ts()} — [{tag}-P3] {action} — {reason} ({detail})")
            return 0

        # Phase 2: second opinion
        proposal = f"Run cleanup action '{action}' (expected to free ~{expected}MB). Reason: {reason}"
        confirmed, opinion = second_opinion(user_content, proposal)
        if confirmed:
            ok, detail = run_cleanup(action)
            tag = "CLEANUP" if ok else "CLEANUP-FAILED"
            journal_append(f"- {ts()} — [{tag}] {action} — {reason} ({detail}) [deepseek: {opinion[:200]}]")
        else:
            journal_append(f"- {ts()} — [VETOED-CLEANUP] {action} — {reason} [deepseek: {opinion[:200]}]")
        return 0

    print(f"WARN: unknown tool {name!r}; args={args}")
    journal_append(f"- {ts()} — heartbeat WARN: unknown tool {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
