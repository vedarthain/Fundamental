#!/usr/bin/env bash
# scripts/sync-nifty200-delta.sh
#
# One-shot incremental migration: pushes the 149 stocks that are in Nifty 200
# but not Nifty 50 (the "delta") from local Postgres → Neon. Existing Nifty 50
# rows already on Neon are left untouched, except that app.universe gets a
# full upsert of all 200 rows so the is_nifty200 flag gets stamped onto the
# existing Nifty 50 rows too.
#
# Why this exists (and not just re-running migrate-nifty50-to-neon.sh):
#   That script does DROP SCHEMA CASCADE + full reload, which writes the
#   entire dataset to Neon's WAL. Neon retains 7 days of WAL for PITR, and
#   our project's reported size was already at 219 MB. A full re-migration
#   would spike usage near the 500 MB Free-tier cap. This delta approach
#   keeps WAL impact proportional to the ~80 MB of new data.
#
# Implementation note: psql's `-c` flag forbids mixing \COPY meta-command
# with SQL. Workaround — stage each table's rows to a tmpfile, then run a
# single psql script via heredoc that does CREATE TEMP + \COPY FROM file +
# INSERT ON CONFLICT. Same connection, so the temp table is visible to
# the INSERT. Tmpfiles are cleaned up by the EXIT trap.
#
# Idempotent — every INSERT uses ON CONFLICT DO NOTHING (or UPSERT for
# universe). Safe to re-run if interrupted.
#
# Required env (export before running):
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

echo "▶ delta sync starting at $(date -Iseconds)"
echo "  pushing: stocks in Nifty 200 but not yet on Neon"
echo "  staging: $TMP_DIR"
echo

# ----- preflight ----------------------------------------------------------
LOCAL_N200=$(psql "$LOCAL_APP" -tAc "SELECT COUNT(*) FROM app.universe WHERE is_nifty200")
LOCAL_N50=$(psql "$LOCAL_APP"  -tAc "SELECT COUNT(*) FROM app.universe WHERE is_nifty50")
LOCAL_DELTA=$(psql "$LOCAL_APP" -tAc "SELECT COUNT(*) FROM app.universe WHERE is_nifty200 AND NOT is_nifty50")
echo "  local: nifty200=$LOCAL_N200, nifty50=$LOCAL_N50, delta=$LOCAL_DELTA"
[[ "$LOCAL_N200" -lt 200 ]] && { echo "❌ local is_nifty200 count < 200 — apply 0010_nifty200.sql first"; exit 1; }

DELTA_FILTER="symbol IN (SELECT symbol FROM app.universe WHERE is_nifty200 AND NOT is_nifty50)"

# ----- step 0: ensure is_nifty200 column exists on Neon -------------------
echo "▶ [0/8] ensuring is_nifty200 column on Neon app.universe..."
psql "$NEON_APP_URL" -v ON_ERROR_STOP=1 -c "
  ALTER TABLE app.universe ADD COLUMN IF NOT EXISTS is_nifty200 BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE INDEX IF NOT EXISTS idx_universe_nifty200 ON app.universe (is_nifty200) WHERE is_nifty200 = TRUE;
" >/dev/null

# ----- step 1: universe — UPSERT all 200 (sets is_nifty200 on existing rows)
echo "▶ [1/8] upserting app.universe (all 200 Nifty 200 rows)..."
UNIVERSE_TMP="$TMP_DIR/universe.tsv"
psql "$LOCAL_APP" -c "\COPY (SELECT * FROM app.universe WHERE is_nifty200) TO STDOUT" > "$UNIVERSE_TMP"

psql "$NEON_APP_URL" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _u;
CREATE TEMP TABLE _u (LIKE app.universe INCLUDING ALL);
\COPY _u FROM '$UNIVERSE_TMP';
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

