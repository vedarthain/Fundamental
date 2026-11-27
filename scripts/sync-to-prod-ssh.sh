#!/usr/bin/env bash
# scripts/sync-to-prod-ssh.sh
#
# Sync locally generated moats (app.company_moat), verdicts (app.stock_verdict),
# and/or portfolio holdings (app.portfolio_holding) directly to DigitalOcean
# Production Postgres (10.122.0.3:5432) via Finance-server.
#
# Usage:
#   scripts/sync-to-prod-ssh.sh             # Syncs moat, verdicts, and portfolio
#   scripts/sync-to-prod-ssh.sh --portfolio # Syncs only portfolio_holding
#   scripts/sync-to-prod-ssh.sh --moat      # Syncs only company_moat
#   scripts/sync-to-prod-ssh.sh --verdicts  # Syncs only stock_verdict
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

SSH_KEY="${PROD_SSH_KEY:-$HOME/.ssh/oci_equityroots_ed25519}"
SSH_HOST="${PROD_SSH_HOST:-ubuntu@129.225.81.247}"
LOCAL_APP="${LOCAL_APP_DB:-fundamental_app}"

SYNC_MOAT=true
SYNC_VERDICTS=true
SYNC_PORTFOLIO=true
SYNC_CONCALLS=true

for arg in "$@"; do
  case "$arg" in
    --moat)
      SYNC_MOAT=true
      SYNC_VERDICTS=false
      SYNC_PORTFOLIO=false
      SYNC_CONCALLS=false
      ;;
    --verdicts)
      SYNC_MOAT=false
      SYNC_VERDICTS=true
      SYNC_PORTFOLIO=false
      SYNC_CONCALLS=false
      ;;
    --portfolio)
      SYNC_MOAT=false
      SYNC_VERDICTS=false
      SYNC_PORTFOLIO=true
      SYNC_CONCALLS=false
      ;;
    --concalls)
      SYNC_MOAT=false
      SYNC_VERDICTS=false
      SYNC_PORTFOLIO=false
      SYNC_CONCALLS=true
      ;;
    --all)
      SYNC_MOAT=true
      SYNC_VERDICTS=true
      SYNC_PORTFOLIO=true
      SYNC_CONCALLS=true
      ;;
    -h|--help)
      echo "Usage: $0 [--moat | --verdicts | --portfolio | --concalls | --all]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

if [[ ! -f "$SSH_KEY" ]]; then
  echo "✗ SSH key not found: $SSH_KEY" >&2
  exit 1
fi

LOCAL_TMP_DIR="$(mktemp -d)"
REMOTE_TMP_DIR="/tmp/sync_prod_$(date +%s)_$$"

cleanup() {
  rm -rf "$LOCAL_TMP_DIR"
  ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "rm -rf '$REMOTE_TMP_DIR'" 2>/dev/null || true
}
trap cleanup EXIT

echo "================================================================================"
echo "🚀 SYNC TO PRODUCTION POSTGRES (DigitalOcean via $SSH_HOST)"
echo "================================================================================"
echo "  Source (Local DB): $LOCAL_APP"
echo "  Target Server:     $SSH_HOST"
echo "  Sync Moat:         $SYNC_MOAT"
echo "  Sync Verdicts:     $SYNC_VERDICTS"
echo "  Sync Portfolio:    $SYNC_PORTFOLIO"
echo "================================================================================"

# Step 0: Ensure remote temp directory
ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "mkdir -p '$REMOTE_TMP_DIR'"

