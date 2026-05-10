#!/usr/bin/env bash
# scripts/weekly-snap.sh — wrapper invoked by launchd every Friday.
# Runs ./snap, captures output to a dated log under logs/snapshots/.
# Exits non-zero if the snapshot fails so launchd records the failure.
set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAMP=$(date +%Y-%m-%d_%H%M%S)
LOG_DIR="$ROOT/logs/snapshots"
LOG_FILE="$LOG_DIR/$STAMP.log"

mkdir -p "$LOG_DIR"

{
  echo "=== weekly-snap started at $(date -Iseconds) ==="
  echo "host: $(hostname)"
  echo "user: $(whoami)"
  echo "pwd:  $ROOT"
  echo

  ./snap

  echo
  echo "=== weekly-snap finished at $(date -Iseconds) ==="
} >> "$LOG_FILE" 2>&1

# Keep only the most recent 26 weekly logs (~6 months) to avoid clutter.
ls -1t "$LOG_DIR"/*.log 2>/dev/null | tail -n +27 | xargs -I{} rm -f {} || true
