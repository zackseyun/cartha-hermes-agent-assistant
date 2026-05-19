#!/usr/bin/env python3
"""Durable local task/event ledger for Cartha Agent.

This is the small "external OS" layer for Hermes/Cartha tasks. It writes an
append-only event stream plus a compact task mirror that UI clients can read
without needing SQLite bindings. SQLite is still the authoritative local DB
when available; JSON mirrors make the runtime inspectable from Node, shell, and
future tools.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HOME = Path.home()
RUNTIME_DIR = Path(os.environ.get("HERMES_RUNTIME_DIR", str(HOME / ".hermes" / "runtime"))).expanduser()
DB_PATH = RUNTIME_DIR / "hermes.db"
TASKS_JSON = RUNTIME_DIR / "tasks.json"
EVENTS_JSONL = RUNTIME_DIR / "events.jsonl"
TASKS_DIR = RUNTIME_DIR / "tasks"
EVENTS_DIR = RUNTIME_DIR / "events"

TERMINAL_STATUSES = {"completed", "partial", "blocked", "needs_approval", "failed", "cancelled"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def clean_id(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "_.:-" else "-" for ch in (value or "").strip())[:160]


def parse_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def ensure_runtime() -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    TASKS_DIR.mkdir(parents=True, exist_ok=True)
    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        RUNTIME_DIR.chmod(0o700)
        TASKS_DIR.chmod(0o700)
        EVENTS_DIR.chmod(0o700)
    except Exception:
        pass


def connect() -> sqlite3.Connection:
    ensure_runtime()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '',
          mode TEXT NOT NULL DEFAULT 'task',
          task_text TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'queued',
          cwd TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          run_id TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          details TEXT NOT NULL DEFAULT '',
          next_steps_json TEXT NOT NULL DEFAULT '[]',
          artifact_path TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          event_count INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          task_id TEXT NOT NULL,
          run_id TEXT NOT NULL DEFAULT '',
          item_id TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}'
        )
        """
    )
    return conn


def row_to_task(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "source": row["source"],
        "mode": row["mode"],
        "task_text": row["task_text"],
        "status": row["status"],
        "cwd": row["cwd"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "run_id": row["run_id"],
        "summary": row["summary"],
        "details": row["details"],
        "next_steps": parse_json(row["next_steps_json"], []),
        "artifact_path": row["artifact_path"],
        "metadata": parse_json(row["metadata_json"], {}),
        "event_count": row["event_count"],
    }


def row_to_event(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "seq": row["seq"],
        "ts": row["ts"],
        "task_id": row["task_id"],
        "run_id": row["run_id"],
        "item_id": row["item_id"],
        "type": row["type"],
        "status": row["status"],
        "title": row["title"],
        "payload": parse_json(row["payload_json"], {}),
    }


def atomic_write_json(path: Path, value: Any) -> None:
    ensure_runtime()
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp_name, path)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def append_jsonl(path: Path, value: Any) -> None:
    ensure_runtime()
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def task_file_path(task_id: str) -> Path:
    return TASKS_DIR / f"{clean_id(task_id)}.json"


def events_file_path(task_id: str) -> Path:
    return EVENTS_DIR / f"{clean_id(task_id)}.jsonl"


def refresh_task_file(conn: sqlite3.Connection, task_id: str) -> None:
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (clean_id(task_id),)).fetchone()
    if row:
        atomic_write_json(task_file_path(task_id), row_to_task(row))


