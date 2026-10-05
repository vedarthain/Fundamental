#!/usr/bin/env bash
# PreToolUse guard for Bash commands: a commit that encodes a decision must
# record it in DECISIONS.md.
#
# WHY THIS EXISTS
#
# The ask was "a file that keeps building as I progress, so a new model does not
# have to relearn this project". This repo has already answered that question
# once and got it wrong: `docs/` was written in June 2026 and never touched
# again, and CLAUDE.md now tells readers not to trust it. A file maintained by
# intention decays at the speed of intention. §5 is the general form — things
# get seeded and then nothing maintains them.
#
# So the file is not the deliverable. This is. DECISIONS.md stays current
# because a commit that should have updated it does not go through.
#
# WHAT IT TRIGGERS ON, AND WHY THESE THREE
#
# Blocking on "any interesting commit" is not implementable, and a guard that
# fires on judgement fires arbitrarily, gets resented, and gets bypassed. These
# three are mechanical, rare, and in this repo they ALWAYS encode a decision
# that is never written down anywhere a future reader will look:
#
#   NEW db/migrations/*.sql   — a schema shape is a decision about what is true
#   NEW .github/workflows/*   — a recurring job is a decision about what runs
#   NEW web/src/app/**/page.tsx — a route is a decision about what the product is
#
# NEW is the operative word: `git diff --cached --diff-filter=A`. Editing a
# migration or a workflow is ordinary maintenance and is already explained by
# the commit message. Adding one is the act that creates something with no
# natural home for its rationale.
#
# Verified against today's own work: migration 0084 plus /admin/screener and
# /api/screener/session would have tripped this, and that commit recorded its
# reasoning only in a file header nobody reads unless they already found it.
#
# WHAT IT CANNOT DO
#
# It cannot tell whether the entry is any good — staging a one-word line passes.
# That is deliberate and it is the same trade as verify-before-commit.sh, which
# checks that code compiles and not that it is correct. The guard supplies the
# moment and the prompt; the thinking is still yours. A gate that tried to
# grade the prose would be wrong often enough to be routed around, and a
# bypassed gate is worse than no gate.
#
# COST
#
# Two `git diff --cached --name-only` calls on a commit. Nothing on any other
# Bash command — the fast path below exits before touching git.
#
# ESCAPE HATCH
#
# Prefix with FUNDAMENTAL_SKIP_DECISIONS=1, same spirit as
# FUNDAMENTAL_SKIP_VERIFY and FUNDAMENTAL_ALLOW_REMOTE_DB: bypassing is allowed
# but has to be a deliberate, visible act. `--no-verify` does NOT bypass this,
# on purpose — CLAUDE.md forbids that flag, and letting it work here would
# teach the wrong reflex.
set -uo pipefail

cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

# Fast path: this hook sees every Bash call. Leave before doing any work for the
# overwhelming majority that are not commits.
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
case "$cmd" in
  *FUNDAMENTAL_SKIP_DECISIONS=1*) exit 0 ;;
esac

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -d "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

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

# Added files only. See the NEW note above.
added="$(git diff --cached --name-only --diff-filter=A 2>/dev/null)"
[ -z "$added" ] && exit 0

triggers="$(printf '%s\n' "$added" | grep -E \
  '^(db/migrations/.*\.sql|\.github/workflows/.*\.ya?ml|web/src/app/.*/page\.tsx)$' || true)"
[ -z "$triggers" ] && exit 0

# DECISIONS.md itself must be in the commit. Staged-modified or staged-added
# both count; an untracked edit does not, because it would not ship.
if git diff --cached --name-only 2>/dev/null | grep -qx 'DECISIONS.md'; then
  exit 0
fi

deny "BLOCKED: this commit adds something that encodes a decision, but DECISIONS.md is not staged.

New in this commit:
$(printf '%s\n' "$triggers" | sed 's/^/  /')

A new migration, workflow or route is a choice whose reasoning has no other home — the commit message explains the change, not the direction. Add a dated entry to DECISIONS.md (decision / why / what would reverse it) and stage it.

If this genuinely records no decision: FUNDAMENTAL_SKIP_DECISIONS=1 git commit ..."
