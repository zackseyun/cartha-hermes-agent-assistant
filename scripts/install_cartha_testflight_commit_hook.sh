#!/usr/bin/env bash
set -euo pipefail
MOBILE_REPO="${CARTHA_MOBILE_REPO:-/Users/zackseyun/My Drive/Moltbot-Shared/Documents/GitHub/cartha.ai.mobile}"
HERMES_LOCAL_REPO="${CARTHA_HERMES_LOCAL_REPO:-/Users/zackseyun/My Drive/Moltbot-Shared/Documents/GitHub/cartha.hermes.local}"
HOOK_DIR="$MOBILE_REPO/.git/hooks"
HELPER="$HOOK_DIR/cartha-hermes-upload-proposal"
LOG_DIR="$HOME/.hermes/logs"
mkdir -p "$HOOK_DIR" "$LOG_DIR"

cat > "$HELPER" <<HOOK
#!/usr/bin/env bash
set -euo pipefail
sha="\${1:-}"
[ -n "\$sha" ] || sha=\$(git rev-parse HEAD 2>/dev/null || true)
[ -n "\$sha" ] || exit 0
case "\$sha" in
  0000000000000000000000000000000000000000) exit 0 ;;
esac
node_bin="\${CARTHA_NODE_BIN:-\$(command -v node || true)}"
[ -n "\$node_bin" ] || exit 0
nohup /bin/bash -c '
  set -euo pipefail
  cd "\$1"
  exec "\$2" "\$3/scripts/testflight_proposal_watcher.mjs" --commit "\$4" --pending
' cartha-hermes-hook "$MOBILE_REPO" "\$node_bin" "$HERMES_LOCAL_REPO" "\$sha" >> "$LOG_DIR/cartha-testflight-commit-prompt.log" 2>&1 < /dev/null &
HOOK
chmod +x "$HELPER"

for hook_name in post-commit post-merge post-rewrite; do
  hook="$HOOK_DIR/$hook_name"
  cat > "$hook" <<HOOK
#!/usr/bin/env bash
set -euo pipefail
"$HELPER"
HOOK
  chmod +x "$hook"
done

cat > "$HOOK_DIR/pre-push" <<HOOK
#!/usr/bin/env bash
set -euo pipefail
queued=0
while read -r local_ref local_sha remote_ref remote_sha; do
  if [ "\$local_ref" = "refs/heads/main" ] || [ "\$remote_ref" = "refs/heads/main" ]; then
    "$HELPER" "\$local_sha"
    queued=1
  fi
done
if [ "\$queued" = "0" ]; then
  "$HELPER"
fi
HOOK
chmod +x "$HOOK_DIR/pre-push"

echo "Installed Hermes Apple upload proposal hooks in $HOOK_DIR"
echo "Hooks covered: post-commit, post-merge, post-rewrite, pre-push"
