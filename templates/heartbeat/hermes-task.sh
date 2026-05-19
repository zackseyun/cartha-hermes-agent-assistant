#!/usr/bin/env bash
# hermes-task — submit an ad-hoc task to the Cartha Agent heartbeat.
#
# Usage:
#   hermes-task.sh "what's the weather"
#   echo "summarize this" | hermes-task.sh
#
# Mechanism: writes the task as a direct user reply into the heartbeat
# reply queue, then fires heartbeat.sh in the background (detached). The
# agent picks it up within ~5-10s and responds via journal + (if it chooses)
# a notification bubble. Reuses the same fast-path plumbing as bubble replies.
#
# Prints a one-line confirmation to stdout so Alfred can show it.

set -u

# Invocation breadcrumb — proves the script was reached (Alfred firing, terminal, etc.)
echo "$(date -Iseconds) src=${CARTHA_TASK_SOURCE:-${HERMES_TASK_SOURCE:-cli}} argv=$* pwd=$(pwd)" >> /tmp/hermes-task-invocations.log

TASK="${1:-}"
# Allow piped input as fallback
if [[ -z "$TASK" && ! -t 0 ]]; then
  TASK="$(cat)"
fi
if [[ -z "$TASK" ]]; then
  echo "usage: hermes-task.sh <task text>  (or pipe text on stdin)" >&2
  exit 1
fi

REPLIES_FILE="$HOME/.hermes/heartbeat-replies.jsonl"
HEARTBEAT_SH="$HOME/.hermes/scripts/heartbeat.sh"
RUNTIME_EVENT_PY="$HOME/.hermes/scripts/hermes-runtime-event.py"

mkdir -p "$(dirname "$REPLIES_FILE")"

ID_PREFIX="${CARTHA_TASK_ID_PREFIX:-task}"
TASK_TITLE="${CARTHA_TASK_TITLE:-Cartha Agent task}"
TASK_MODE="${CARTHA_TASK_MODE:-task}"
CONFIRM_PREFIX="${CARTHA_TASK_CONFIRM_PREFIX:-Cartha Agent queued:}"
ID="${ID_PREFIX}-$(date +%s)-$(printf '%04x' "$RANDOM")"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Create a durable runtime task first. This is best-effort so Alfred/voice
# still work if the new ledger is temporarily unavailable.
if [[ -x "$RUNTIME_EVENT_PY" ]]; then
  "$RUNTIME_EVENT_PY" create-task \
    --id "$ID" \
    --title "$TASK_TITLE" \
    --source "${HERMES_TASK_SOURCE:-${CARTHA_TASK_SOURCE:-alfred}}" \
    --mode "$TASK_MODE" \
    --text "$TASK" \
    --cwd "$(pwd)" >/dev/null 2>>/tmp/hermes-runtime-event.err || true
fi

# Append a JSON line. Use Python so we don't have to hand-escape the task text.
TS="$TS" ID="$ID" TASK_TITLE="$TASK_TITLE" TASK_MODE="$TASK_MODE" python3 - "$TASK" >> "$REPLIES_FILE" <<'PY'
import json, os, sys
print(json.dumps({
  "ts": os.environ["TS"],
  "id": os.environ["ID"],
  "runtime_task_id": os.environ["ID"],
  "title": os.environ.get("TASK_TITLE", "Cartha Agent task"),
  "severity": "info",
  "reply": sys.argv[1],
  "source": os.environ.get("HERMES_TASK_SOURCE") or os.environ.get("CARTHA_TASK_SOURCE", "alfred"),
  "mode": os.environ.get("TASK_MODE", "task"),
}))
PY

# Fast path: fire heartbeat in background, fully detached.
( "$HEARTBEAT_SH" </dev/null >/dev/null 2>&1 & )

# Alfred-visible confirmation (shows in the macOS notification banner if
# Alfred's "Post Notification" output node is wired up).
SHORT="${TASK:0:80}"
echo "$CONFIRM_PREFIX $SHORT"
