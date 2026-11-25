#!/usr/bin/env bash
# Corporate actions fetch from BSE (Tue & Fri 05:17 UTC = 10:47 IST).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "corp-actions-bse"
setup_failure_trap "corp-actions-bse" "BSE Corporate Actions Fetch"
load_env

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting BSE Corporate Actions Fetch"
echo "================================================================================"

run_low_prio "$PYTHON_BIN" scripts/fetch-corporate-actions.py

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] BSE Corporate Actions Fetch Completed"
echo "================================================================================"
