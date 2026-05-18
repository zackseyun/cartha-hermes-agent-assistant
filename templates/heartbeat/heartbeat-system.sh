#!/usr/bin/env bash
# Read-only macOS system snapshot for the heartbeat agent.

set -u

bytes_to_mb() {
  awk -v bytes="${1:-0}" 'BEGIN { printf "%.0f", bytes / 1024 / 1024 }'
}

dir_size_mb() {
  local path="$1"
  if [[ -e "$path" ]]; then
    du -sm "$path" 2>/dev/null | awk '{print $1}'
  else
    printf '0'
  fi
}

memory_pressure_tier() {
  local percent="$1"
  awk -v p="$percent" 'BEGIN {
    if (p >= 75) print "HIGH";
    else if (p >= 55) print "MEDIUM";
    else print "LOW";
  }'
}

cpu_pressure_tier() {
  local percent="$1"
  awk -v p="$percent" 'BEGIN {
    if (p >= 80) print "HIGH";
    else if (p >= 55) print "MEDIUM";
    else print "LOW";
  }'
}

page_size="$(pagesize 2>/dev/null || echo 4096)"
vm_stat_out="$(vm_stat 2>/dev/null || true)"
free_pages="$(printf '%s\n' "$vm_stat_out" | awk '/Pages free/ { gsub("\\.", "", $3); print $3 }')"
inactive_pages="$(printf '%s\n' "$vm_stat_out" | awk '/Pages inactive/ { gsub("\\.", "", $3); print $3 }')"
speculative_pages="$(printf '%s\n' "$vm_stat_out" | awk '/Pages speculative/ { gsub("\\.", "", $3); print $3 }')"
free_pages="${free_pages:-0}"
inactive_pages="${inactive_pages:-0}"
speculative_pages="${speculative_pages:-0}"

total_mem="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
available_mem="$(( (free_pages + inactive_pages + speculative_pages) * page_size ))"
used_mem="$(( total_mem > available_mem ? total_mem - available_mem : 0 ))"
memory_used_pct="$(awk -v used="$used_mem" -v total="$total_mem" 'BEGIN { if (total > 0) printf "%.1f", used * 100 / total; else printf "0.0" }')"

cpu_idle="$(top -l 1 -n 0 2>/dev/null | awk -F'[:,%]' '/CPU usage/ { gsub(/^ +| +$/, "", $7); print $7; exit }')"
cpu_used_pct="$(awk -v idle="${cpu_idle:-100}" 'BEGIN { printf "%.1f", 100 - idle }')"

echo "SYSTEM SNAPSHOT $(date -Iseconds)"
echo "memory_used_pct=$memory_used_pct"
echo "memory_pressure=$(memory_pressure_tier "$memory_used_pct")"
echo "cpu_used_pct=$cpu_used_pct"
echo "cpu_pressure=$(cpu_pressure_tier "$cpu_used_pct")"
echo "disk_root=$(df -h / | awk 'NR==2 {print "used=" $3 " avail=" $4 " pct=" $5}')"
echo

echo "TOP PROCESSES BY RSS"
ps -axo rss=,comm= | sort -nr | head -12 | awk '{ rss=$1; $1=""; sub(/^ /,""); printf "%.0f MB\t%s\n", rss / 1024, $0 }'
echo

echo "RUNNING GUI APPS"
ps -axo comm= | awk -F/ '
  /\/Applications\/.*\.app\// {
    for (i = 1; i <= NF; i++) {
      if ($i ~ /\.app$/) {
        sub(/\.app$/, "", $i)
        print $i
        break
      }
    }
  }
' | sort -u | head -80
echo

echo "CLEANUP TARGET SIZES MB"
printf "trash=%s\n" "$(dir_size_mb "$HOME/.Trash")"
printf "xcode_derived_data=%s\n" "$(dir_size_mb "$HOME/Library/Developer/Xcode/DerivedData")"
printf "ios_simulator_caches=%s\n" "$(dir_size_mb "$HOME/Library/Developer/CoreSimulator/Caches")"
printf "tmp_old_estimate=%s\n" "$(find /tmp -mindepth 1 -maxdepth 3 -mtime +7 -print0 2>/dev/null | xargs -0 du -sm 2>/dev/null | awk '{sum += $1} END {print sum + 0}')"
