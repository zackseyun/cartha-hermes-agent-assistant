#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/native/dist/Cartha Hermes.app"
if [[ ! -x "$BUNDLE/Contents/MacOS/CarthaHermesNative" ]]; then
  "$ROOT/scripts/build-native-app.sh"
fi
open -a "$BUNDLE" || open "http://127.0.0.1:5128"