def refresh_task_mirror(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT * FROM tasks ORDER BY updated_at DESC, created_at DESC LIMIT 200").fetchall()
    atomic_write_json(TASKS_JSON, [row_to_task(row) for row in rows])


def append_event(
    conn: sqlite3.Connection,
    *,
    task_id: str,
    event_type: str,
    status: str = "",
    title: str = "",
    payload: dict[str, Any] | None = None,
    run_id: str = "",
    item_id: str = "",
    ts: str | None = None,
) -> dict[str, Any]:
    ts = ts or now_iso()
    payload = payload or {}
    task_id = clean_id(task_id)
    if not task_id:
        raise SystemExit("task id is required")
    conn.execute(
        """
        INSERT INTO events (ts, task_id, run_id, item_id, type, status, title, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (ts, task_id, run_id or "", item_id or "", event_type, status or "", title or "", json.dumps(payload, ensure_ascii=False)),
    )
    seq = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
    conn.execute(
        """
        UPDATE tasks
        SET updated_at=?, event_count=event_count+1,
            started_at=COALESCE(started_at, CASE WHEN ? IN ('running','in_progress','started') THEN ? ELSE NULL END),
            run_id=CASE WHEN ? != '' THEN ? ELSE run_id END
        WHERE id=?
        """,
        (ts, status, ts, run_id or "", run_id or "", task_id),
    )
    event = {"seq": seq, "ts": ts, "task_id": task_id, "run_id": run_id or "", "item_id": item_id or "", "type": event_type, "status": status or "", "title": title or "", "payload": payload}
    append_jsonl(EVENTS_JSONL, event)
    append_jsonl(events_file_path(task_id), event)
    refresh_task_file(conn, task_id)
    return event


def create_task(args: argparse.Namespace) -> dict[str, Any]:
    ts = args.ts or now_iso()
    task_id = clean_id(args.id)
    if not task_id:
        raise SystemExit("--id is required")
    metadata = parse_json(args.metadata_json, {})
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO tasks (id, title, source, mode, task_text, status, cwd, created_at, updated_at, metadata_json)
            VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title=excluded.title,
              source=excluded.source,
              mode=excluded.mode,
              task_text=excluded.task_text,
              cwd=excluded.cwd,
              updated_at=excluded.updated_at,
              metadata_json=excluded.metadata_json
            """,
            (task_id, args.title or "Cartha Agent task", args.source or "unknown", args.mode or "task", args.text or "", args.cwd or "", ts, ts, json.dumps(metadata, ensure_ascii=False)),
        )
        event = append_event(conn, task_id=task_id, event_type="task.created", status="queued", title=args.title or "Cartha Agent task", payload={"source": args.source, "mode": args.mode, "text": args.text}, ts=ts)
        refresh_task_mirror(conn)
        return {"ok": True, "task_id": task_id, "event": event}


def event_cmd(args: argparse.Namespace) -> dict[str, Any]:
    payload = parse_json(args.payload_json, {})
    with connect() as conn:
        task_id = clean_id(args.task_id)
        existing = conn.execute("SELECT id FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not existing:
            ts = args.ts or now_iso()
            conn.execute(
                "INSERT INTO tasks (id, title, source, mode, task_text, status, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, '', 'running', '', ?, ?)",
                (task_id, args.title or args.type, "runtime", "task", ts, ts),
            )
        event = append_event(conn, task_id=task_id, event_type=args.type, status=args.status or "", title=args.title or "", payload=payload, run_id=args.run_id or "", item_id=args.item_id or "", ts=args.ts or None)
        if args.status in {"running", "in_progress", "started"}:
            conn.execute("UPDATE tasks SET status='running', updated_at=?, run_id=CASE WHEN ? != '' THEN ? ELSE run_id END WHERE id=?", (event["ts"], args.run_id or "", args.run_id or "", task_id))
        refresh_task_mirror(conn)
        return {"ok": True, "event": event}


def finish_task(args: argparse.Namespace) -> dict[str, Any]:
    ts = args.ts or now_iso()
    task_id = clean_id(args.task_id)
    next_steps = parse_json(args.next_steps_json, [])
    status = args.status or "completed"
    payload = {
        "summary": args.summary or "",
        "details": args.details or "",
        "next_steps": next_steps,
        "artifact_path": args.artifact_path or "",
    }
    with connect() as conn:
        existing = conn.execute("SELECT id FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO tasks (id, title, source, mode, task_text, status, cwd, created_at, updated_at) VALUES (?, ?, 'runtime', 'task', '', 'running', '', ?, ?)",
                (task_id, args.title or "Cartha task", ts, ts),
            )
        conn.execute(
            """
            UPDATE tasks
            SET status=?, updated_at=?, completed_at=?, run_id=CASE WHEN ? != '' THEN ? ELSE run_id END,
                summary=?, details=?, next_steps_json=?, artifact_path=?
            WHERE id=?
            """,
            (status, ts, ts if status in TERMINAL_STATUSES else None, args.run_id or "", args.run_id or "", args.summary or "", args.details or "", json.dumps(next_steps, ensure_ascii=False), args.artifact_path or "", task_id),
        )
        event = append_event(conn, task_id=task_id, event_type="task.finished", status=status, title=args.title or status, payload=payload, run_id=args.run_id or "", ts=ts)
        refresh_task_mirror(conn)
        return {"ok": True, "task_id": task_id, "event": event}


def list_tasks(args: argparse.Namespace) -> dict[str, Any]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM tasks ORDER BY updated_at DESC, created_at DESC LIMIT ?", (args.limit,)).fetchall()
        return {"ok": True, "tasks": [row_to_task(row) for row in rows]}


def timeline(args: argparse.Namespace) -> dict[str, Any]:
    task_id = clean_id(args.task_id)
    with connect() as conn:
        task_row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        rows = conn.execute("SELECT * FROM events WHERE task_id=? ORDER BY seq ASC LIMIT ?", (task_id, args.limit)).fetchall()
        return {"ok": True, "task": row_to_task(task_row) if task_row else None, "events": [row_to_event(row) for row in rows]}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Write/read Hermes durable runtime events")
    sub = parser.add_subparsers(dest="cmd", required=True)

    create = sub.add_parser("create-task")
    create.add_argument("--id", required=True)
    create.add_argument("--title", default="Cartha Agent task")
    create.add_argument("--source", default="unknown")
    create.add_argument("--mode", default="task")
    create.add_argument("--text", default="")
    create.add_argument("--cwd", default="")
    create.add_argument("--metadata-json", default="{}")
    create.add_argument("--ts", default="")
    create.set_defaults(func=create_task)

    event = sub.add_parser("event")
    event.add_argument("--task-id", required=True)
    event.add_argument("--type", required=True)
    event.add_argument("--status", default="")
    event.add_argument("--title", default="")
    event.add_argument("--payload-json", default="{}")
    event.add_argument("--run-id", default="")
    event.add_argument("--item-id", default="")
    event.add_argument("--ts", default="")
    event.set_defaults(func=event_cmd)

    finish = sub.add_parser("finish-task")
    finish.add_argument("--task-id", required=True)
    finish.add_argument("--status", default="completed")
    finish.add_argument("--summary", default="")
    finish.add_argument("--details", default="")
    finish.add_argument("--next-steps-json", default="[]")
    finish.add_argument("--artifact-path", default="")
    finish.add_argument("--run-id", default="")
    finish.add_argument("--title", default="")
    finish.add_argument("--ts", default="")
    finish.set_defaults(func=finish_task)

    ls = sub.add_parser("list-tasks")
    ls.add_argument("--limit", type=int, default=50)
    ls.set_defaults(func=list_tasks)

    tl = sub.add_parser("timeline")
    tl.add_argument("--task-id", required=True)
    tl.add_argument("--limit", type=int, default=200)
    tl.set_defaults(func=timeline)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    result = args.func(args)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
