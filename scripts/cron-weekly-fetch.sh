#!/usr/bin/env bash
# Weekly Screener fundamentals fetch (Mon-Fri 14:15 UTC = 19:45 IST, staggered after EOD LTP).
# Mon-Thu take --limit 700; Friday drains whatever remains. Pass --force to ignore 120h skip.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "weekly-fetch"
setup_failure_trap "weekly-fetch" "Weekly Screener Fetch"
load_env

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Weekly Fetch (Screener)"
echo "================================================================================"

SKIP_HOURS="120"
LIMIT_FLAG=""
DOW_UTC="$(date -u +%u)" # 1=Mon .. 5=Fri
if [ "${1:-}" = "--force" ]; then
  SKIP_HOURS="0"
elif [ "$DOW_UTC" -ge 1 ] && [ "$DOW_UTC" -le 4 ]; then
  LIMIT_FLAG="--limit 700"
fi

echo "=== 1. Sync universe (onboard new NSE listings) ==="
run_low_prio "$PYTHON_BIN" -m fundamental_etl.cli sync-universe --retire-non-equity

echo "=== 2. Classify new listings (sector/industry) ==="
run_low_prio "$PYTHON_BIN" -m fundamental_etl.cli fetch-classification

echo "=== 3. Fetch fundamentals from Screener (skip_recent_hours=$SKIP_HOURS $LIMIT_FLAG) ==="
# shellcheck disable=SC2086
run_low_prio "$PYTHON_BIN" -m fundamental_etl.cli fetch-many --max-runtime-min 180 --skip-recent-hours "$SKIP_HOURS" $LIMIT_FLAG

echo "=== 4. Fetch dividend-only names (InvITs/REITs) ==="
run_low_prio "$PYTHON_BIN" -m fundamental_etl.cli fetch-dividend-only || true

echo "=== 5. Prune old raw blobs ==="
run_low_prio "$PYTHON_BIN" -c "
import os, psycopg
with psycopg.connect(os.environ['APP_DB_URL']) as c, c.cursor() as cur:
    cur.execute('''
        DELETE FROM app.screener_export_raw r
        USING (SELECT symbol, max(fetched_at) AS mx
                 FROM app.screener_export_raw GROUP BY symbol) k
        WHERE r.symbol = k.symbol AND r.fetched_at < k.mx
    ''')
    print('pruned old blobs:', cur.rowcount)
    c.commit()
"

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Weekly Fetch Completed"
echo "================================================================================"