# ----- helper: stage delta rows to file, then load via temp table ---------
copy_delta() {
  local table="$1"
  local target_url="$2"
  local source_db="$3"
  local where_clause="$4"
  local tag="${table//./_}"
  local tmpfile="$TMP_DIR/${tag}.tsv"

  echo "    $table"
  psql "$source_db" -c "\COPY (SELECT * FROM $table WHERE $where_clause) TO STDOUT" > "$tmpfile"

  # Skip empty staging files (psql \COPY FROM '' on empty file is fine, but
  # avoid the round trip).
  if [[ ! -s "$tmpfile" ]]; then
    echo "      (no rows — skipping)"
    return 0
  fi

  psql "$target_url" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _t;
CREATE TEMP TABLE _t (LIKE $table INCLUDING ALL);
\COPY _t FROM '$tmpfile';
INSERT INTO $table SELECT * FROM _t ON CONFLICT DO NOTHING;
SELECT COUNT(*) AS staged_rows FROM _t;
SQL
}

# ----- step 2: per-symbol app tables (delta only) -------------------------
echo "▶ [2/8] inserting delta rows into symbol-keyed app tables..."
copy_delta app.fundamentals_annual    "$NEON_APP_URL" "$LOCAL_APP" "$DELTA_FILTER"
copy_delta app.fundamentals_quarterly "$NEON_APP_URL" "$LOCAL_APP" "$DELTA_FILTER"
copy_delta app.metrics_snapshot       "$NEON_APP_URL" "$LOCAL_APP" "$DELTA_FILTER"
copy_delta app.scores                 "$NEON_APP_URL" "$LOCAL_APP" "$DELTA_FILTER"
copy_delta app.shareholding_pattern   "$NEON_APP_URL" "$LOCAL_APP" "$DELTA_FILTER"
copy_delta app.screener_meta          "$NEON_APP_URL" "$LOCAL_APP" "$DELTA_FILTER"
copy_delta app.cluster_assignment     "$NEON_APP_URL" "$LOCAL_APP" "$DELTA_FILTER"

# ----- step 3 & 4: golden_db (stocks parent first, then price_history) ----
echo "▶ [3/8] computing golden delta filter..."
GOLDEN_DELTA_FILTER=$(psql "$LOCAL_APP" -tAc "
  SELECT string_agg('''' || symbol || '.NS''', ',')
  FROM app.universe WHERE is_nifty200 AND NOT is_nifty50
")
GOLDEN_WHERE="symbol IN ($GOLDEN_DELTA_FILTER)"

echo "▶ [4/8] inserting delta rows into golden.stocks..."
copy_delta golden.stocks "$NEON_GOLDEN_URL" "$LOCAL_GOLDEN" "$GOLDEN_WHERE"

echo "▶ [5/8] inserting delta price history (1d only) — slowest step..."
copy_delta golden.price_history "$NEON_GOLDEN_URL" "$LOCAL_GOLDEN" "$GOLDEN_WHERE AND interval = '1d'"

# ----- verify ------------------------------------------------------------
echo
echo "▶ verification:"
psql "$NEON_APP_URL" -c "
  SELECT 'universe (Nifty200)'  AS tbl, COUNT(*) AS rows FROM app.universe WHERE is_nifty200
  UNION ALL SELECT 'universe (Nifty50)',   COUNT(*) FROM app.universe WHERE is_nifty50
  UNION ALL SELECT 'fund. annual',         COUNT(*) FROM app.fundamentals_annual
  UNION ALL SELECT 'fund. quarterly',      COUNT(*) FROM app.fundamentals_quarterly
  UNION ALL SELECT 'metrics_snapshot',     COUNT(*) FROM app.metrics_snapshot
  UNION ALL SELECT 'scores',               COUNT(*) FROM app.scores
  UNION ALL SELECT 'shareholding_pattern', COUNT(*) FROM app.shareholding_pattern
  UNION ALL SELECT 'screener_meta',        COUNT(*) FROM app.screener_meta
  UNION ALL SELECT 'cluster_assignment',   COUNT(*) FROM app.cluster_assignment;
"
psql "$NEON_GOLDEN_URL" -c "
  SELECT COUNT(DISTINCT symbol) AS symbols, COUNT(*) AS price_rows
  FROM golden.price_history;
"
psql "$NEON_APP_URL"    -c "SELECT pg_size_pretty(pg_database_size(current_database())) AS app_db_live_size;"
psql "$NEON_GOLDEN_URL" -c "SELECT pg_size_pretty(pg_database_size(current_database())) AS golden_db_live_size;"

echo
echo "✓ delta sync complete at $(date -Iseconds)"
echo "  Vercel app should now show ~200 stocks at /discover."
