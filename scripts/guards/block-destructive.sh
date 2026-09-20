#!/usr/bin/env bash
# PreToolUse guard for Bash commands.
#
# Blocks the small set of operations that destroy work with no undo. This is
# enforcement, not documentation: the rules in CLAUDE.md only work if they are
# read, and this repo's entire bug history is things that were written down once
# and then not maintained.
#
# Exit 0 with no output = allow. We emit a JSON deny decision instead of a bare
# non-zero exit so the reason reaches the model.
set -uo pipefail

cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

deny() {
  jq -nc --arg r "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# --- git: unrecoverable history/worktree operations ------------------------
case "$cmd" in
  *"git push"*--force*|*"git push"*" -f "*)
    deny "BLOCKED: force-push. This repo's only backup is the remote; a force-push to main is unrecoverable. If you genuinely need it, ask Deb to run it himself." ;;
  *"git reset --hard"*)
    deny "BLOCKED: git reset --hard discards uncommitted work with no undo. Use 'git stash' to park changes, or 'git reset' (mixed) to unstage." ;;
  *"git clean -f"*|*"git clean -df"*|*"git clean -fd"*)
    deny "BLOCKED: git clean -f permanently deletes untracked files — in this repo that includes all of docs/, which is gitignored and has no backup." ;;
  *"git checkout ."*|*"git checkout -- ."*|*"git restore ."*)
    deny "BLOCKED: this reverts every modified file at once. Name the specific file you mean to revert." ;;
  *"git branch -D"*)
    deny "BLOCKED: force-delete of a branch. Use 'git branch -d' (safe delete) — it refuses when commits would be lost, which is the check you want." ;;
esac

# --- rm: recursive force deletes -------------------------------------------
#
# Blocked everywhere EXCEPT scratch space (/tmp, /var/folders). The first
# version of this rule blocked every `rm -rf` regardless of path, and within a
# day it fired on a 608 MB corrupted .next build parked in /tmp — a delete that
# was deliberate, approved, and outside the repo entirely. The workaround
# (`find -delete`) took ten seconds to find.
#
# That is how a guard dies. Not by being wrong about the dangerous case, but by
# being wrong often enough about the safe one that you learn the bypass and stop
# reading its output. So the rule is narrowed to where the damage actually is:
# anything under the repo, the home directory, or a relative path.
#
# A target qualifies as scratch only if it is an absolute path under /tmp,
# /private/tmp or /var/folders, has something after that prefix, and contains no
# `..` — otherwise `/tmp/../Users/debasissahoo` would walk straight back out.
# Every target in every rm segment must qualify; one that does not denies the
# whole command.
is_scratch_rm() {
  local seg="$1" tok seen_rm=0 found=0
  set -- $seg              # word-split; globbing disabled by the caller's `set -f`
  for tok in "$@"; do
    if [ "$seen_rm" -eq 0 ]; then
      case "$tok" in rm|/bin/rm|*/rm) seen_rm=1 ;; esac
      continue
    fi
    case "$tok" in -*) continue ;; esac
    found=1
    case "$tok" in
      *..*) return 1 ;;
      /tmp/?*|/private/tmp/?*|/var/folders/?*) ;;
      *) return 1 ;;
    esac
  done
  [ "$found" -eq 1 ]       # an rm with no parsable target is not provably safe
}

case "$cmd" in
  *"rm -rf "*|*"rm -fr "*|*"rm -r -f "*|*"rm -f -r "*)
    rm_ok=1
    set -f
    # Split on shell separators so each rm is judged with its own arguments.
    # A separator inside a quoted string over-splits, which orphans the rm from
    # its target and denies — the safe direction to be wrong in.
    while IFS= read -r seg; do
      case "$seg" in
        *"rm -rf "*|*"rm -fr "*|*"rm -r -f "*|*"rm -f -r "*)
          is_scratch_rm "$seg" || rm_ok=0 ;;
      esac
    done <<EOF
$(printf '%s' "$cmd" | tr ';|&\n' '\n\n\n\n')
EOF
    set +f
    [ "$rm_ok" -eq 1 ] || deny "BLOCKED: recursive force delete outside scratch space. docs/ and .env.local are gitignored and unrecoverable, and node_modules/.next rebuild — neither is worth the risk. Delete specific files by name, or ask Deb. (rm -rf IS allowed under /tmp and /var/folders.)"
    ;;
esac

# --- SQL: unscoped writes against production -------------------------------
# Only fires when the statement is destructive AND lacks a WHERE clause, or is
# a DROP/TRUNCATE. Scoped DELETEs are allowed — CLAUDE.md requires showing the
# count first, which is a judgement call, not a pattern match.
if printf '%s' "$cmd" | grep -qiE 'psql|NEON_APP_URL|NEON_GOLDEN_URL'; then
  if printf '%s' "$cmd" | grep -qiE '\b(drop|truncate)\s+(table|schema|database)\b'; then
    deny "BLOCKED: DROP/TRUNCATE against a database. If this is a real migration, put it in db/migrations/ as a reviewed .sql file and apply that." ;
  fi
  if printf '%s' "$cmd" | grep -qiE '\b(delete\s+from|update)\b' && ! printf '%s' "$cmd" | grep -qiE '\bwhere\b'; then
    deny "BLOCKED: UPDATE/DELETE with no WHERE clause — this rewrites every row in the table. Add a WHERE, and show the SELECT count(*) first." ;
  fi
fi

exit 0
