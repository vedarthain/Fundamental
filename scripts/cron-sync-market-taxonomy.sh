#!/usr/bin/env bash
# Semi-annual Market Taxonomy Sync: AMFI Cap Tiers & NSE Index Constituents (Jan 1 & Jul 1, 05:00 UTC = 10:30 IST).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "sync-market-taxonomy"
setup_failure_trap "sync-market-taxonomy" "Market Taxonomy Sync"
load_env

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Market Taxonomy Sync"
echo "================================================================================"

echo "=== 1. Refreshing AMFI market-cap tiers ==="
run_low_prio "$PYTHON_BIN" scripts/fetch-amfi-categorization.py

echo "=== 2. Refreshing NSE index constituents ==="
run_low_prio "$PYTHON_BIN" scripts/fetch-index-constituents.py

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Market Taxonomy Sync Completed"
echo "================================================================================"
