#!/usr/bin/env bash
# ==============================================================================
# cron-sunday-calls.sh — Sunday Calls & Portfolio Audit
# Runs every Sunday at 2:00 PM IST (08:30 UTC) on the Droplet.
# Sends failure email alert if any command errors out.
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
  echo "❌ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Sunday Calls failed with exit code $exit_code. Sending alert..."
  "$PYTHON_BIN" scripts/send-alert.py \
    --subject "🚨 [Finance-Server] Sunday Calls & Audit Failed (Exit: $exit_code)" \
    --log-file "/var/log/fundamental-sunday-calls.log" \
    --tail 60 \
    --message "cron-sunday-calls.sh encountered an error and exited with status $exit_code." || true
  exit "$exit_code"
}
trap 'handle_failure' ERR

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Sunday Calls & Portfolio Audit"
echo "================================================================================"

# Load environment
for env_path in web/.env.local web/.env.production web/.env .env.local .env; do
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

echo "=== 1. Computing institutional target prices & accumulation zones ==="
$PYTHON_BIN scripts/backfill_target_prices.py

echo "=== 2. Running cluster calls & portfolio sweep audit ==="
$PYTHON_BIN scripts/audit_cluster_calls.py

echo "=== 3. Generating Gemini verdicts for weekly new calls & portfolio holdings ==="
if [ -n "${GEMINI_API_KEY:-}" ]; then
  $PYTHON_BIN scripts/ollama-verdict.py \
    --weekly-new-portfolio --engine gemini --load --workers 3 --delay 1.0
else
  echo "Warning: GEMINI_API_KEY not set, skipping Gemini verdict pass."
fi

echo "=== 4. Purging Local Next.js Cache ==="
if [ -n "${REVALIDATE_TOKEN:-}" ]; then
  curl -s -X POST "http://localhost:3000/api/revalidate?token=$REVALIDATE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"tags":["market","panel-cache","snapshot","sectors","calls"]}' || true
fi

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Sunday Calls & Audit Completed"
echo "================================================================================"
