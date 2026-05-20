#!/usr/bin/env bash
# scripts/sync-neon.sh
#
# Incremental sync: pushes the LATEST snapshot's worth of Nifty 200 data
# from local Postgres → Neon. Run after ./snap to publish fresh scores.
#
# What it syncs:
#   - app.metrics_snapshot   (latest snapshot only, Nifty 200 only)
#   - app.scores             (latest snapshot only, Nifty 200 only)
#   - app.universe           (full Nifty 200 row update — picks up CEO,
#                             shareholding, business_summary changes)
#   - app.shareholding_pattern (full Nifty 200 — quarterly cadence so cheap)
#   - app.screener_meta      (Nifty 200 — refreshed LTPs, market cap)
#   - golden.price_history   (incremental: only rows newer than max(date) on Neon)
#
# What it does NOT sync (by design):
#   - Historical scores beyond latest snapshot (those are immutable; pushed
#     once during initial migration)
#   - Historical metrics_snapshot rows
#   - Reference tables (clusters, scorecards) — change rarely; re-run
#     migrate-nifty50-to-neon.sh if scorecards are tuned
#
# Implementation note: psql's `-c` flag forbids mixing \COPY meta-command
# with SQL. Workaround — stage each table's rows to a tmpfile, then run a
# single psql script via heredoc that does CREATE TEMP + \COPY FROM file +
# DELETE + INSERT in one connection so the temp table is visible. Also,
# Neon's pgbouncer can leak session state across psql invocations (temp
# table reuse), so each heredoc starts with DROP TABLE IF EXISTS.
# Tmpfiles cleaned by the EXIT trap.
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

TMP_DIR="$(mktemp -d)"
trap "rm -rf $TMP_DIR" EXIT

echo "▶ sync starting at $(date -Iseconds)"
echo "  staging: $TMP_DIR"

# ----- discover latest snapshot date locally ------------------------------
LATEST_SNAP=$(psql "$LOCAL_APP" -tAc "SELECT MAX(snapshot_date) FROM app.scores")
[[ -z "$LATEST_SNAP" ]] && { echo "❌ no snapshots in local app.scores"; exit 1; }
echo "  latest local snapshot: $LATEST_SNAP"

NEON_LATEST=$(psql "$NEON_APP_URL" -tAc "SELECT MAX(snapshot_date) FROM app.scores" 2>/dev/null || echo "")
echo "  latest Neon snapshot:  ${NEON_LATEST:-<none>}"

if [[ "$LATEST_SNAP" == "$NEON_LATEST" ]]; then
  echo "  ⚠ Neon already has snapshot $LATEST_SNAP. Pushing anyway (idempotent upsert)."
fi

# Production scope: every active stock in the universe (~2,150) — widened
# from is_nifty200 once Neon was upgraded to Launch tier so production no
# longer shows blank columns for non-200 stocks on /sectors and /discover.
UNIVERSE_FILTER="symbol IN (SELECT symbol FROM app.universe WHERE is_active)"

# ----- universe (full upsert for active stocks) ---------------------------
# Universe rarely changes shape but field values do (CEO refresh, business
# summary refresh, etc.). UPSERT every row to capture any tiny update.
echo "▶ syncing app.universe (all active stocks)..."
UNIV_TMP="$TMP_DIR/universe.tsv"
psql "$LOCAL_APP" -c "\COPY (SELECT * FROM app.universe WHERE is_active) TO STDOUT" > "$UNIV_TMP"
psql "$NEON_APP_URL" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _u;
CREATE TEMP TABLE _u (LIKE app.universe INCLUDING ALL);
\COPY _u FROM '$UNIV_TMP';
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
    is_nifty50               = EXCLUDED.is_nifty50,
    is_nifty200              = EXCLUDED.is_nifty200;
SQL

