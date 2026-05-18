#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
WORKSPACE_DIR="${HERMES_WORKSPACE_DIR:-$HOME/hermes-workspace}"

read_env_value() {
  local name="$1"
  local file="$HERMES_HOME/.env"
  [ -f "$file" ] || return 0
  awk -F= -v key="$name" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

API_KEY="${API_SERVER_KEY:-}"
if [ -z "$API_KEY" ]; then API_KEY="$(read_env_value API_SERVER_KEY)"; fi

export HERMES_HOME
export HERMES_API_URL="${HERMES_API_URL:-http://127.0.0.1:8642}"
export HERMES_DASHBOARD_URL="${HERMES_DASHBOARD_URL:-http://127.0.0.1:9119}"
# Hermes Workspace calls this token HERMES_API_TOKEN / CLAUDE_API_TOKEN,
# while Hermes Agent's API server calls the same value API_SERVER_KEY.
export HERMES_API_TOKEN="${HERMES_API_TOKEN:-${CLAUDE_API_TOKEN:-$API_KEY}}"
export CLAUDE_API_TOKEN="${CLAUDE_API_TOKEN:-$HERMES_API_TOKEN}"
export API_SERVER_KEY="${API_SERVER_KEY:-$HERMES_API_TOKEN}"
export PATH="${PNPM_PATH:-$HOME/.npm-global/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}:$PATH"

if [ ! -d "$WORKSPACE_DIR" ]; then
  echo "Hermes Workspace not found at $WORKSPACE_DIR" >&2
  echo "Run: node scripts/install.mjs --clone" >&2
  exit 1
fi

cd "$WORKSPACE_DIR"
exec pnpm dev
