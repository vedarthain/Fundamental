#!/usr/bin/env bash
# ==============================================================================
# cron-momentum-scanner.sh — Daily Momentum, Trend Leaders & Support Floor Scans
# Runs Mon–Fri at 8:30 PM IST (15:00 UTC) on the Droplet.
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
  echo "❌ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Momentum Scanner failed with exit code $exit_code. Sending alert..."
  "$PYTHON_BIN" scripts/send-alert.py \
    --subject "🚨 [Finance-Server] Momentum Scanner Failed (Exit: $exit_code)" \
    --log-file "/var/log/fundamental-momentum-scanner.log" \
    --tail 60 \
    --message "cron-momentum-scanner.sh encountered an error and exited with status $exit_code." || true
  exit "$exit_code"
}
trap 'handle_failure' ERR

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Daily Momentum Scanner Pipeline"
echo "================================================================================"

for env_path in web/.env.production web/.env.local web/.env .env.production .env.local .env; do
  if [ -f "$env_path" ] && grep -q "REVALIDATE_TOKEN" "$env_path"; then
    set -a
    # shellcheck disable=SC1090
    . "$env_path"
    set +a
    break
  fi
done

TOKEN="${REVALIDATE_TOKEN:-}"

run_endpoint() {
  local name="$1"
  local url="$2"
  echo "=== Running $name ==="
  local body
  body=$(mktemp)
  local code
  code=$(curl -sS -o "$body" -w "%{http_code}" --max-time 120 "$url" -H "Authorization: Bearer $TOKEN" || echo "000")
  echo "HTTP $code: $(cat "$body")"
  if [ "$code" != "200" ]; then
    echo "Warning: $name failed with HTTP $code"
  fi
  rm -f "$body"
}

run_endpoint "Momentum Radar" "http://localhost:3000/api/cron/momentum-signals"
run_endpoint "Trend Leaders" "http://localhost:3000/api/cron/trend-leaders"
run_endpoint "At Support Floor" "http://localhost:3000/api/cron/support-floor"
run_endpoint "Portfolio Snapshot" "http://localhost:3000/api/cron/portfolio-snapshot"

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Momentum Scanner Pipeline Completed"
echo "================================================================================"
