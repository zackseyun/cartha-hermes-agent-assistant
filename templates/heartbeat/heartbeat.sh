#!/usr/bin/env bash
# Hermes 30-min agentic heartbeat (Phase 2: system custodian with deepseek concurrence).
#
# Gathers:
#   1. Recent local activity (last 30m via logs.sh)
#   2. OpenClaw PERSONAL_CONTEXT.md (cached if SSH fails)
#   3. Pending agent-sync jobs on EC2
#   4. System state snapshot (memory, top procs, cleanup-target sizes)
#
# Pipes JSON to heartbeat-agent.py which calls qwen3.6:35b-hermes-256k with tool calling.
# Destructive tool calls (quit_app, cleanup) are gated by:
#   - Policy allow/denylist (~/.hermes/heartbeat-config/policy.json)
#   - Deepseek-v4-flash second opinion (Phase 2)
#
# Per-run log: /tmp/hermes-heartbeat.log (overwrite)
# Durable journal: ~/.hermes/heartbeat-journal.md (append)
#
# Env overrides:
#   HEARTBEAT_MODEL              (default qwen3.6:35b-hermes-256k)
#   HEARTBEAT_KEEP_ALIVE         (default 15m)
#   HEARTBEAT_PHASE              (override policy.json phase; 1/2/3)
#   HEARTBEAT_ESCALATION_MODEL   (default deepseek/deepseek-v4-flash)

set -u
exec >/tmp/hermes-heartbeat.log 2>&1

# Note: ~/.hermes/.env contains some values with unquoted spaces, so we don't
# bash-source it. The Python agent reads .env directly for the keys it needs.

if ! command -v timeout >/dev/null 2>&1; then
  timeout() {
    local seconds="$1"
    shift
    python3 - "$seconds" "$@" <<'PY'
import subprocess
import sys

seconds = float(sys.argv[1])
cmd = sys.argv[2:]

try:
    result = subprocess.run(cmd, timeout=seconds)
except subprocess.TimeoutExpired:
    sys.exit(124)
sys.exit(result.returncode)
PY
  }
fi

LOGS_SH="$HOME/scripts/logs.sh"
CACHE_DIR="$HOME/.hermes/cache"
AGENT_PY="$HOME/.hermes/scripts/heartbeat-agent.py"
SYSTEM_SH="$HOME/.hermes/scripts/heartbeat-system.sh"
mkdir -p "$CACHE_DIR"

echo "=== heartbeat $(date -Iseconds) ==="

# --- 1. Recent local activity ---
ACTIVITY="$(timeout 25 "$LOGS_SH" since 30m 2>/dev/null | head -n 50)"
[[ -z "$ACTIVITY" ]] && ACTIVITY="(no activity in last 30m)"

# --- 2. OpenClaw PERSONAL_CONTEXT.md ---
CONTEXT_REMOTE="$(timeout 20 ssh -o BatchMode=yes -o ConnectTimeout=8 openclaw \
  'cat /home/ec2-user/clawd/shared/PERSONAL_CONTEXT.md' 2>/dev/null)"
if [[ -n "$CONTEXT_REMOTE" ]]; then
  printf '%s\n' "$CONTEXT_REMOTE" > "$CACHE_DIR/personal-context.md"
fi
CONTEXT="$(head -n 50 "$CACHE_DIR/personal-context.md" 2>/dev/null \
  || echo '(no personal context cached)')"

# --- 3. Pending Hermes/Claude jobs on EC2 ---
PENDING="$(timeout 20 ssh -o BatchMode=yes -o ConnectTimeout=8 openclaw '
  cd /home/ec2-user/clawd/shared/agent-sync/jobs 2>/dev/null || exit 0
  find . -maxdepth 2 -name "*.json" -mtime -7 -type f 2>/dev/null | while read -r f; do
    python3 -c "
import json,sys
try:
    d=json.load(open(\"$f\"))
    if d.get(\"status\")==\"pending\" and d.get(\"to\") in (\"hermes\",\"claude\"):
        print(f\"{d.get(\"id\",\"?\")}\t{d.get(\"to\",\"?\")}\t{d.get(\"priority\",\"\")}\t{d.get(\"description\",\"\")[:120]}\")
except Exception:
    pass
" 2>/dev/null
  done | head -n 50
' 2>/dev/null)"
[[ -z "$PENDING" ]] && PENDING="(no pending jobs)"

# --- 4. System state snapshot ---
SYSTEM_STATE="$(timeout 25 bash "$SYSTEM_SH" 2>/dev/null)"
[[ -z "$SYSTEM_STATE" ]] && SYSTEM_STATE="(system snapshot unavailable)"

# --- 5. Recent heartbeat journal entries (anti-loop awareness) ---
RECENT_ACTIONS="$(tail -n 10 "$HOME/.hermes/heartbeat-journal.md" 2>/dev/null)"
[[ -z "$RECENT_ACTIONS" ]] && RECENT_ACTIONS="(no prior heartbeat actions)"

# --- 6. Drain user-reply queue from the bubble (atomic: rename, then read) ---
REPLIES_QUEUE="$HOME/.hermes/heartbeat-replies.jsonl"
REPLIES_ARCHIVE="$HOME/.hermes/heartbeat-replies-processed.jsonl"
REPLIES_CONTENT=""
if [[ -s "$REPLIES_QUEUE" ]]; then
  # Move first so concurrent bubble writes go into a fresh file
  REPLIES_TMP="$(mktemp -t hermes-replies)"
  mv "$REPLIES_QUEUE" "$REPLIES_TMP"
  REPLIES_CONTENT="$(cat "$REPLIES_TMP")"
  cat "$REPLIES_TMP" >> "$REPLIES_ARCHIVE"
  rm -f "$REPLIES_TMP"
fi
[[ -z "$REPLIES_CONTENT" ]] && REPLIES_CONTENT="(no user replies in queue)"

# --- 7. Hand off to Python agent via stdin JSON ---
python3 -c '
import json, sys
print(json.dumps({
  "activity":       sys.argv[1],
  "context":        sys.argv[2],
  "pending":        sys.argv[3],
  "system":         sys.argv[4],
  "recent_actions": sys.argv[5],
  "replies":        sys.argv[6],
}))
' "$ACTIVITY" "$CONTEXT" "$PENDING" "$SYSTEM_STATE" "$RECENT_ACTIONS" "$REPLIES_CONTENT" | python3 "$AGENT_PY"

RC=$?
echo "=== done $(date -Iseconds) rc=$RC ==="
exit $RC