# ------------------------------------------------------------------------------
# 1. SYNC MOAT (app.company_moat)
# ------------------------------------------------------------------------------
if [[ "$SYNC_MOAT" == true ]]; then
  echo ""
  echo "▶ [1/3] Syncing app.company_moat..."

  LOCAL_MOAT_COUNT=$(psql "$LOCAL_APP" -tAc "SELECT count(*) FROM app.company_moat;")
  echo "  Local moat count: $LOCAL_MOAT_COUNT rows"

  if [[ "$LOCAL_MOAT_COUNT" -eq 0 ]]; then
    echo "  (No rows in local app.company_moat — skipping)"
  else
    MOAT_FILE="$LOCAL_TMP_DIR/company_moat.tsv"
    psql "$LOCAL_APP" -c "\COPY (SELECT symbol, moat_strength, moat_type, moat_points, model, generated_at FROM app.company_moat) TO STDOUT" > "$MOAT_FILE"

    echo "  Transferring $(wc -l < "$MOAT_FILE" | tr -d ' ') rows to production..."
    scp -i "$SSH_KEY" -o BatchMode=yes "$MOAT_FILE" "$SSH_HOST:$REMOTE_TMP_DIR/company_moat.tsv"

    echo "  Applying UPSERT to production DB..."
    ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "
      source /var/www/Fundamental/.env.local 2>/dev/null || source /var/www/Fundamental/web/.env.local 2>/dev/null || true
      psql \"\$APP_DB_URL\" -v ON_ERROR_STOP=1 <<SQL
