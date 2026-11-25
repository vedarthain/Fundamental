#!/usr/bin/env bash
# Corporate announcements refresh from BSE (Sun 22:00 UTC = Mon 03:30 IST).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "refresh-announcements"
setup_failure_trap "refresh-announcements" "BSE Announcements Sweep"
load_env

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting BSE Announcements Sweep"
echo "================================================================================"

run_low_prio "$PYTHON_BIN" scripts/fetch-announcements.py --max-minutes 92

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] BSE Announcements Sweep Completed"
echo "================================================================================"