# ----- helper: stage rows + DELETE-then-INSERT semantics ------------------
# For tables where we want a "replace the entire filtered slice" effect.
# delete_where: SQL predicate used in BOTH the stage filter (against local)
# and the DELETE (against Neon). Keeps both sides in lockstep.
copy_replace() {
  local table="$1"
  local target_url="$2"
  local source_db="$3"
  local stage_where="$4"
  local delete_where="$5"
  local tag="${table//./_}"
  local tmpfile="$TMP_DIR/${tag}.tsv"

  echo "▶ syncing $table..."
  psql "$source_db" -c "\COPY (SELECT * FROM $table WHERE $stage_where) TO STDOUT" > "$tmpfile"

  if [[ ! -s "$tmpfile" ]]; then
    echo "    (no rows — skipping)"
    return 0
  fi

  psql "$target_url" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _t;
CREATE TEMP TABLE _t (LIKE $table INCLUDING ALL);
\COPY _t FROM '$tmpfile';
DELETE FROM $table WHERE $delete_where;
INSERT INTO $table SELECT * FROM _t;
SQL
}

# ----- screener_meta (all active, full upsert) ----------------------------
copy_replace app.screener_meta "$NEON_APP_URL" "$LOCAL_APP" \
  "$UNIVERSE_FILTER" "$UNIVERSE_FILTER"

# ----- latest snapshot only: metrics + scores ----------------------------
copy_replace app.metrics_snapshot "$NEON_APP_URL" "$LOCAL_APP" \
  "snapshot_date = '$LATEST_SNAP' AND $UNIVERSE_FILTER" \
  "snapshot_date = '$LATEST_SNAP'"

copy_replace app.scores "$NEON_APP_URL" "$LOCAL_APP" \
  "snapshot_date = '$LATEST_SNAP' AND $UNIVERSE_FILTER" \
  "snapshot_date = '$LATEST_SNAP'"

# ----- shareholding (full active universe — quarterly so cheap) -----------
copy_replace app.shareholding_pattern "$NEON_APP_URL" "$LOCAL_APP" \
  "$UNIVERSE_FILTER" "$UNIVERSE_FILTER"

# ----- golden price history: incremental ---------------------------------
echo "▶ syncing golden.price_history (incremental)..."
GOLDEN_FILTER=$(psql "$LOCAL_APP" -tAc "
  SELECT string_agg('''' || symbol || '.NS''', ',')
  FROM app.universe WHERE is_active
")
GOLDEN_LAST=$(psql "$NEON_GOLDEN_URL" -tAc "SELECT MAX(date) FROM golden.price_history" 2>/dev/null || echo "")
if [[ -z "$GOLDEN_LAST" ]]; then
  GOLDEN_DATE_FILTER="TRUE"
else
  GOLDEN_DATE_FILTER="date > '$GOLDEN_LAST'"
fi
echo "  pulling rows after: ${GOLDEN_LAST:-<beginning>}"

PH_TMP="$TMP_DIR/price_history.tsv"
# \COPY meta-command must be on a single line when passed via -c (psql
# parses it as a single meta-statement, not a multi-line block). The
# original multi-line form errors with "syntax error at or near \".
psql "$LOCAL_GOLDEN" -c "\COPY (SELECT * FROM golden.price_history WHERE symbol IN ($GOLDEN_FILTER) AND interval = '1d' AND $GOLDEN_DATE_FILTER) TO STDOUT" > "$PH_TMP"

if [[ ! -s "$PH_TMP" ]]; then
  echo "    (no new price rows — Neon already current)"
else
  psql "$NEON_GOLDEN_URL" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _ph;
CREATE TEMP TABLE _ph (LIKE golden.price_history INCLUDING ALL);
\COPY _ph FROM '$PH_TMP';
INSERT INTO golden.price_history SELECT * FROM _ph
  ON CONFLICT (symbol, date, interval) DO UPDATE SET
    open   = EXCLUDED.open,
    high   = EXCLUDED.high,
    low    = EXCLUDED.low,
    close  = EXCLUDED.close,
    volume = EXCLUDED.volume;
SQL
fi

echo
echo "✓ sync complete at $(date -Iseconds)"
psql "$NEON_APP_URL" -c "
  SELECT snapshot_date, COUNT(*) AS rows
  FROM app.scores
  GROUP BY snapshot_date
  ORDER BY snapshot_date DESC
  LIMIT 5;
"
