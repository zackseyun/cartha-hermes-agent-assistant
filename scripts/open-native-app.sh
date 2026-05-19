#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="/Applications/Cartha Hermes.app"
if [[ ! -x "$APP_BUNDLE/Contents/MacOS/CarthaHermesNative" ]]; then
  "$ROOT/scripts/install-native-launch-agent.sh"
else
  /usr/bin/open "$APP_BUNDLE" || open "http://127.0.0.1:5128"
fi
