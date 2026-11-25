#!/usr/bin/env bash
# Monthly refresh of business_summary / website / employees / officers (5th of month 06:00 UTC = 11:30 IST).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "refresh-company-info"
setup_failure_trap "refresh-company-info" "Company Info Refresh"
load_env

LIMIT="${1:-700}"

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Company Info Refresh (limit=$LIMIT)"
echo "================================================================================"

run_low_prio "$PYTHON_BIN" -m fundamental_etl.cli fetch-business-info --limit "$LIMIT" --refresh --require-progress || true
run_low_prio "$PYTHON_BIN" -m fundamental_etl.cli fetch-officers --limit "$LIMIT" --refresh --require-progress || true

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Company Info Refresh Completed"
echo "================================================================================"
