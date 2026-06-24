#!/usr/bin/env bash
# scripts/pull-from-neon.sh
#
# Pulls production data from Neon → local Postgres.
# The reverse of sync-neon.sh — used when you want the local DB to reflect
# what's on production (e.g. to re-run scoring locally with a fix, or to
# resume ETL work after a period of GitHub Actions-only runs).
#
# What it pulls:
#   - app.universe               (full active universe)
#   - app.screener_meta          (latest LTPs + market caps)
#   - app.fundamentals_quarterly (full active universe)
#   - app.fundamentals_annual    (full active universe)
#   - app.shareholding_pattern   (full active universe)
#   - app.scores                 (all snapshots — for score history chart)
#   - app.metrics_snapshot       (latest snapshot only — base for recompute)
#   - app.cluster_*              (cluster assignments, scorecards, caches)
#   - golden.price_history       (incremental: only rows newer than local max)
#
# What it does NOT overwrite:
#   - app.schema_migrations      (local migration state is independent)
#   - Reference tables (meta_cluster, cluster) — these are set by local
#     seed scripts; Neon should reflect local, not the other way.
#
# Required env:
#   NEON_APP_URL    = Neon postgres URL for fundamental_app
#   NEON_GOLDEN_URL = Neon postgres URL for golden_db
#
# Usage:
#   export NEON_APP_URL="postgresql://..."
#   export NEON_GOLDEN_URL="postgresql://..."
#   bash scripts/pull-from-neon.sh

set -eo pipefail

[[ -z "$NEON_APP_URL"    ]] && { echo "❌ NEON_APP_URL not set";    exit 1; }
[[ -z "$NEON_GOLDEN_URL" ]] && { echo "❌ NEON_GOLDEN_URL not set"; exit 1; }

LOCAL_APP="fundamental_app"
LOCAL_GOLDEN="golden_db"

TMP_DIR="$(mktemp -d)"
trap "rm -rf $TMP_DIR" EXIT

echo "▶ pull-from-neon starting at $(date -Iseconds)"
echo "  staging dir: $TMP_DIR"

# ----- helper: pull a table slice from Neon → local ----------------------
# delete_where runs against LOCAL to clear old rows; insert comes from Neon.
pull_replace() {
  local table="$1"
  local source_url="$2"
  local target_db="$3"
  local pull_where="$4"    # WHERE clause for SELECT on Neon
  local delete_where="$5"  # WHERE clause for DELETE on local
  local tag="${table//./_}"
  local tmpfile="$TMP_DIR/${tag}.tsv"

  echo "▶ pulling $table (WHERE $pull_where)..."
  psql "$source_url" -c "\COPY (SELECT * FROM $table WHERE $pull_where) TO STDOUT" > "$tmpfile"

  local row_count
  row_count=$(wc -l < "$tmpfile" | tr -d ' ')
  echo "    ${row_count} rows staged"

  if [[ ! -s "$tmpfile" ]]; then
    echo "    (no rows — skipping)"
    return 0
  fi

  psql "$target_db" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _pull;
CREATE TEMP TABLE _pull (LIKE $table INCLUDING ALL);
\COPY _pull FROM '$tmpfile';
DELETE FROM $table WHERE $delete_where;
INSERT INTO $table SELECT * FROM _pull;
SQL
  echo "    ✓ replaced"
}

# ----- helper: upsert variant (no delete, ON CONFLICT DO UPDATE) ---------
pull_upsert() {
  local table="$1"
  local source_url="$2"
  local target_db="$3"
  local pull_where="$4"
  local conflict_col="$5"
  local update_set="$6"
  local tag="${table//./_}"
  local tmpfile="$TMP_DIR/${tag}.tsv"

  echo "▶ pulling (upsert) $table (WHERE $pull_where)..."
  psql "$source_url" -c "\COPY (SELECT * FROM $table WHERE $pull_where) TO STDOUT" > "$tmpfile"

  local row_count
  row_count=$(wc -l < "$tmpfile" | tr -d ' ')
  echo "    ${row_count} rows staged"

  if [[ ! -s "$tmpfile" ]]; then
    echo "    (no rows — skipping)"
    return 0
  fi

  psql "$target_db" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _pull;
CREATE TEMP TABLE _pull (LIKE $table INCLUDING ALL);
\COPY _pull FROM '$tmpfile';
INSERT INTO $table SELECT * FROM _pull
  ON CONFLICT ($conflict_col) DO UPDATE SET $update_set;
SQL
  echo "    ✓ upserted"
}

