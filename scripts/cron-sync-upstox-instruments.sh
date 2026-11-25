#!/usr/bin/env bash
# Daily Upstox instrument-master sync (Mon-Fri 01:30 UTC = 07:00 IST).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "sync-upstox-instruments"
setup_failure_trap "sync-upstox-instruments" "Sync Upstox Instruments"
load_env

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Upstox Instrument Sync"
echo "================================================================================"

run_low_prio "$PYTHON_BIN" scripts/fetch-upstox-instruments.py

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Upstox Instrument Sync Completed"
echo "================================================================================"
