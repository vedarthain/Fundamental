#!/usr/bin/env bash
# Monthly shareholding pattern refresh (3rd of month 06:00 UTC = 11:30 IST).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "refresh-shareholding"
setup_failure_trap "refresh-shareholding" "Shareholding Pattern Refresh"
load_env

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Shareholding Pattern Refresh"
echo "================================================================================"

run_low_prio "$PYTHON_BIN" -m fundamental_etl.cli fetch-shareholding --refresh

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Shareholding Pattern Refresh Completed"
echo "================================================================================"
