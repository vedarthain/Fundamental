#!/usr/bin/env bash
# Shared helper for EquityRoots server cron scripts.
# Provides single-instance flock locking, .env loading, low-priority CPU/IO
# execution (so Next.js & Postgres stay responsive), and Resend failure traps.

ROOT_DIR="/var/www/Fundamental"
cd "$ROOT_DIR"

PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="python3"
fi

load_env() {
  local env_path
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
}

acquire_lock() {
  local name="$1"
  local lock_file="/tmp/fundamental-${name}.lock"
  exec 9>"$lock_file"
  if ! flock -n 9; then
    echo "⏭️ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $name is already running (lock held). Skipping."
    exit 0
  fi
}

run_low_prio() {
  if command -v ionice >/dev/null 2>&1; then
    nice -n 10 ionice -c2 -n7 "$@"
  else
    nice -n 10 "$@"
  fi
}

setup_failure_trap() {
  local log_name="$1"
  local title="$2"
  CRON_LOG_FILE="/var/log/fundamental-${log_name}.log"
  CRON_TITLE="$title"
  handle_failure() {
    local exit_code=$?
    echo "❌ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $CRON_TITLE failed with exit code $exit_code. Sending alert..."
    "$PYTHON_BIN" "$ROOT_DIR/scripts/send-alert.py" \
      --subject "🚨 [Finance-Server] $CRON_TITLE Failed (Exit: $exit_code)" \
      --log-file "$CRON_LOG_FILE" \
      --tail 60 \
      --message "$CRON_TITLE encountered an error and exited with status $exit_code." || true
    exit "$exit_code"
  }
  trap 'handle_failure' ERR
}
