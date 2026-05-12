#!/usr/bin/env bash
# scripts/backfill-prices-neon.sh
#
# One-shot backfill of golden.price_history (1d interval) on Neon for EVERY
# Nifty 200 stock — including Nifty 50 names already migrated, plus the 149
# Nifty 200 delta stocks. Use this when:
#
#   - A stock that should have data is showing missing 1W/1M/1Y returns on
#     /clusters (e.g., SBIN, RELIANCE, HDFCBANK).
#   - You want to be sure Neon has the same price coverage your local DB does.
#
# Why this exists separate from sync-nifty200-delta.sh:
#   The delta script filters to `is_nifty200 AND NOT is_nifty50`, so it only
#   covers the 149 new stocks. If a Nifty 50 stock's history got lost during
#   the initial migration (transient \COPY error etc.) the delta won't fix it.
#   This script ignores the is_nifty50 carve-out and pushes everyone, using
#   ON CONFLICT DO NOTHING so existing rows are skipped harmlessly.
#
# Idempotent — safe to re-run as often as needed. Tables we touch:
#   - golden.stocks         (parent FK target, ON CONFLICT DO NOTHING)
#   - golden.price_history  (1d only, ON CONFLICT DO NOTHING)
#
# Required env:
#   NEON_GOLDEN_URL = postgres URL for golden_db on Neon

set -eo pipefail

[[ -z "$NEON_GOLDEN_URL" ]] && { echo "❌ NEON_GOLDEN_URL not set"; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOCAL_APP="fundamental_app"
LOCAL_GOLDEN="golden_db"

TMP_DIR="$(mktemp -d)"
trap "rm -rf $TMP_DIR" EXIT

echo "▶ price-history backfill starting at $(date -Iseconds)"
echo "  scope: ALL Nifty 200 stocks (Nifty 50 included, 1d interval only)"
echo

# Build the IN(...) filter for golden_db queries — symbols stored as 'SBIN.NS'.
GOLDEN_FILTER=$(psql "$LOCAL_APP" -tAc "
  SELECT string_agg('''' || symbol || '.NS''', ',')
  FROM app.universe WHERE is_nifty200
")
COUNT=$(psql "$LOCAL_APP" -tAc "SELECT COUNT(*) FROM app.universe WHERE is_nifty200")
echo "  symbols in scope: $COUNT"

# ----- step 1: golden.stocks (parent — FK target) -----
echo "▶ [1/2] backfilling golden.stocks..."
STOCKS_TMP="$TMP_DIR/stocks.tsv"
psql "$LOCAL_GOLDEN" -c "\COPY (SELECT * FROM golden.stocks WHERE symbol IN ($GOLDEN_FILTER)) TO STDOUT" > "$STOCKS_TMP"
ROWS=$(wc -l < "$STOCKS_TMP" | tr -d ' ')
echo "    staged $ROWS rows"

if [[ "$ROWS" -gt 0 ]]; then
  psql "$NEON_GOLDEN_URL" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _gs;
CREATE TEMP TABLE _gs (LIKE golden.stocks INCLUDING ALL);
\COPY _gs FROM '$STOCKS_TMP';
INSERT INTO golden.stocks SELECT * FROM _gs ON CONFLICT DO NOTHING;
SELECT COUNT(*) AS golden_stocks_total FROM golden.stocks;
SQL
fi

# ----- step 2: golden.price_history (1d) -----
echo "▶ [2/2] backfilling golden.price_history (1d interval, all dates)..."
PH_TMP="$TMP_DIR/price_history.tsv"
psql "$LOCAL_GOLDEN" -c "\COPY (SELECT * FROM golden.price_history WHERE symbol IN ($GOLDEN_FILTER) AND interval = '1d') TO STDOUT" > "$PH_TMP"
ROWS=$(wc -l < "$PH_TMP" | tr -d ' ')
echo "    staged $ROWS rows — will INSERT ... ON CONFLICT DO NOTHING (so existing rows are no-ops)"

if [[ "$ROWS" -gt 0 ]]; then
  psql "$NEON_GOLDEN_URL" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _ph;
CREATE TEMP TABLE _ph (LIKE golden.price_history INCLUDING ALL);
\COPY _ph FROM '$PH_TMP';
INSERT INTO golden.price_history SELECT * FROM _ph ON CONFLICT DO NOTHING;
SQL
fi

# ----- verify ------------------------------------------------------------
echo
echo "▶ verification — Nifty 200 symbols on Neon with price coverage:"
psql "$NEON_GOLDEN_URL" -c "
WITH n200 AS (SELECT UNNEST(ARRAY[$GOLDEN_FILTER]) AS symbol)
SELECT
  COUNT(*) AS total_n200,
  COUNT(DISTINCT ph.symbol) AS with_prices,
  COUNT(*) - COUNT(DISTINCT ph.symbol) AS still_missing
FROM n200
LEFT JOIN golden.price_history ph
  ON ph.symbol = n200.symbol AND ph.interval = '1d';
"
echo
echo "▶ symbols with <50 price rows (likely incomplete history):"
psql "$NEON_GOLDEN_URL" -c "
WITH n200 AS (SELECT UNNEST(ARRAY[$GOLDEN_FILTER]) AS symbol)
SELECT REPLACE(n200.symbol, '.NS', '') AS symbol, COUNT(ph.date) AS price_rows
FROM n200
LEFT JOIN golden.price_history ph
  ON ph.symbol = n200.symbol AND ph.interval = '1d'
GROUP BY 1 HAVING COUNT(ph.date) < 50
ORDER BY 2;
"

echo
echo "✓ backfill complete at $(date -Iseconds)"
echo "  refresh /clusters in the browser — SBIN and other heavyweights should now show 1W/1M/1Y returns."
