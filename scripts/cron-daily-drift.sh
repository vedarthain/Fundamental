#!/usr/bin/env bash
# ==============================================================================
# cron-daily-drift.sh — Nightly fundamental verdict evidence drift refresh
# Runs every night at 11:00 PM IST (17:30 UTC) on the Droplet.
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
  echo "❌ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Job failed with exit code $exit_code. Sending alert..."
  "$PYTHON_BIN" scripts/send-alert.py \
    --subject "🚨 [Finance-Server] Daily Verdict Drift Failed (Exit: $exit_code)" \
    --log-file "/var/log/fundamental-daily-drift.log" \
    --tail 60 \
    --message "cron-daily-drift.sh encountered an error and exited with status $exit_code." || true
  exit "$exit_code"
}
trap 'handle_failure' ERR

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Daily Verdict Drift Catch-Up"
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

# Run up to 250 drifted stocks with 2 workers and 2.0s delay to stay under Gemini RPM limits
$PYTHON_BIN scripts/ollama-verdict.py \
  --drift \
  --engine gemini \
  --limit 250 \
  --workers 2 \
  --delay 2.0 \
  --load

# Purge Next.js local cache tags
if [ -n "${REVALIDATE_TOKEN:-}" ]; then
  echo "Purging Next.js cache tags..."
  curl -s -X POST "http://localhost:3000/api/revalidate?token=$REVALIDATE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"tags":["market","panel-cache","snapshot","sectors","calls"]}' || true
  echo ""

  echo "Pre-warming Calls Desk cache..."
  curl -s "http://localhost:3000/api/admin/calls?warm=1&refresh=1&token=$REVALIDATE_TOKEN" >/dev/null 2>&1 || true
fi

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Daily Verdict Drift Run Completed"
echo "================================================================================"
