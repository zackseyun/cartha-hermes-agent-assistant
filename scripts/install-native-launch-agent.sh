#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/native/dist/Cartha Hermes.app"
PLIST="$HOME/Library/LaunchAgents/com.cartha.hermes-native.plist"
LABEL="com.cartha.hermes-native"

if [[ ! -x "$BUNDLE/Contents/MacOS/CarthaHermesNative" ]]; then
  "$ROOT/scripts/build-native-app.sh"
fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-a</string>
    <string>$BUNDLE</string>
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
launchctl kickstart -k "gui/$uid/$LABEL" >/dev/null 2>&1 || true
open -a "$BUNDLE"
echo "Installed and opened $BUNDLE"
