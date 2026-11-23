#!/usr/bin/env bash
# ==============================================================================
# cron-refresh-ltp.sh — End-of-Day Bhavcopy & Market Data Pipeline
# Runs Mon–Fri at 7:25 PM IST (13:55 UTC) on the Droplet.
# ==============================================================================
set -euo pipefail

ROOT_DIR="/var/www/Fundamental"
cd "$ROOT_DIR"

PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="python3"
fi

handle_failure() {
  local exit_code=$?
  echo "❌ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] EOD Refresh LTP failed with exit code $exit_code. Sending alert..."
  "$PYTHON_BIN" scripts/send-alert.py \
    --subject "🚨 [Finance-Server] EOD Bhavcopy & LTP Refresh Failed (Exit: $exit_code)" \
    --log-file "/var/log/fundamental-refresh-ltp.log" \
    --tail 60 \
    --message "cron-refresh-ltp.sh encountered an error and exited with status $exit_code." || true
  exit "$exit_code"
}
trap 'handle_failure' ERR

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting EOD Bhavcopy & Market Data Pipeline"
echo "================================================================================"

for env_path in web/.env.production web/.env.local web/.env .env.production .env.local .env; do
  if [ -f "$env_path" ] && grep -q "APP_DB_URL" "$env_path"; then
    set -a
    # shellcheck disable=SC1090
    . "$env_path"
    set +a
    break
  fi
done

export FUNDAMENTAL_ALLOW_REMOTE_DB="1"
export PYTHONUNBUFFERED=1

echo "=== 1. Refreshing LTP + OHLC from Bhavcopy ==="
$PYTHON_BIN scripts/refresh-ltp.py

echo "=== 2. Refreshing NSE Indices ==="
$PYTHON_BIN scripts/fetch-indices.py || true

echo "=== 3. Refreshing FII / DII Flows ==="
$PYTHON_BIN scripts/fetch-fii-dii.py || true

echo "=== 4. Purging Local Next.js Cache ==="
if [ -n "${REVALIDATE_TOKEN:-}" ]; then
  curl -s -X POST "http://localhost:3000/api/revalidate?token=$REVALIDATE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"tags":["market","panel-cache","snapshot","sectors","prices","movers","indices"]}' || true

  echo "=== 5. Pre-warming Calls Desk Cache ==="
  curl -s "http://localhost:3000/api/admin/calls?warm=1&refresh=1&token=$REVALIDATE_TOKEN" >/dev/null 2>&1 || true
fi

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] EOD Market Data Pipeline Completed"
echo "================================================================================"