CREATE TABLE IF NOT EXISTS app.company_moat (
    symbol TEXT PRIMARY KEY,
    moat_strength TEXT NOT NULL DEFAULT 'Narrow',
    moat_type TEXT NOT NULL DEFAULT 'Niche / Operational',
    moat_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    model TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TABLE IF EXISTS _temp_moat;
CREATE TEMP TABLE _temp_moat (LIKE app.company_moat INCLUDING ALL);
\COPY _temp_moat FROM '$REMOTE_TMP_DIR/company_moat.tsv';

INSERT INTO app.company_moat (symbol, moat_strength, moat_type, moat_points, model, generated_at)
SELECT symbol, moat_strength, moat_type, moat_points, model, generated_at FROM _temp_moat
ON CONFLICT (symbol) DO UPDATE SET
  moat_strength = EXCLUDED.moat_strength,
  moat_type = EXCLUDED.moat_type,
  moat_points = EXCLUDED.moat_points,
  model = EXCLUDED.model,
  generated_at = EXCLUDED.generated_at
WHERE EXCLUDED.generated_at >= app.company_moat.generated_at;

DROP TABLE IF EXISTS _temp_moat;
SQL
"
    echo "  ✓ app.company_moat sync completed successfully."
  fi
fi

# ------------------------------------------------------------------------------
# 2. SYNC VERDICTS (app.stock_verdict)
# ------------------------------------------------------------------------------
if [[ "$SYNC_VERDICTS" == true ]]; then
  echo ""
  echo "▶ [2/3] Syncing app.stock_verdict..."

  LOCAL_VERDICT_COUNT=$(psql "$LOCAL_APP" -tAc "SELECT count(*) FROM app.stock_verdict;")
  echo "  Local verdict count: $LOCAL_VERDICT_COUNT rows"

  if [[ "$LOCAL_VERDICT_COUNT" -eq 0 ]]; then
    echo "  (No rows in local app.stock_verdict — skipping)"
  else
    VERDICT_FILE="$LOCAL_TMP_DIR/stock_verdict.tsv"
    psql "$LOCAL_APP" -c "\COPY (SELECT symbol, generated_at, verdict, confidence, points, trigger_text, evidence, snapshot_date, price_asof, model, source_report, anchor_price, target_price, buy_below, bear_floor, upside_pct, valuation_method, fair_value FROM app.stock_verdict) TO STDOUT" > "$VERDICT_FILE"

    echo "  Transferring $(wc -l < "$VERDICT_FILE" | tr -d ' ') rows to production..."
    scp -i "$SSH_KEY" -o BatchMode=yes "$VERDICT_FILE" "$SSH_HOST:$REMOTE_TMP_DIR/stock_verdict.tsv"

    echo "  Applying UPSERT to production DB..."
    ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "
      source /var/www/Fundamental/.env.local 2>/dev/null || source /var/www/Fundamental/web/.env.local 2>/dev/null || true
      psql \"\$APP_DB_URL\" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _temp_verdict;
CREATE TEMP TABLE _temp_verdict (LIKE app.stock_verdict INCLUDING ALL);
\COPY _temp_verdict FROM '$REMOTE_TMP_DIR/stock_verdict.tsv';

INSERT INTO app.stock_verdict (
  symbol, generated_at, verdict, confidence, points, trigger_text,
  evidence, snapshot_date, price_asof, model, source_report, anchor_price,
  target_price, buy_below, bear_floor, upside_pct, valuation_method, fair_value
)
SELECT
  symbol, generated_at, verdict, confidence, points, trigger_text,
  evidence, snapshot_date, price_asof, model, source_report, anchor_price,
  target_price, buy_below, bear_floor, upside_pct, valuation_method, fair_value
FROM _temp_verdict
ON CONFLICT (symbol, generated_at) DO UPDATE SET
  verdict = EXCLUDED.verdict,
  confidence = EXCLUDED.confidence,
  points = EXCLUDED.points,
  trigger_text = EXCLUDED.trigger_text,
  evidence = EXCLUDED.evidence,
  snapshot_date = EXCLUDED.snapshot_date,
  price_asof = EXCLUDED.price_asof,
  model = EXCLUDED.model,
  source_report = EXCLUDED.source_report,
  anchor_price = EXCLUDED.anchor_price,
  target_price = EXCLUDED.target_price,
  fair_value = EXCLUDED.fair_value,
  buy_below = EXCLUDED.buy_below,
  bear_floor = EXCLUDED.bear_floor,
  upside_pct = EXCLUDED.upside_pct,
  valuation_method = EXCLUDED.valuation_method;

DROP TABLE IF EXISTS _temp_verdict;
SQL
"
    echo "  ✓ app.stock_verdict sync completed successfully."
  fi
fi

# ------------------------------------------------------------------------------
# 3. SYNC PORTFOLIO (app.portfolio_holding)
# ------------------------------------------------------------------------------
if [[ "$SYNC_PORTFOLIO" == true ]]; then
  echo ""
  echo "▶ [3/3] Syncing app.portfolio_holding..."

  LOCAL_HOLDING_COUNT=$(psql "$LOCAL_APP" -tAc "SELECT count(*) FROM app.portfolio_holding;")
  echo "  Local portfolio_holding count: $LOCAL_HOLDING_COUNT rows"

  if [[ "$LOCAL_HOLDING_COUNT" -eq 0 ]]; then
    echo "  (No rows in local app.portfolio_holding — skipping)"
  else
    HOLDING_FILE="$LOCAL_TMP_DIR/portfolio_holding.tsv"
    psql "$LOCAL_APP" -c "\COPY (SELECT user_id, broker, raw_symbol, isin, symbol, is_mapped, quantity, avg_cost, broker_ltp, broker_cur_value, broker_day_pct, source_batch, imported_at, first_seen_at FROM app.portfolio_holding) TO STDOUT" > "$HOLDING_FILE"

    echo "  Transferring $(wc -l < "$HOLDING_FILE" | tr -d ' ') rows to production..."
    scp -i "$SSH_KEY" -o BatchMode=yes "$HOLDING_FILE" "$SSH_HOST:$REMOTE_TMP_DIR/portfolio_holding.tsv"

    echo "  Applying UPSERT to production DB..."
    ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "
      source /var/www/Fundamental/.env.local 2>/dev/null || source /var/www/Fundamental/web/.env.local 2>/dev/null || true
      psql \"\$APP_DB_URL\" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS _temp_holding;
CREATE TEMP TABLE _temp_holding (LIKE app.portfolio_holding INCLUDING ALL);
\COPY _temp_holding (user_id, broker, raw_symbol, isin, symbol, is_mapped, quantity, avg_cost, broker_ltp, broker_cur_value, broker_day_pct, source_batch, imported_at, first_seen_at) FROM '$REMOTE_TMP_DIR/portfolio_holding.tsv';

INSERT INTO app.portfolio_holding (
  user_id, broker, raw_symbol, isin, symbol, is_mapped, quantity,
  avg_cost, broker_ltp, broker_cur_value, broker_day_pct, source_batch,
  imported_at, first_seen_at
)
SELECT
  user_id, broker, raw_symbol, isin, symbol, is_mapped, quantity,
  avg_cost, broker_ltp, broker_cur_value, broker_day_pct, source_batch,
  imported_at, first_seen_at
FROM _temp_holding
ON CONFLICT (user_id, broker, raw_symbol) DO UPDATE SET
  quantity = EXCLUDED.quantity,
  avg_cost = EXCLUDED.avg_cost,
  broker_ltp = EXCLUDED.broker_ltp,
  broker_cur_value = EXCLUDED.broker_cur_value,
  broker_day_pct = EXCLUDED.broker_day_pct,
  isin = EXCLUDED.isin,
  symbol = EXCLUDED.symbol,
  is_mapped = EXCLUDED.is_mapped,
  source_batch = EXCLUDED.source_batch,
  imported_at = EXCLUDED.imported_at,
  first_seen_at = EXCLUDED.first_seen_at;

DROP TABLE IF EXISTS _temp_holding;
SQL
"
    echo "  ✓ app.portfolio_holding sync completed successfully."
  fi
fi

# ------------------------------------------------------------------------------
# 3b. SYNC CONCALL SUMMARIES (app.concall_summary)
# ------------------------------------------------------------------------------
if [[ "$SYNC_CONCALLS" == true ]]; then
  echo ""
  echo "▶ Syncing app.concall_summary..."

  LOCAL_CONCALL_COUNT=$(psql "$LOCAL_APP" -tAc "SELECT count(*) FROM app.concall_summary;" 2>/dev/null || echo "0")
  echo "  Local concall count: $LOCAL_CONCALL_COUNT rows"

  if [[ "$LOCAL_CONCALL_COUNT" -eq 0 ]]; then
    echo "  (No rows in local app.concall_summary — skipping)"
  else
    CONCALL_FILE="$LOCAL_TMP_DIR/concall_summary.tsv"
    psql "$LOCAL_APP" -c "\COPY (SELECT symbol, announcement_id, quarter_label, published_at, pdf_url, tone, tone_rationale, highlights, qa_highlights, numbers_mentioned, model, source_sha256, verified_ratio, created_at FROM app.concall_summary) TO STDOUT" > "$CONCALL_FILE"

    echo "  Transferring $(wc -l < "$CONCALL_FILE" | tr -d ' ') rows to production..."
    scp -i "$SSH_KEY" -o BatchMode=yes "$CONCALL_FILE" "$SSH_HOST:$REMOTE_TMP_DIR/concall_summary.tsv"

    ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "
      source /var/www/Fundamental/.env.local 2>/dev/null || source /var/www/Fundamental/web/.env.local 2>/dev/null || true
      psql \"\$APP_DB_URL\" -v ON_ERROR_STOP=1 <<SQL
CREATE TABLE IF NOT EXISTS app.concall_summary (
    id               bigserial    PRIMARY KEY,
    symbol           text         NOT NULL REFERENCES app.universe(symbol) ON DELETE CASCADE,
    announcement_id  text         UNIQUE REFERENCES app.announcement(id) ON DELETE SET NULL,
    quarter_label    text,
    published_at     timestamptz  NOT NULL,
    pdf_url          text,
    tone             text         NOT NULL CHECK (tone IN ('Optimistic', 'Neutral', 'Cautious')),
    tone_rationale   text,
    highlights       jsonb        NOT NULL DEFAULT '[]'::jsonb,
    qa_highlights    jsonb        NOT NULL DEFAULT '[]'::jsonb,
    numbers_mentioned jsonb       NOT NULL DEFAULT '[]'::jsonb,
    model            text         NOT NULL,
    source_sha256    text         NOT NULL,
    verified_ratio   real         NOT NULL DEFAULT 1.0,
    created_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS concall_summary_symbol_pub_idx ON app.concall_summary (symbol, published_at DESC);
CREATE INDEX IF NOT EXISTS concall_summary_pub_idx ON app.concall_summary (published_at DESC);

DROP TABLE IF EXISTS _temp_concall;
CREATE TEMP TABLE _temp_concall (
    symbol text, announcement_id text, quarter_label text, published_at timestamptz,
    pdf_url text, tone text, tone_rationale text, highlights jsonb,
    qa_highlights jsonb, numbers_mentioned jsonb, model text,
    source_sha256 text, verified_ratio real, created_at timestamptz
);
\COPY _temp_concall FROM '$REMOTE_TMP_DIR/concall_summary.tsv';

INSERT INTO app.concall_summary (
    symbol, announcement_id, quarter_label, published_at, pdf_url, tone, tone_rationale,
    highlights, qa_highlights, numbers_mentioned, model, source_sha256, verified_ratio, created_at
)
SELECT t.symbol,
       CASE WHEN EXISTS (SELECT 1 FROM app.announcement a WHERE a.id = t.announcement_id) THEN t.announcement_id ELSE NULL END,
       t.quarter_label, t.published_at, t.pdf_url, t.tone, t.tone_rationale,
       t.highlights, t.qa_highlights, t.numbers_mentioned, t.model, t.source_sha256, t.verified_ratio, t.created_at
  FROM _temp_concall t
  JOIN app.universe u ON u.symbol = t.symbol
ON CONFLICT (announcement_id) DO UPDATE SET
  quarter_label = EXCLUDED.quarter_label,
  tone = EXCLUDED.tone,
  tone_rationale = EXCLUDED.tone_rationale,
  highlights = EXCLUDED.highlights,
  qa_highlights = EXCLUDED.qa_highlights,
  numbers_mentioned = EXCLUDED.numbers_mentioned,
  model = EXCLUDED.model,
  source_sha256 = EXCLUDED.source_sha256,
  verified_ratio = EXCLUDED.verified_ratio,
  created_at = EXCLUDED.created_at;

DROP TABLE IF EXISTS _temp_concall;
SQL
"
    echo "  ✓ app.concall_summary sync completed successfully."
  fi
fi

# ------------------------------------------------------------------------------
# 4. VERIFY PRODUCTION COUNTS & PRE-WARM CACHE
# ------------------------------------------------------------------------------
echo ""
echo "▶ Verifying production counts and revalidating cache..."
ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" bash -s <<'REMOTE_EOF'
  source /var/www/Fundamental/.env.local 2>/dev/null || source /var/www/Fundamental/web/.env.local 2>/dev/null || true
  psql "$APP_DB_URL" <<'SQL'
SELECT
  (SELECT count(*) FROM app.company_moat) AS prod_moat_count,
  (SELECT count(*) FROM app.stock_verdict) AS prod_verdict_count,
  (SELECT count(*) FROM app.portfolio_holding) AS prod_holding_count,
  (SELECT count(*) FROM app.concall_summary) AS prod_concall_count;
SQL
  pm2 reload equityroots --update-env >/dev/null 2>&1 || true
  if [[ -n "${REVALIDATE_TOKEN:-}" ]]; then
    echo "  Triggering production cache keep-warm..."
    curl -s -X POST "http://localhost:3000/api/cron/keep-warm?force=1&token=$REVALIDATE_TOKEN" >/dev/null || true
    echo "  ✓ Cache warm-up triggered."
  fi
REMOTE_EOF

echo ""
echo "================================================================================"
echo "✅ PRODUCTION SYNC COMPLETE!"
echo "================================================================================"
