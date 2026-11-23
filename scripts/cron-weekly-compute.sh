#!/usr/bin/env bash
# ==============================================================================
# cron-weekly-compute.sh — Weekly Scoring, Rankings & Market Snapshot Engine
# Runs Saturdays at 8:30 AM IST (03:00 UTC) on the Droplet.
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
  echo "❌ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Weekly Compute failed with exit code $exit_code. Sending alert..."
  "$PYTHON_BIN" scripts/send-alert.py \
    --subject "🚨 [Finance-Server] Weekly Compute & Scoring Failed (Exit: $exit_code)" \
    --log-file "/var/log/fundamental-weekly-compute.log" \
    --tail 60 \
    --message "cron-weekly-compute.sh encountered an error and exited with status $exit_code." || true
  exit "$exit_code"
}
trap 'handle_failure' ERR

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Weekly Compute & Scoring Pipeline"
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

echo "=== 1. Checking fetch coverage ==="
$PYTHON_BIN scripts/check-fetch-coverage.py --within-days 10 --min-pct 90 || true

echo "=== 2. Assigning clusters ==="
$PYTHON_BIN -m fundamental_etl.cli assign-clusters

echo "=== 3. Computing metrics ==="
$PYTHON_BIN -m fundamental_etl.cli compute-metrics

echo "=== 4. Scoring universe ==="
$PYTHON_BIN -m fundamental_etl.cli score

echo "=== 5. Re-rendering evidence sheets ==="
$PYTHON_BIN scripts/evidence-sheet-rebuild.py || true

echo "=== 6. Rebuilding market snapshot cache ==="
$PYTHON_BIN scripts/build-market-snapshot.py || true

echo "=== 7. Purging Local Next.js Cache ==="
if [ -n "${REVALIDATE_TOKEN:-}" ]; then
  curl -s -X POST "http://localhost:3000/api/revalidate?token=$REVALIDATE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"tags":["market","panel-cache","snapshot","sectors","scores"]}' || true

  echo "=== 8. Pre-warming Calls Desk Cache ==="
  curl -s "http://localhost:3000/api/admin/calls?warm=1&refresh=1&token=$REVALIDATE_TOKEN" >/dev/null 2>&1 || true
fi

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Weekly Compute Pipeline Completed"
echo "================================================================================"
