#!/bin/sh
set -eu
export PATH="/Users/zackseyun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.local/bin:$PATH"
exec "$HOME/.local/bin/founder" desktop --source --skip-build
