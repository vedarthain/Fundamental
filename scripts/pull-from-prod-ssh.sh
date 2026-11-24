#!/usr/bin/env bash
# scripts/pull-from-prod-ssh.sh
#
# On-demand pull from DigitalOcean Production Postgres (10.122.0.3:5432)
# over a temporary SSH tunnel through Finance-server (168.144.158.66).
# Closes the tunnel automatically on exit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

SSH_KEY="${PROD_SSH_KEY:-$HOME/.ssh/oci_equityroots_ed25519}"
SSH_HOST="${PROD_SSH_HOST:-ubuntu@129.225.81.247}"
VPC_DB_HOST="${PROD_VPC_DB_HOST:-127.0.0.1}"
LOCAL_PORT="${PROD_TUNNEL_PORT:-15432}"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "✗ SSH key not found: $SSH_KEY" >&2
  exit 1
fi

echo "▶ Fetching production DB connection strings over SSH..."
PROD_ENV=$(ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" \
  'grep -hE "^(APP_DB_URL|GOLDEN_DB_URL)=" /var/www/Fundamental/.env* /var/www/Fundamental/web/.env* 2>/dev/null | head -n 2')

PROD_APP_URL=$(echo "$PROD_ENV" | grep '^APP_DB_URL=' | head -n 1 | cut -d= -f2- | tr -d "\"'")
PROD_GOLDEN_URL=$(echo "$PROD_ENV" | grep '^GOLDEN_DB_URL=' | head -n 1 | cut -d= -f2- | tr -d "\"'")

if [[ -z "$PROD_APP_URL" || -z "$PROD_GOLDEN_URL" ]]; then
  echo "✗ Could not read APP_DB_URL / GOLDEN_DB_URL from $SSH_HOST" >&2
  exit 1
fi

TUNNEL_PID=""
cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    echo "▶ Closed SSH tunnel (pid $TUNNEL_PID)."
  fi
}
trap cleanup EXIT

echo "▶ Opening temporary SSH tunnel 127.0.0.1:${LOCAL_PORT} -> ${VPC_DB_HOST}:5432..."
ssh -i "$SSH_KEY" -o BatchMode=yes -o ExitOnForwardFailure=yes -N \
  -L "127.0.0.1:${LOCAL_PORT}:${VPC_DB_HOST}:5432" "$SSH_HOST" &
TUNNEL_PID=$!

# Wait briefly for local port to listen
for _ in $(seq 1 20); do
  if nc -z 127.0.0.1 "$LOCAL_PORT" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

export NEON_APP_URL="${PROD_APP_URL//${VPC_DB_HOST}:5432/127.0.0.1:${LOCAL_PORT}}"
export NEON_GOLDEN_URL="${PROD_GOLDEN_URL//${VPC_DB_HOST}:5432/127.0.0.1:${LOCAL_PORT}}"

bash "$ROOT_DIR/scripts/pull-from-neon.sh"
