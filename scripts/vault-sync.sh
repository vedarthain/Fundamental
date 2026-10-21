#!/bin/bash
#
# Back up the files this repo deliberately refuses to track.
#
# WHY THIS EXISTS
#
# vedarthain/Fundamental is PUBLIC — it has to be, because GitHub Actions
# minutes are unlimited on public repos and capped at 2,000/month on Free for
# private ones. So docs/, CLAUDE.md and .git/hooks are gitignored, and that left
# them with exactly one copy, on one disk, with no backup at all. Not "unbacked
# between a commit and a merge" — never backed up, ever.
#
# The cost of that arrangement was already paid once: the mk_*/check_* pair for
# the first 76 verdicts (oil_refining 40, auto_oem 36) no longer exists
# anywhere. The verdict text survived because it is in Neon; the derivation did
# not, so those rows can be rewritten but never re-measured.
#
# The vault is a PRIVATE repo and a BACKUP, never a development checkout. Nothing
# in it builds, nothing imports from it, and no change is ever authored there —
# edit the file in its real home and run this. That one-way rule is what keeps
# the atomicity problem away: there is no second place where work can diverge.
#
# WHAT KEEPS IT CURRENT (CLAUDE.md §5 — "if the answer is the initial load, you
# have built the next bug"): `mm` runs it. mm is typed often, it already reports
# branch state, and it now reports the vault's last-sync age, so a vault that
# has stopped being updated is visible rather than silently rotten.
#
# .env.local is deliberately NOT here. A private repo is not a secret store, and
# a key in git history is effectively permanent. Losing it costs a re-issue;
# leaking it costs more.
set -euo pipefail

SRC=/Users/debasissahoo/Documents/Fundamental
VAULT=/Users/debasissahoo/Documents/fundamental-vault
REMOTE=vedarthain/Fundamental-vault

# Paths are relative to $SRC. Add one here and it is backed up from then on.
PATHS=(docs CLAUDE.md backlog_ideas)
HOOK=.git/hooks/pre-push

if [ ! -d "$VAULT/.git" ]; then
  echo "vault: not initialised at $VAULT" >&2
  echo "  run:  $0 --init" >&2
  [ "${1:-}" = "--init" ] || exit 1
  mkdir -p "$VAULT"
  git -C "$VAULT" init -q -b main
  gh repo create "$REMOTE" --private --source "$VAULT" --remote origin 2>/dev/null \
    || git -C "$VAULT" remote add origin "https://github.com/$REMOTE.git"
  printf '%s\n' '.DS_Store' '*.pyc' '__pycache__/' > "$VAULT/.gitignore"
  echo "vault: initialised"
fi

# Mirror, not merge: --delete means a file removed from the source is removed
# from the backup too. The vault reflects what exists now; git history is what
# holds the past. A backup that only ever grows is a junk drawer.
for p in "${PATHS[@]}"; do
  [ -e "$SRC/$p" ] || { echo "vault: WARNING $p missing in source, skipping" >&2; continue; }
  if [ -d "$SRC/$p" ]; then
    rsync -a --delete --exclude '.git' "$SRC/$p/" "$VAULT/$p/"
  else
    rsync -a "$SRC/$p" "$VAULT/$p"
  fi
done

# Hooks live inside .git and cannot be rsynced as a path; copy explicitly.
mkdir -p "$VAULT/git-hooks"
[ -f "$SRC/$HOOK" ] && cp "$SRC/$HOOK" "$VAULT/git-hooks/pre-push"

# Refuse to back up a secret even by accident — a wrong entry in PATHS one day
# should fail loudly here rather than publish a key to a remote.
#
# The pattern deliberately requires a value that looks REAL: 20+ non-space
# characters that do not start with `$` or `<`. The first version matched any
# `NEON_*=` at all, so it flagged the very placeholders written to fix the
# problem — a check that fires on its own remedy trains you to ignore it.
# Verified against both sides: real Neon URLs, a bare long token and a
# user:password DSN are all flagged; `$NEON_APP_URL` and `<see .env.local>`
# are not.
CRED_PAT='postgres(ql)?://[^ "]*:[^ "@]{8,}@|(NEON_[A-Z_]*|REVALIDATE_TOKEN)="?[^$<"[:space:]][^"[:space:]]{19,}'
if grep -rlqE "$CRED_PAT" "$VAULT" \
     --exclude-dir=.git 2>/dev/null; then
  echo "vault: REFUSED — something that looks like a credential is staged." >&2
  grep -rlE "$CRED_PAT" "$VAULT" \
     --exclude-dir=.git >&2
  exit 1
fi

cd "$VAULT"
if [ -z "$(git status --porcelain)" ]; then
  echo "vault: already current ($(git log -1 --format=%cr 2>/dev/null || echo 'no commits'))"
  exit 0
fi

git add -A   # safe here and nowhere else: the vault contains only what was copied in
git commit -qm "vault sync $(date '+%Y-%m-%d %H:%M') from ${SRC##*/}@$(git -C "$SRC" rev-parse --short HEAD)"
git push -q -u origin main 2>&1 | tail -2 || { echo "vault: push failed" >&2; exit 1; }
echo "vault: synced and pushed ($(git diff --stat HEAD~1 2>/dev/null | tail -1 || echo 'initial'))"
