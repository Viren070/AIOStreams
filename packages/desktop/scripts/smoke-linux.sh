#!/bin/bash
# Starts the app for a few seconds on a virtual display with fresh folders, prints its log
# and fails if mpv, its render context or the page didn't start:
#   ./scripts/smoke-linux.sh <command...>
set -uo pipefail

t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
export XDG_CONFIG_HOME=$t/config XDG_DATA_HOME=$t/data XDG_CACHE_HOME=$t/cache APPIMAGE_EXTRACT_AND_RUN=1
xvfb-run -a timeout 20 "$@" >"$t/out.log" 2>&1
log=$(ls "$t/data/AIOStreams Desktop/logs/"*.log 2>/dev/null | head -1)
if [ -z "$log" ]; then
  cat "$t/out.log"
  echo "The app wrote no log" && exit 1
fi
cat "$log"
# The page sets hwdec once it has loaded.
for line in "mpv started" "mpv render context" "set hwdec"; do
  grep -q "$line" "$log" || { echo "No '$line' in the log" && exit 1; }
done
for line in "mpv option" "panicked"; do
  if grep -q "$line" "$log"; then echo "'$line' in the log" && exit 1; fi
done
