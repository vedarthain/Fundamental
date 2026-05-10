#!/usr/bin/env bash
# scripts/sync-neon.sh
#
# Incremental sync: pushes the LATEST snapshot's worth of Nifty 50 data
# from local Postgres → Neon. Run after ./snap to publish fresh scores.
#
# What it syncs:
#   - app.metrics_snapshot   (latest snapshot only, Nifty 50 only)
#   - app.scores             (latest snapshot only, Nifty 50 only)
#   - app.universe           (full Nifty 50 row update — picks up CEO,
#                             shareholding, business_summary changes)
#   - app.shareholding_pattern (full Nifty 50 — quarterly cadence so cheap)
#   - app.screener_meta      (Nifty 50 — refreshed LTPs, market cap)
#   - golden.price_history   (incremental: only rows newer than max(date) on Neon)
#
# What it does NOT sync (by design):
#   - Historical scores beyond latest snapshot (those are immutable; pushed
#     once during initial migration)
#   - Historical metrics_snapshot rows
#   - Reference tables (clusters, scorecards) — change rarely; re-run
#     migrate-nifty50-to-neon.sh if scorecards are tuned
#
# Required env (export before running OR source from etl/.env.local):
#   NEON_APP_URL    = postgres URL for fundamental_app on Neon
#   NEON_GOLDEN_URL = postgres URL for golden_db on Neon

set -eo pipefail

