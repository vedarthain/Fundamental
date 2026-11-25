#!/usr/bin/env bash
# Daily IPO calendar + post-listing price refresh (12:45 UTC = 18:15 IST).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "refresh-ipos"
setup_failure_trap "refresh-ipos" "Refresh IPOs"
load_env

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting IPO Calendar & Price Refresh"
echo "================================================================================"

run_low_prio "$PYTHON_BIN" scripts/fetch-ipos.py "$@"

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] IPO Refresh Completed"
echo "================================================================================"
