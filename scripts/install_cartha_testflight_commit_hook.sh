#!/usr/bin/env bash
set -euo pipefail
MOBILE_REPO="${CARTHA_MOBILE_REPO:-/Users/zackseyun/My Drive/Moltbot-Shared/Documents/GitHub/cartha.ai.mobile}"
HERMES_LOCAL_REPO="${CARTHA_HERMES_LOCAL_REPO:-/Users/zackseyun/My Drive/Moltbot-Shared/Documents/GitHub/cartha.hermes.local}"
HOOK="$MOBILE_REPO/.git/hooks/post-commit"
LOG_DIR="$HOME/.hermes/logs"
mkdir -p "$(dirname "$HOOK")" "$LOG_DIR"
cat > "$HOOK" <<HOOK
#!/usr/bin/env bash
set -euo pipefail
sha=\$(git rev-parse HEAD 2>/dev/null || true)
[ -n "\$sha" ] || exit 0
(
  cd "$MOBILE_REPO"
  node "$HERMES_LOCAL_REPO/scripts/testflight_proposal_watcher.mjs" --commit "\$sha" --pending
) >> "$LOG_DIR/cartha-testflight-commit-prompt.log" 2>&1 &
HOOK
chmod +x "$HOOK"
echo "Installed TestFlight post-commit hook at $HOOK"
