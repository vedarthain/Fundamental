#!/usr/bin/env bash
# ==============================================================================
# cron-db-backup.sh — Daily PostgreSQL Backup with 30-Day Rolling Retention
# Runs daily at 7:30 AM IST (02:00 UTC) on the Droplet.
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
  echo "❌ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Database Backup failed with exit code $exit_code. Sending alert..."
  "$PYTHON_BIN" scripts/send-alert.py \
    --subject "🚨 [Finance-Server] Database Backup Failed (Exit: $exit_code)" \
    --log-file "/var/log/fundamental-db-backup.log" \
    --tail 60 \
    --message "cron-db-backup.sh encountered an error and exited with status $exit_code." || true
  exit "$exit_code"
}
trap 'handle_failure' ERR

echo "================================================================================"
echo "🕒 [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Daily Database Backup"
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

if [ -z "${APP_DB_URL:-}" ]; then
  echo "Error: APP_DB_URL not found in environment files."
  exit 1
fi

BACKUP_DIR="/var/backups/postgres"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="30"

# 1. Backup fundamental_app
APP_BACKUP="${BACKUP_DIR}/fundamental_app_${TIMESTAMP}.sql.gz"
echo "Dumping fundamental_app -> $APP_BACKUP..."
pg_dump "$APP_DB_URL" --no-owner --no-acl | gzip -9 > "$APP_BACKUP"
echo "✓ fundamental_app dump completed: $(du -h "$APP_BACKUP" | cut -f1)"

# 2. Backup golden_db (if configured)
if [ -n "${GOLDEN_DB_URL:-}" ]; then
  GOLDEN_BACKUP="${BACKUP_DIR}/golden_db_${TIMESTAMP}.sql.gz"
  echo "Dumping golden_db -> $GOLDEN_BACKUP..."
  pg_dump "$GOLDEN_DB_URL" --no-owner --no-acl | gzip -9 > "$GOLDEN_BACKUP"
  echo "✓ golden_db dump completed: $(du -h "$GOLDEN_BACKUP" | cut -f1)"
fi

# 3. Clean up backups older than retention days (30 days)
echo "=== Pruning backups older than $RETENTION_DAYS days ==="
find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +"$RETENTION_DAYS" -exec echo "Removing stale backup: {}" \; -delete

# 4. Inventory
echo "=== Current Backups in $BACKUP_DIR ==="
ls -lh "$BACKUP_DIR" | tail -n 10
echo "=== Disk Usage ==="
df -h /

echo "================================================================================"
echo "✅ [$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Database Backup Completed Successfully"
echo "================================================================================"
