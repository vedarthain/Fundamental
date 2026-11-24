#!/usr/bin/env bash
# scripts/deploy-web.sh
#
# Fast, low-compute deployment script for EquityRoots web app.
#
# Builds Next.js locally on your development machine (taking ~7s instead of
# 6 minutes of swap thrashing on the 1GB droplet), rsyncs the compiled .next
# output directly to the production droplet, updates path manifests, and
# reloads PM2 with zero downtime.
#
# Usage:
#   scripts/deploy-web.sh              # Full local build + rsync + PM2 reload
#   scripts/deploy-web.sh --skip-build # Skip local build and rsync existing .next
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$ROOT_DIR/web"

SSH_KEY="${PROD_SSH_KEY:-$HOME/.ssh/oci_equityroots_ed25519}"
SSH_HOST="${PROD_SSH_HOST:-ubuntu@129.225.81.247}"
REMOTE_PATH="/var/www/Fundamental"
REMOTE_WEB="$REMOTE_PATH/web"

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build)
      SKIP_BUILD=true
      ;;
    -h|--help)
      echo "Usage: $0 [--skip-build]"
      exit 0
      ;;
  esac
done

if [[ ! -f "$SSH_KEY" ]]; then
  echo "❌ SSH key not found at $SSH_KEY" >&2
  exit 1
fi

START_TIME=$(date +%s)
echo "🚀 Starting fast local-to-production deployment..."

# Step 1: Build Next.js locally
if [ "$SKIP_BUILD" = false ]; then
  echo "📦 Building Next.js locally on high-compute Mac..."
  (cd "$WEB_DIR" && npm run build)
else
  echo "⏭️ Skipping build as requested, using existing web/.next"
fi

if [ ! -d "$WEB_DIR/.next" ]; then
  echo "❌ Error: $WEB_DIR/.next does not exist. Run build first." >&2
  exit 1
fi

# Step 2: Ensure droplet git repo is up to date with origin/main
echo "📥 Syncing git repo on droplet..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SSH_HOST" \
  "cd $REMOTE_PATH && git pull origin main"

# Step 3: Rsync compiled .next directory (excluding cache & dev)
echo "⚡ Transferring compiled artifacts to droplet..."
rsync -avz --delete \
  --exclude 'cache' \
  --exclude 'dev' \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
  "$WEB_DIR/.next/" "$SSH_HOST:$REMOTE_WEB/.next/"

# Step 4: Fix path references in required-server-files & reload PM2
echo "🔄 Updating server paths and reloading PM2..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SSH_HOST" "
  sed -i 's|$WEB_DIR|$REMOTE_WEB|g' $REMOTE_WEB/.next/required-server-files.json $REMOTE_WEB/.next/required-server-files.js 2>/dev/null || true
  pm2 reload equityroots
"

# Step 5: Verification
echo "🔍 Verifying site health..."
sleep 2
HEALTH=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SSH_HOST" "curl -s http://localhost:3000/api/version")
echo "✅ Health check: $HEALTH"

END_TIME=$(date +%s)
DIFF=$((END_TIME - START_TIME))
echo "🎉 Deployment successfully completed in ${DIFF}s!"