[[ -z "$NEON_APP_URL"    ]] && { echo "❌ NEON_APP_URL not set";    exit 1; }
[[ -z "$NEON_GOLDEN_URL" ]] && { echo "❌ NEON_GOLDEN_URL not set"; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOCAL_APP="fundamental_app"
LOCAL_GOLDEN="golden_db"

echo "▶ sync starting at $(date -Iseconds)"

# ----- discover latest snapshot date locally ------------------------------
LATEST_SNAP=$(psql "$LOCAL_APP" -tAc "SELECT MAX(snapshot_date) FROM app.scores")
[[ -z "$LATEST_SNAP" ]] && { echo "❌ no snapshots in local app.scores"; exit 1; }
echo "  latest local snapshot: $LATEST_SNAP"

NEON_LATEST=$(psql "$NEON_APP_URL" -tAc "SELECT MAX(snapshot_date) FROM app.scores" 2>/dev/null || echo "")
echo "  latest Neon snapshot:  ${NEON_LATEST:-<none>}"

if [[ "$LATEST_SNAP" == "$NEON_LATEST" ]]; then
  echo "  ⚠ Neon already has snapshot $LATEST_SNAP. Pushing anyway (idempotent upsert)."
fi

NIFTY_FILTER="symbol IN (SELECT symbol FROM app.universe WHERE is_nifty50)"

# ----- universe (full upsert for Nifty 50) -------------------------------
# Universe rarely changes shape but field values do (CEO refresh, business
# summary refresh, etc.). UPSERT every row to capture any tiny update.
echo "▶ syncing app.universe (Nifty 50)..."
psql "$LOCAL_APP" -c "\COPY (SELECT * FROM app.universe WHERE is_nifty50) TO STDOUT" \
  | psql "$NEON_APP_URL" -c "
    CREATE TEMP TABLE _u (LIKE app.universe INCLUDING ALL);
    \COPY _u FROM STDIN;
    INSERT INTO app.universe SELECT * FROM _u
      ON CONFLICT (symbol) DO UPDATE SET
        company_name             = EXCLUDED.company_name,
        sector                   = EXCLUDED.sector,
        industry                 = EXCLUDED.industry,
        market_cap_category      = EXCLUDED.market_cap_category,
        is_active                = EXCLUDED.is_active,
        synced_at                = EXCLUDED.synced_at,
        business_summary         = EXCLUDED.business_summary,
        website                  = EXCLUDED.website,
        employees                = EXCLUDED.employees,
        business_info_fetched_at = EXCLUDED.business_info_fetched_at,
        maturity_tier            = EXCLUDED.maturity_tier,
        years_of_data            = EXCLUDED.years_of_data,
        maturity_tier_at         = EXCLUDED.maturity_tier_at,
        ceo_name                 = EXCLUDED.ceo_name,
        ceo_title                = EXCLUDED.ceo_title,
        key_officers             = EXCLUDED.key_officers,
        officers_fetched_at      = EXCLUDED.officers_fetched_at,
        is_nifty500              = EXCLUDED.is_nifty500,
        is_nifty50               = EXCLUDED.is_nifty50;
  "

# ----- screener_meta (Nifty 50, full upsert) -----------------------------
echo "▶ syncing app.screener_meta..."
psql "$LOCAL_APP" -c "\COPY (SELECT * FROM app.screener_meta WHERE $NIFTY_FILTER) TO STDOUT" \
  | psql "$NEON_APP_URL" -c "
    CREATE TEMP TABLE _sm (LIKE app.screener_meta INCLUDING ALL);
    \COPY _sm FROM STDIN;
    DELETE FROM app.screener_meta WHERE $NIFTY_FILTER;
    INSERT INTO app.screener_meta SELECT * FROM _sm;
  "

# ----- latest snapshot only: metrics + scores ----------------------------
echo "▶ syncing app.metrics_snapshot for $LATEST_SNAP..."
psql "$LOCAL_APP" -c "
  \COPY (SELECT * FROM app.metrics_snapshot
         WHERE snapshot_date = '$LATEST_SNAP' AND $NIFTY_FILTER) TO STDOUT
" | psql "$NEON_APP_URL" -c "
  CREATE TEMP TABLE _ms (LIKE app.metrics_snapshot INCLUDING ALL);
  \COPY _ms FROM STDIN;
  DELETE FROM app.metrics_snapshot WHERE snapshot_date = '$LATEST_SNAP';
  INSERT INTO app.metrics_snapshot SELECT * FROM _ms;
"

echo "▶ syncing app.scores for $LATEST_SNAP..."
psql "$LOCAL_APP" -c "
  \COPY (SELECT * FROM app.scores
         WHERE snapshot_date = '$LATEST_SNAP' AND $NIFTY_FILTER) TO STDOUT
" | psql "$NEON_APP_URL" -c "
  CREATE TEMP TABLE _s (LIKE app.scores INCLUDING ALL);
  \COPY _s FROM STDIN;
  DELETE FROM app.scores WHERE snapshot_date = '$LATEST_SNAP';
  INSERT INTO app.scores SELECT * FROM _s;
"

# ----- shareholding (full Nifty 50 — quarterly so cheap) -----------------
echo "▶ syncing app.shareholding_pattern..."
psql "$LOCAL_APP" -c "\COPY (SELECT * FROM app.shareholding_pattern WHERE $NIFTY_FILTER) TO STDOUT" \
  | psql "$NEON_APP_URL" -c "
    CREATE TEMP TABLE _sh (LIKE app.shareholding_pattern INCLUDING ALL);
    \COPY _sh FROM STDIN;
    DELETE FROM app.shareholding_pattern WHERE $NIFTY_FILTER;
    INSERT INTO app.shareholding_pattern SELECT * FROM _sh;
  "

# ----- golden price history: incremental ---------------------------------
echo "▶ syncing golden.price_history (incremental)..."
GOLDEN_FILTER=$(psql "$LOCAL_APP" -tAc "
  SELECT string_agg('''' || symbol || '.NS''', ',')
  FROM app.universe WHERE is_nifty50
")
GOLDEN_LAST=$(psql "$NEON_GOLDEN_URL" -tAc "SELECT MAX(date) FROM golden.price_history" 2>/dev/null || echo "")
if [[ -z "$GOLDEN_LAST" ]]; then
  GOLDEN_DATE_FILTER="TRUE"
else
  GOLDEN_DATE_FILTER="date > '$GOLDEN_LAST'"
fi
echo "  pulling rows after: ${GOLDEN_LAST:-<beginning>}"
psql "$LOCAL_GOLDEN" -c "
  \COPY (SELECT * FROM golden.price_history
         WHERE symbol IN ($GOLDEN_FILTER) AND interval = '1d'
           AND $GOLDEN_DATE_FILTER) TO STDOUT
" | psql "$NEON_GOLDEN_URL" -c "
  CREATE TEMP TABLE _ph (LIKE golden.price_history INCLUDING ALL);
  \COPY _ph FROM STDIN;
  INSERT INTO golden.price_history SELECT * FROM _ph
    ON CONFLICT (symbol, date, interval) DO UPDATE SET
      open  = EXCLUDED.open,
      high  = EXCLUDED.high,
      low   = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume;
"

echo
echo "✓ sync complete at $(date -Iseconds)"
psql "$NEON_APP_URL" -c "
  SELECT snapshot_date, COUNT(*) AS rows
  FROM app.scores
  GROUP BY snapshot_date
  ORDER BY snapshot_date DESC
  LIMIT 5;
"
