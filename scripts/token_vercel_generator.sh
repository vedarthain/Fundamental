#!/usr/bin/env bash
#
# token_vercel_generator.sh — rotate any of the platform's server-side
# tokens that live in BOTH .env.local AND Vercel env vars.
#
# Pass the token name as the first argument. The script:
#   1. Generates a fresh 64-char hex value via openssl
#   2. Upserts <NAME>=<value> in repo root .env.local (persistent, gitignored)
#   3. Copies the value to the OS clipboard (pbcopy / wl-copy / xclip)
#   4. Prints the Vercel UI steps and a verification snippet
#
# Why a script: macOS clears /tmp on reboot, and we've burned an hour on
# wrong-token rabbit holes (extra newline, wrong env scope, etc.). Wrap
# the dance once, run it whenever a rotation is needed.
#
# Supported tokens (anything matching this set passes validation):
#   ADMIN_TOKEN       — gates /admin/* pages (admin auth cookie)
#   REVALIDATE_TOKEN  — gates /api/revalidate (cache-purge endpoint)
#   SESSION_SECRET    — signs user auth cookies (only matters for local dev;
#                       on Vercel it stands alone, no rotation needed in
#                       step with the above)
#
# Usage:
#   scripts/token_vercel_generator.sh ADMIN_TOKEN
#   scripts/token_vercel_generator.sh REVALIDATE_TOKEN
#   scripts/token_vercel_generator.sh                    # interactive picker
#
# After running, follow the on-screen Vercel UI steps + redeploy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

# ---------------------------------------------------------------------------
# Token name dispatch.
# Each entry maps a token name to a one-line description + a per-token
# verification snippet to print at the end. Add new tokens here.
# ---------------------------------------------------------------------------

NAME="${1:-}"

declare -a SUPPORTED=("ADMIN_TOKEN" "REVALIDATE_TOKEN" "SESSION_SECRET")

# Interactive picker if no arg.
if [[ -z "$NAME" ]]; then
  echo "Which token do you want to rotate?"
  select choice in "${SUPPORTED[@]}"; do
    if [[ -n "${choice:-}" ]]; then
      NAME="$choice"
      break
    fi
  done
fi

# Validate.
matched=""
for s in "${SUPPORTED[@]}"; do
  if [[ "$s" == "$NAME" ]]; then matched="yes"; break; fi
done
if [[ -z "$matched" ]]; then
  echo "error: unknown token '$NAME'." >&2
  echo "Supported: ${SUPPORTED[*]}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Generate + upsert.
# ---------------------------------------------------------------------------

if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl not found on PATH" >&2
  exit 1
fi

TOKEN="$(openssl rand -hex 32)"
[ -f "$ENV_FILE" ] || touch "$ENV_FILE"

# In-place upsert. macOS BSD sed needs "-i ''"; GNU sed accepts plain "-i".
if grep -q "^${NAME}=" "$ENV_FILE"; then
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^${NAME}=.*|${NAME}=${TOKEN}|" "$ENV_FILE"
  else
    sed -i "s|^${NAME}=.*|${NAME}=${TOKEN}|" "$ENV_FILE"
  fi
  ACTION="updated"
else
  echo "${NAME}=${TOKEN}" >> "$ENV_FILE"
  ACTION="added"
fi

# ---------------------------------------------------------------------------
# Clipboard.
# ---------------------------------------------------------------------------

CLIPBOARD_NOTE=""
if command -v pbcopy >/dev/null 2>&1; then
  printf "%s" "$TOKEN" | pbcopy
  CLIPBOARD_NOTE="(token is in your clipboard — Cmd+V to paste into Vercel)"
elif command -v wl-copy >/dev/null 2>&1; then
  printf "%s" "$TOKEN" | wl-copy
  CLIPBOARD_NOTE="(token is in your clipboard — Ctrl+V to paste into Vercel)"
elif command -v xclip >/dev/null 2>&1; then
  printf "%s" "$TOKEN" | xclip -selection clipboard
  CLIPBOARD_NOTE="(token is in your clipboard — Ctrl+V to paste into Vercel)"
else
  CLIPBOARD_NOTE="(no clipboard helper detected — copy from the line below by hand)"
fi

# ---------------------------------------------------------------------------
# Per-token verification snippet.
# ---------------------------------------------------------------------------

verification_for() {
  case "$1" in
    ADMIN_TOKEN)
      cat <<'EOF'
Test by opening (on phone or laptop):

  https://equityroots.in/admin/upstox?token=<paste-token>

You should land on the Upstox status page with a green "Active" /
"Not signed in" badge. If you get "Invalid token", Vercel hasn't
picked up the new value yet — wait for the redeploy to finish.
EOF
      ;;
    REVALIDATE_TOKEN)
      cat <<EOF
Test from terminal:

  TOKEN=\$(grep '^REVALIDATE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  curl -sS -X POST "https://equityroots.in/api/revalidate" \\
    -H "Authorization: Bearer \$TOKEN" \\
    -H "Content-Type: application/json" \\
    -d '{"tags":["market","panel-cache","snapshot"]}'

Expect: {"ok":true,"revalidated":{"tags":[...],"paths":[]}}
EOF
      ;;
    SESSION_SECRET)
      cat <<'EOF'
SESSION_SECRET is used only at user-auth time. To verify, sign in
to the live site at https://equityroots.in/login and confirm
/watchlist loads without a "session invalid" redirect.

NOTE: rotating SESSION_SECRET invalidates every existing user
session — they'll need to sign in again. Only rotate if you
actually need to revoke all sessions.
EOF
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

cat <<EOF

${NAME} ${ACTION} in ${ENV_FILE}.
Length: ${#TOKEN} chars  ·  first 6: ${TOKEN:0:6}…

${CLIPBOARD_NOTE}

Next steps on Vercel:
  1. Open Project → Settings → Environment Variables
  2. Find ${NAME} → ⋯ → Edit  (or Add New if it doesn't exist)
  3. Paste (Cmd+V), tick Production + Preview + Development, Save
  4. Deployments → latest → ⋯ → Redeploy
     (uncheck "use existing build cache" for a fully clean rollout)

After the redeploy finishes (~60 s):

$(verification_for "$NAME")
EOF
