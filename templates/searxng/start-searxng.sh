#!/usr/bin/env bash
# Cartha Hermes Agent Assistant — SearXNG web search backend.
#
# Stands up a localhost-only SearXNG instance for the heartbeat agent's
# `web_search` tool. Idempotent — safe to re-run.
#
# Requires: docker (Colima or Docker Desktop) running.

set -euo pipefail

CONFIG_DIR="${SEARXNG_CONFIG_DIR:-$HOME/.hermes/searxng}"
SETTINGS="$CONFIG_DIR/settings.yml"
TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/settings.yml"
CONTAINER="${SEARXNG_CONTAINER:-cartha-searxng}"
HOST_PORT="${SEARXNG_HOST_PORT:-8888}"

mkdir -p "$CONFIG_DIR"

# Seed settings.yml on first run with a real secret key.
if [[ ! -f "$SETTINGS" ]]; then
  echo "[searxng] seeding $SETTINGS from template"
  cp "$TEMPLATE" "$SETTINGS"
  SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
  # macOS sed needs -i ''; GNU sed accepts -i. Use a portable Python rewrite.
  python3 -c "
import sys, pathlib
p = pathlib.Path('$SETTINGS')
p.write_text(p.read_text().replace('REPLACE_AT_INSTALL', '$SECRET'))
"
  chmod 0644 "$SETTINGS"
fi

# Ensure docker is reachable.
if ! docker info >/dev/null 2>&1; then
  echo "[searxng] docker daemon unreachable — start Colima or Docker Desktop first" >&2
  echo "[searxng]   colima start" >&2
  exit 1
fi

# Idempotent container management.
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[searxng] container '$CONTAINER' exists — restarting"
  docker restart "$CONTAINER" >/dev/null
else
  echo "[searxng] creating container '$CONTAINER' on 127.0.0.1:$HOST_PORT"
  docker pull searxng/searxng:latest >/dev/null
  docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    -p "127.0.0.1:${HOST_PORT}:8080" \
    -v "$CONFIG_DIR:/etc/searxng:rw" \
    --label "ai.cartha.service=searxng" \
    --label "ai.cartha.purpose=heartbeat web search backend" \
    searxng/searxng:latest >/dev/null
fi

# Wait for readiness.
for i in {1..15}; do
  if curl -sf --max-time 2 "http://127.0.0.1:${HOST_PORT}/" >/dev/null; then
    echo "[searxng] ready at http://127.0.0.1:${HOST_PORT} (took ${i}s)"
    exit 0
  fi
  sleep 1
done

echo "[searxng] container started but did not become ready within 15s — check 'docker logs $CONTAINER'" >&2
exit 1
