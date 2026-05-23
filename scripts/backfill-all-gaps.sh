#!/usr/bin/env bash
# scripts/backfill-all-gaps.sh
#
# Launch a multi-hour NSE bhavcopy bulk backfill in the background.
#
# WHY BULK MODE (no --symbol):
#   Each weekday's bhavcopy is downloaded ONCE and applied to all 2,163
#   active stocks in one pass.  Running per-symbol for our 61 gap'd
#   stocks would re-download the same bhavcopies 61 times — wasteful.
#   ON CONFLICT DO NOTHING means existing rows are skipped; the only
#   writes that happen are the actual missing rows (the gaps).
#
# WHAT IT DOES:
#   1. Picks a date range (default: 10 years back → today).
#   2. Launches backfill-nse-bhavcopy.py as a detached background process
#      via nohup + disown, so closing the terminal doesn't kill it.
#   3. Writes all stdout/stderr to /tmp/backfill-gaps-<timestamp>.log so
#      you can tail it any time.
#   4. Prints the PID, the log path, and useful one-liners for monitoring.
#
# USAGE:
#   scripts/backfill-all-gaps.sh
#       Default: 10 years back to today, 0.3s throttle, local golden_db
#
#   scripts/backfill-all-gaps.sh 2020-01-01
#       Custom start date (any ISO date)
#
#   THROTTLE=0.5 scripts/backfill-all-gaps.sh
#       Slower throttle (gentler on NSE archives if you see timeouts)
#
# AFTER COMPLETION:
#   1. tail the log to verify success summary
#   2. Run scripts/audit-price-coverage.py to confirm gaps closed
#   3. Run ./scripts/sync-neon.sh to push the new history to production
#
# COST (per Rule #1):
#   - Zero Neon CU during the run (writes go to LOCAL golden_db)
#   - Final sync-neon.sh is incremental + short (~3 min, ~$0.02)
#   - Total cost: $0.02 for the entire batch

set -euo pipefail

# Date math — macOS BSD `date` and GNU `date` have different syntaxes.
# Try GNU first (more capable), fall back to BSD.
default_start() {
    date -d '10 years ago' +%Y-%m-%d 2>/dev/null || date -v-10y +%Y-%m-%d
}

START_DATE="${1:-$(default_start)}"
END_DATE="$(date +%Y-%m-%d)"
THROTTLE="${THROTTLE:-0.3}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY="${PY:-etl/.venv/bin/python}"
if [[ ! -x "$PY" ]]; then
    echo "❌ Python venv not found at $PY — set PY=path/to/python or run from repo root"
    exit 1
fi

# Default golden write URL = local socket (OS user has DDL+DML privileges).
# Override with GOLDEN_DB_WRITE_URL env if running against Neon (NOT
# recommended — see Rule #1 in the header comment).
WRITE_URL="${GOLDEN_DB_WRITE_URL:-postgresql:///golden_db}"

LOG="/tmp/backfill-gaps-$(date +%Y%m%d-%H%M%S).log"

echo "▶ Bulk backfill — launching detached"
echo "   range:    $START_DATE → $END_DATE"
echo "   throttle: ${THROTTLE}s between bhavcopy downloads"
echo "   target:   $WRITE_URL"
echo "   log:      $LOG"
echo

# PYTHONUNBUFFERED=1 forces line-buffered output so `tail -f` shows
# progress in real time instead of buffered chunks.
nohup env \
    PYTHONUNBUFFERED=1 \
    GOLDEN_DB_WRITE_URL="$WRITE_URL" \
    "$PY" scripts/backfill-nse-bhavcopy.py \
        --start "$START_DATE" \
        --end "$END_DATE" \
        --throttle "$THROTTLE" \
    > "$LOG" 2>&1 &

PID=$!
disown $PID 2>/dev/null || true

echo "✓ Launched (PID $PID)"
echo
echo "Monitor commands:"
echo "  tail -f $LOG                             # live progress"
echo "  grep -E '\\[|Done' $LOG | tail            # progress summary"
echo "  kill -0 $PID && echo running || echo done # is it still alive?"
echo "  kill $PID                                 # stop early (rows already written stay)"
echo
echo "Expected runtime ≈ 2,500 weekdays × ${THROTTLE}s + per-day parse/insert"
echo "                ≈ 6-12 hours depending on NSE archive responsiveness."
echo
echo "Safe to close this terminal — the process is fully detached."
echo "When it finishes:"
echo "  1. scripts/audit-price-coverage.py    # verify gaps closed"
echo "  2. ./scripts/sync-neon.sh             # push to production"
