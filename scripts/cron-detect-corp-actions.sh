#!/usr/bin/env bash
# Weekly safety-net scan for unannounced splits/bonuses (Sun 05:00 UTC = 10:30 IST).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "detect-corp-actions"
setup_failure_trap "detect-corp-actions" "Detect Unannounced Corp Actions"
load_env

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Unannounced Corp-Action Scan"
echo "================================================================================"

run_low_prio "$PYTHON_BIN" scripts/apply-corp-adjustments.py --detect-only --dry-run --since-days 30

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Unannounced Corp-Action Scan Completed"
echo "================================================================================"
