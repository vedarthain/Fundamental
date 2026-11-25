#!/usr/bin/env bash
# Monthly universe reconciliation: onboard + retire delisted/merged names (1st 06:00 UTC = 11:30 IST).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "sync-universe-monthly"
setup_failure_trap "sync-universe-monthly" "Monthly Universe Sync & Retire"
load_env

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Monthly Universe Sync & Retire"
echo "================================================================================"

run_low_prio "$PYTHON_BIN" -m fundamental_etl.cli sync-universe --deactivate --deactivate-days 60

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Monthly Universe Sync Completed"
echo "================================================================================"
