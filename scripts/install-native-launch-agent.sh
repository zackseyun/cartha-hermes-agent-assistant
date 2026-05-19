#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_BUNDLE="$ROOT/native/dist/Cartha Hermes.app"
APP_BUNDLE="/Applications/Cartha Hermes.app"
PLIST="$HOME/Library/LaunchAgents/com.cartha.hermes-native.plist"
LABEL="com.cartha.hermes-native"

if [[ ! -x "$BUILD_BUNDLE/Contents/MacOS/CarthaHermesNative" ]]; then
  "$ROOT/scripts/build-native-app.sh"
fi

# Install the user-facing app into /Applications. Keep native/dist as the
# reproducible build output, but launch the installed app everywhere.
rm -rf "$APP_BUNDLE"
ditto "$BUILD_BUNDLE" "$APP_BUNDLE"
xattr -dr com.apple.quarantine "$APP_BUNDLE" >/dev/null 2>&1 || true
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || true
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.hermes/logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>$APP_BUNDLE</string>
    <string>--args</string>
    <string>--bubble-only</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/.hermes/logs/hermes-native.log</string>
  <key>StandardErrorPath</key><string>$HOME/.hermes/logs/hermes-native.err.log</string>
</dict>
</plist>
PLIST

uid="$(id -u)"
launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$PLIST"
# Bootstrap may RunAtLoad the quiet login bubble immediately. Stop any old
# instance, then open the app manually so the full panel is visible right now.
for _ in 1 2 3 4 5; do
  while IFS= read -r pid; do
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" == *"Cartha Hermes.app/Contents/MacOS/CarthaHermesNative"* ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done < <(pgrep -x CarthaHermesNative || true)
  sleep 0.3
done
/usr/bin/open "$APP_BUNDLE"
echo "Installed and opened $APP_BUNDLE"
