#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_SRC="$ROOT/native/CarthaHermesNative"
DIST="$ROOT/native/dist"
APP_NAME="Cartha Hermes.app"
BUNDLE="$DIST/$APP_NAME"
EXEC_NAME="CarthaHermesNative"
ICON_SOURCE="$ROOT/native/assets/CarthaHermes.icns"
ICON_BUNDLE_NAME="AppIcon.icns"

if [[ ! -f "$ICON_SOURCE" || "$ROOT/scripts/generate-native-icon.py" -nt "$ICON_SOURCE" ]]; then
  "$ROOT/scripts/generate-native-icon.py"
fi

cd "$APP_SRC"
swift build -c release
BIN="$(swift build -c release --show-bin-path)/$EXEC_NAME"

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp "$BIN" "$BUNDLE/Contents/MacOS/$EXEC_NAME"
cp "$ICON_SOURCE" "$BUNDLE/Contents/Resources/$ICON_BUNDLE_NAME"
cat > "$BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>$EXEC_NAME</string>
  <key>CFBundleIdentifier</key><string>ai.cartha.hermes.native</string>
  <key>CFBundleName</key><string>Cartha Hermes</string>
  <key>CFBundleDisplayName</key><string>Cartha Hermes</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>Cartha Hermes</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>cartha-hermes</string>
      </array>
    </dict>
  </array>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$BUNDLE" >/dev/null 2>&1 || true
fi

echo "Built $BUNDLE"