# Check what's on Neon
NEON_SNAP=$(psql "$NEON_APP_URL" -tAc "SELECT MAX(snapshot_date) FROM app.scores" 2>/dev/null || echo "")
echo "  Neon latest snapshot: ${NEON_SNAP:-<none>}"
LOCAL_SNAP=$(psql "$LOCAL_APP" -tAc "SELECT MAX(snapshot_date) FROM app.scores" 2>/dev/null || echo "")
echo "  Local latest snapshot: ${LOCAL_SNAP:-<none>}"

ACTIVE_FILTER="symbol IN (SELECT symbol FROM app.universe WHERE is_active)"

# ----- universe -----------------------------------------------------------
echo ""
echo "=== Core data tables ==="
psql "$NEON_APP_URL" -c "\COPY (SELECT * FROM app.universe WHERE is_active) TO STDOUT" > "$TMP_DIR/universe.tsv"
row_count=$(wc -l < "$TMP_DIR/universe.tsv" | tr -d ' ')
echo "▶ pulling app.universe (${row_count} active stocks)..."
psql "$LOCAL_APP" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _pull;
CREATE TEMP TABLE _pull (LIKE app.universe INCLUDING ALL);
\COPY _pull FROM '$TMP_DIR/universe.tsv';
INSERT INTO app.universe SELECT * FROM _pull
  ON CONFLICT (symbol) DO UPDATE SET
    company_name             = EXCLUDED.company_name,
    isin                     = EXCLUDED.isin,
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
echo "    ✓ upserted"

# ----- screener_meta ------------------------------------------------------
pull_replace app.screener_meta "$NEON_APP_URL" "$LOCAL_APP" \
  "$ACTIVE_FILTER" "$ACTIVE_FILTER"

# ----- fundamentals -------------------------------------------------------
echo ""
echo "=== Fundamentals (this may take ~30 sec) ==="
pull_replace app.fundamentals_quarterly "$NEON_APP_URL" "$LOCAL_APP" \
  "$ACTIVE_FILTER" "$ACTIVE_FILTER"

pull_replace app.fundamentals_annual "$NEON_APP_URL" "$LOCAL_APP" \
  "$ACTIVE_FILTER" "$ACTIVE_FILTER"

# ----- shareholding -------------------------------------------------------
pull_replace app.shareholding_pattern "$NEON_APP_URL" "$LOCAL_APP" \
  "$ACTIVE_FILTER" "$ACTIVE_FILTER"

# ----- scores + metrics (all snapshots for history) ----------------------
echo ""
echo "=== Scores & metrics ==="
pull_replace app.scores "$NEON_APP_URL" "$LOCAL_APP" \
  "$ACTIVE_FILTER" "$ACTIVE_FILTER"

# Only pull metrics for latest snapshot (we'll recompute from scratch anyway)
LATEST_NEON_SNAP=$(psql "$NEON_APP_URL" -tAc "SELECT MAX(snapshot_date) FROM app.metrics_snapshot" 2>/dev/null || echo "")
if [[ -n "$LATEST_NEON_SNAP" ]]; then
  pull_replace app.metrics_snapshot "$NEON_APP_URL" "$LOCAL_APP" \
    "snapshot_date = '$LATEST_NEON_SNAP' AND $ACTIVE_FILTER" \
    "$ACTIVE_FILTER"
fi

