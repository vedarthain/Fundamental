#!/usr/bin/env bash
#
# token_vercel_generator.sh — rotate REVALIDATE_TOKEN.
#
# Generates a fresh 64-char hex token, writes/updates REVALIDATE_TOKEN in
# the repo's .env.local (persistent across reboots, gitignored), copies it
# to the clipboard, and prints the manual steps needed on Vercel.
#
# Why a script: macOS clears /tmp on reboot, which means storing the token
# there is fragile. We've also been doing this dance three times — once
# to set up, once after losing the file, once after a manual reset — so
# wrapping it in a single command avoids re-discovering the procedure.
#
# Usage:
#   scripts/token_vercel_generator.sh
#
# After running:
#   1. The token is in your clipboard (Cmd+V to paste).
#   2. Open Vercel → Project → Settings → Environment Variables.
#   3. Edit REVALIDATE_TOKEN, paste, save with all 3 envs ticked.
#   4. Deployments → latest → ⋯ → Redeploy (do NOT use existing cache).
#   5. Run the test curl printed at the end.

set -euo pipefail

# Resolve repo root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl not found on PATH" >&2
  exit 1
fi

TOKEN="$(openssl rand -hex 32)"

# Make sure the env file exists so the sed/grep paths below don't fail
# on a fresh clone.
[ -f "$ENV_FILE" ] || touch "$ENV_FILE"

# In-place upsert of REVALIDATE_TOKEN.  macOS BSD sed needs "''" after
# -i; GNU sed accepts plain "-i".  We branch on uname to stay portable
# across both laptops and any Linux machine running this script.
if grep -q '^REVALIDATE_TOKEN=' "$ENV_FILE"; then
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^REVALIDATE_TOKEN=.*|REVALIDATE_TOKEN=$TOKEN|" "$ENV_FILE"
  else
    sed -i "s|^REVALIDATE_TOKEN=.*|REVALIDATE_TOKEN=$TOKEN|" "$ENV_FILE"
  fi
  ACTION="updated"
else
  echo "REVALIDATE_TOKEN=$TOKEN" >> "$ENV_FILE"
  ACTION="added"
fi

# Copy to clipboard if we can. Falls back silently on Linux without xclip
# / wl-copy — the user can still copy from the printed line.
if command -v pbcopy >/dev/null 2>&1; then
  printf "%s" "$TOKEN" | pbcopy
  CLIPBOARD_NOTE="(token is in your clipboard — Cmd+V to paste)"
elif command -v wl-copy >/dev/null 2>&1; then
  printf "%s" "$TOKEN" | wl-copy
  CLIPBOARD_NOTE="(token is in your clipboard — Ctrl+V to paste)"
elif command -v xclip >/dev/null 2>&1; then
  printf "%s" "$TOKEN" | xclip -selection clipboard
  CLIPBOARD_NOTE="(token is in your clipboard — Ctrl+V to paste)"
else
  CLIPBOARD_NOTE="(no clipboard helper detected — copy the line above by hand)"
fi

# Friendly summary
cat <<EOF

REVALIDATE_TOKEN $ACTION in $ENV_FILE.
Length: ${#TOKEN} chars  ·  first 6: ${TOKEN:0:6}…

$CLIPBOARD_NOTE

Next steps on Vercel:
  1. Open Project → Settings → Environment Variables
  2. Find REVALIDATE_TOKEN → ⋯ → Edit
  3. Paste (Cmd+V), tick Production + Preview + Development, Save
  4. Deployments → latest → ⋯ → Redeploy (UNCHECK "use existing build cache")

After the redeploy finishes (~60 s), test:

  TOKEN=\$(grep '^REVALIDATE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  curl -sS -X POST "https://equityroots.in/api/revalidate" \\
    -H "Authorization: Bearer \$TOKEN" \\
    -H "Content-Type: application/json" \\
    -d '{"tags":["market","panel-cache","snapshot"]}'

Expect: {"ok":true,"revalidated":{"tags":[...],"paths":[]}}
EOF
