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
case "$cmd" in
  *"rm -rf "*|*"rm -fr "*|*"rm -r -f "*|*"rm -f -r "*)
    deny "BLOCKED: recursive force delete. Nothing in this repo needs it. docs/ and .env.local are gitignored and unrecoverable. Delete specific files by name, or ask Deb." ;;
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
