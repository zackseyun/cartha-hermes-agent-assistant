#!/bin/sh
set -eu
# Finder, Spotlight and Alfred do not inherit the interactive shell PATH.
# Keep the compatible bundled Node first, then the installed npm location.
export PATH="/Users/zackseyun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
mkdir -p "$HOME/.hermes/profiles/founder/logs"
exec "$HOME/.local/bin/founder" desktop --source --skip-build >> "$HOME/.hermes/profiles/founder/logs/desktop-launcher.log" 2>&1
