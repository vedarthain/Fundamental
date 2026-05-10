#!/usr/bin/env bash
# scripts/migrate-nifty50-to-neon.sh
#
# One-shot migration: pushes Nifty 200 (+ tata-motors variants) data from local
# Postgres → Neon. Filters every symbol-keyed table to is_nifty50 stocks.
# Reference tables (cluster, meta_cluster, scorecards) are copied in full.
#
# Run this ONCE per Neon project setup. Subsequent ./snap runs sync via
# scripts/sync-neon.sh.
#
# Required env (export before running):
#   NEON_APP_URL    = postgres URL for fundamental_app on Neon
#   NEON_GOLDEN_URL = postgres URL for golden_db on Neon
#
# Usage:
#   export NEON_APP_URL='postgresql://...neon.tech/fundamental_app?sslmode=require'
#   export NEON_GOLDEN_URL='postgresql://...neon.tech/golden_db?sslmode=require'
#   ./scripts/migrate-nifty50-to-neon.sh
#
# Idempotent — safe to re-run; it truncates Neon tables before re-loading.

set -eo pipefail

# ----- preflight ----------------------------------------------------------
[[ -z "$NEON_APP_URL"    ]] && { echo "❌ NEON_APP_URL not set";    exit 1; }
[[ -z "$NEON_GOLDEN_URL" ]] && { echo "❌ NEON_GOLDEN_URL not set"; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOCAL_APP="fundamental_app"
LOCAL_GOLDEN="golden_db"
TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT

echo "▶ migration starting"
echo "  source: $LOCAL_APP / $LOCAL_GOLDEN  (local)"
echo "  target: NEON"
echo "  staging: $TMP"
echo

# ----- step 1: schema dump + restore --------------------------------------
echo "▶ [1/4] dumping local schema..."
# Scope to only the schemas this project owns. Local DBs may have other
# schemas (backtest, scratch, etc.) from past experiments — we don't want
# those leaking into the production migration.
pg_dump "$LOCAL_APP"    --schema-only --no-owner --no-acl --schema=app    -f "$TMP/app_schema.sql"
pg_dump "$LOCAL_GOLDEN" --schema-only --no-owner --no-acl --schema=golden -f "$TMP/golden_schema.sql"

# Strip Postgres-17-only SET directives so the dump applies cleanly to PG16 Neon.
# transaction_timeout was introduced in PG17. Other forward-compat SETs are
# harmless if absent. We rewrite the dump in place rather than maintain
# version-specific branches.
sed -i.bak '/SET transaction_timeout/d' "$TMP/app_schema.sql"    "$TMP/golden_schema.sql"
rm -f "$TMP/app_schema.sql.bak" "$TMP/golden_schema.sql.bak"

echo "▶ [1/4] applying schema to Neon..."
# Idempotent: drop the project schemas first so re-runs always start clean.
# Public schema (used by neondb_owner) is left intact.
psql "$NEON_APP_URL"    -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS app CASCADE"    >/dev/null
psql "$NEON_GOLDEN_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS golden CASCADE" >/dev/null
psql "$NEON_APP_URL"    -v ON_ERROR_STOP=1 -f "$TMP/app_schema.sql"    >/dev/null
psql "$NEON_GOLDEN_URL" -v ON_ERROR_STOP=1 -f "$TMP/golden_schema.sql" >/dev/null

# ----- step 2: copy reference tables in full ------------------------------
echo "▶ [2/4] copying reference tables (cluster taxonomy, scorecards)..."
copy_full() {
  local table="$1"; local target="$2"
  # psql forbids mixing SQL and \COPY meta-command in one -c invocation,
  # so we truncate and load in separate calls.
  psql "$target" -v ON_ERROR_STOP=1 -c "TRUNCATE $table CASCADE" >/dev/null
  psql "$LOCAL_APP" -c "\COPY (SELECT * FROM $table) TO STDOUT" \
    | psql "$target" -v ON_ERROR_STOP=1 -c "\COPY $table FROM STDIN"
}

copy_full app.meta_cluster       "$NEON_APP_URL"
copy_full app.cluster            "$NEON_APP_URL"
copy_full app.cluster_scorecard  "$NEON_APP_URL"

# ----- step 3: copy symbol-keyed tables (filtered to Nifty 200) ------------
echo "▶ [3/4] copying Nifty 200 data (filtered)..."

NIFTY_FILTER="symbol IN (SELECT symbol FROM app.universe WHERE is_nifty200)"

# Each entry: "table  filter-expr"
copy_filtered() {
  local table="$1"
  local where="$2"
  local target="$3"
  echo "    $table"
  psql "$target" -v ON_ERROR_STOP=1 -c "TRUNCATE $table CASCADE" >/dev/null
  psql "$LOCAL_APP" -c "\COPY (SELECT * FROM $table WHERE $where) TO STDOUT" \
    | psql "$target" -v ON_ERROR_STOP=1 -c "\COPY $table FROM STDIN"
}

# Universe must come first — every other table foreign-keys to it
copy_filtered app.universe                "is_nifty200"                      "$NEON_APP_URL"
copy_filtered app.cluster_assignment      "$NIFTY_FILTER"                     "$NEON_APP_URL"
copy_filtered app.fundamentals_annual     "$NIFTY_FILTER"                     "$NEON_APP_URL"
copy_filtered app.fundamentals_quarterly  "$NIFTY_FILTER"                     "$NEON_APP_URL"
copy_filtered app.metrics_snapshot        "$NIFTY_FILTER"                     "$NEON_APP_URL"
copy_filtered app.scores                  "$NIFTY_FILTER"                     "$NEON_APP_URL"
copy_filtered app.shareholding_pattern    "$NIFTY_FILTER"                     "$NEON_APP_URL"
copy_filtered app.screener_meta           "$NIFTY_FILTER"                     "$NEON_APP_URL"
# screener_export_raw deliberately skipped — xlsx blobs are huge inputs we
# don't need to ship to production. Re-fetched on demand.
# user_scorecard_override copied in full (small, no FK to symbol)
copy_full app.user_scorecard_override     "$NEON_APP_URL"

# ----- step 4: golden_db stocks + price history --------------------------
# Order matters: golden.price_history (partitioned by interval) has an FK to
# golden.stocks. Parent rows must exist before child inserts, so we load
# golden.stocks first.
echo "▶ [4/4] copying golden_db (stocks + daily prices) for Nifty 200..."
GOLDEN_FILTER=$(psql "$LOCAL_APP" -tAc "
  SELECT string_agg('''' || symbol || '.NS''', ',')
  FROM app.universe WHERE is_nifty200
")

echo "    golden.stocks"
psql "$NEON_GOLDEN_URL" -v ON_ERROR_STOP=1 -c "TRUNCATE golden.stocks CASCADE" >/dev/null
psql "$LOCAL_GOLDEN" -c "\COPY (SELECT * FROM golden.stocks WHERE symbol IN ($GOLDEN_FILTER)) TO STDOUT" \
  | psql "$NEON_GOLDEN_URL" -v ON_ERROR_STOP=1 -c "\COPY golden.stocks FROM STDIN"

echo "    golden.price_history (1d partition)"
# price_history is the partitioned parent; loading it routes rows to the
# correct partition table automatically. No need to truncate the partition
# directly — TRUNCATE on the parent cascades to all partitions.
psql "$NEON_GOLDEN_URL" -v ON_ERROR_STOP=1 -c "TRUNCATE golden.price_history CASCADE" >/dev/null
psql "$LOCAL_GOLDEN" -c "\COPY (SELECT * FROM golden.price_history WHERE symbol IN ($GOLDEN_FILTER) AND interval = '1d') TO STDOUT" \
  | psql "$NEON_GOLDEN_URL" -v ON_ERROR_STOP=1 -c "\COPY golden.price_history FROM STDIN"

# ----- verify ------------------------------------------------------------
echo
echo "▶ verification:"
psql "$NEON_APP_URL" -c "
  SELECT 'universe (Nifty200)'  AS tbl, COUNT(*) AS rows FROM app.universe WHERE is_nifty200
  UNION ALL SELECT 'fund. annual',       COUNT(*) FROM app.fundamentals_annual
  UNION ALL SELECT 'fund. quarterly',    COUNT(*) FROM app.fundamentals_quarterly
  UNION ALL SELECT 'metrics_snapshot',   COUNT(*) FROM app.metrics_snapshot
  UNION ALL SELECT 'scores',             COUNT(*) FROM app.scores
  UNION ALL SELECT 'shareholding_pattern', COUNT(*) FROM app.shareholding_pattern
  UNION ALL SELECT 'cluster (refs)',     COUNT(*) FROM app.cluster
  UNION ALL SELECT 'cluster_scorecard',  COUNT(*) FROM app.cluster_scorecard;
"
psql "$NEON_GOLDEN_URL" -c "
  SELECT COUNT(DISTINCT symbol) AS symbols, COUNT(*) AS price_rows
  FROM golden.price_history;
"

echo
echo "✓ migration complete."
echo "  Next: deploy web/ to Vercel with these env vars:"
echo "    APP_DB_URL    = \$NEON_APP_URL"
echo "    GOLDEN_DB_URL = \$NEON_GOLDEN_URL"
