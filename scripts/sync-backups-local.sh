#!/usr/bin/env bash
# scripts/sync-backups-local.sh
#
# Pull PostgreSQL backups (/var/backups/postgres/*.sql.gz) from OCI Production VM
# to a local directory on your Mac for off-site disaster recovery.
#
# Usage:
#   scripts/sync-backups-local.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

SSH_KEY="${PROD_SSH_KEY:-$HOME/.ssh/oci_equityroots_ed25519}"
SSH_HOST="${PROD_SSH_HOST:-ubuntu@129.225.81.247}"
REMOTE_BACKUP_DIR="/var/backups/postgres/"
LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-$ROOT_DIR/build/backups}"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "✗ SSH key not found: $SSH_KEY" >&2
  exit 1
fi

mkdir -p "$LOCAL_BACKUP_DIR"

echo "▶ Syncing OCI Postgres backups -> $LOCAL_BACKUP_DIR..."
rsync -avh --progress --delete \
  -e "ssh -i $SSH_KEY -o BatchMode=yes" \
  "$SSH_HOST:$REMOTE_BACKUP_DIR" "$LOCAL_BACKUP_DIR/"

echo "✓ Off-site backup sync complete:"
ls -lh "$LOCAL_BACKUP_DIR"
