#!/usr/bin/env bash
# Execute a single cleanup action by name. Called by heartbeat-agent.py after
# deepseek concurrence in Phase 2.
#
# Usage: heartbeat-cleanup.sh <action>
#
# Actions:
#   empty_trash
#   clean_xcode_derived_data
#   clean_ios_simulator_caches
#   clean_tmp_old
#   clean_npm_cache
#   clean_yarn_cache
#   clean_pip_cache
#   clean_homebrew_cache
#   clean_docker_images
#
# Emits one line: "OK <bytes_freed>" or "ERROR <msg>"

set -u

ACTION="${1:-}"
if [[ -z "$ACTION" ]]; then
  echo "ERROR no action specified"
  exit 1
fi

# Disk free before/after (bytes available on /)
free_before=$(df -k / | awk 'NR==2 {print $4}')

case "$ACTION" in
  empty_trash)
    osascript -e 'tell application "Finder" to empty trash' 2>/dev/null \
      || { echo "ERROR osascript empty trash failed"; exit 1; }
    ;;

  clean_xcode_derived_data)
    DD=~/Library/Developer/Xcode/DerivedData
    if [[ -d "$DD" ]]; then
      # Delete *contents* not the dir itself
      find "$DD" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
    fi
    ;;

  clean_ios_simulator_caches)
    SC=~/Library/Developer/CoreSimulator/Caches
    if [[ -d "$SC" ]]; then
      find "$SC" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
    fi
    ;;

  clean_tmp_old)
    # Delete /tmp entries older than 7 days, max 3 levels deep
    find /tmp -mindepth 1 -maxdepth 3 -mtime +7 -exec rm -rf {} + 2>/dev/null || true
    ;;

  clean_npm_cache)
    if command -v npm >/dev/null 2>&1; then
      npm cache clean --force 2>/dev/null || true
    fi
    ;;

  clean_yarn_cache)
    if command -v yarn >/dev/null 2>&1; then
      yarn cache clean 2>/dev/null || true
    fi
    ;;

  clean_pip_cache)
    if command -v pip3 >/dev/null 2>&1; then
      pip3 cache purge 2>/dev/null || true
    fi
    ;;

  clean_homebrew_cache)
    if command -v brew >/dev/null 2>&1; then
      brew cleanup --prune=all 2>/dev/null || true
    fi
    ;;

  clean_docker_images)
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      docker image prune -af 2>/dev/null || true
    fi
    ;;

  *)
    echo "ERROR unknown action: $ACTION"
    exit 1
    ;;
esac

free_after=$(df -k / | awk 'NR==2 {print $4}')
delta_kb=$(( free_after - free_before ))
delta_mb=$(( delta_kb / 1024 ))
echo "OK freed_mb=$delta_mb"