# ----- cluster tables -----------------------------------------------------
echo ""
echo "=== Cluster data ==="
pull_replace app.cluster_assignment "$NEON_APP_URL" "$LOCAL_APP" \
  "TRUE" "TRUE"

pull_replace app.cluster_scorecard "$NEON_APP_URL" "$LOCAL_APP" \
  "TRUE" "TRUE"

LATEST_CLUSTER_CACHE=$(psql "$NEON_APP_URL" -tAc "SELECT MAX(snapshot_date) FROM app.cluster_composite_cache" 2>/dev/null || echo "")
if [[ -n "$LATEST_CLUSTER_CACHE" ]]; then
  pull_replace app.cluster_composite_cache "$NEON_APP_URL" "$LOCAL_APP" \
    "snapshot_date = '$LATEST_CLUSTER_CACHE'" \
    "snapshot_date = '$LATEST_CLUSTER_CACHE'"
  pull_replace app.cluster_stocks_panel_cache "$NEON_APP_URL" "$LOCAL_APP" \
    "snapshot_date = '$LATEST_CLUSTER_CACHE'" \
    "snapshot_date = '$LATEST_CLUSTER_CACHE'"
fi

# ----- golden price history (incremental) --------------------------------
echo ""
echo "=== Price history (incremental) ==="
LOCAL_PH_MAX=$(psql "$LOCAL_GOLDEN" -tAc "SELECT MAX(date) FROM golden.price_history" 2>/dev/null || echo "")
echo "  Local price history max date: ${LOCAL_PH_MAX:-<empty>}"

GOLDEN_FILTER=$(psql "$NEON_APP_URL" -tAc "
  SELECT string_agg('''' || symbol || '.NS''', ',')
  FROM app.universe WHERE is_active
")

if [[ -z "$LOCAL_PH_MAX" ]]; then
  DATE_FILTER="TRUE"
else
  DATE_FILTER="date > '$LOCAL_PH_MAX'"
fi

psql "$NEON_GOLDEN_URL" -c "\COPY (SELECT * FROM golden.price_history WHERE symbol IN ($GOLDEN_FILTER) AND interval = '1d' AND $DATE_FILTER) TO STDOUT" > "$TMP_DIR/price_history.tsv"
row_count=$(wc -l < "$TMP_DIR/price_history.tsv" | tr -d ' ')
echo "  ${row_count} new price rows"

if [[ -s "$TMP_DIR/price_history.tsv" ]]; then
  psql "$LOCAL_GOLDEN" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _ph;
CREATE TEMP TABLE _ph (LIKE golden.price_history INCLUDING ALL);
\COPY _ph FROM '$TMP_DIR/price_history.tsv';
INSERT INTO golden.price_history SELECT * FROM _ph
  ON CONFLICT (symbol, date, interval) DO UPDATE SET
    open   = EXCLUDED.open,
    high   = EXCLUDED.high,
    low    = EXCLUDED.low,
    close  = EXCLUDED.close,
    volume = EXCLUDED.volume;
SQL
  echo "    ✓ price history updated"
else
  echo "    (no new rows — already current)"
fi

# ----- summary -----------------------------------------------------------
echo ""
echo "✓ pull-from-neon complete at $(date -Iseconds)"
echo ""
psql "$LOCAL_APP" -c "
  SELECT 'scores' AS tbl, MAX(snapshot_date)::text AS latest, COUNT(DISTINCT snapshot_date)::text AS snapshots FROM app.scores
  UNION ALL SELECT 'metrics_snapshot', MAX(snapshot_date)::text, COUNT(DISTINCT snapshot_date)::text FROM app.metrics_snapshot
  UNION ALL SELECT 'fundamentals_quarterly', MAX(period_end)::text, COUNT(*)::text FROM app.fundamentals_quarterly
  UNION ALL SELECT 'fundamentals_annual', MAX(period_end)::text, COUNT(*)::text FROM app.fundamentals_annual;
"
