#!/usr/bin/env bash
# PreToolUse guard for Bash commands: nothing gets committed that does not compile.
#
# WHY THIS EXISTS
#
# CLAUDE.md §4 says to run the verification commands before committing. That
# instruction has the same weakness as every other instruction in this repo —
# it only works if it is read, and the entire bug history here is things that
# were written down once and then not honoured. The leg-aware buy-date rule was
# documented at length in portfolio.ts and a second call site still re-derived
# it wrongly, because a comment cannot reach a caller. A hook can.
#
# So this is the mechanical half of the regression rule. It does not check that
# the change is *correct* — nothing automatic can. It checks the one thing that
# is both cheap and catches the specific failure this repo keeps producing: a
# refactor that reads cleanly and does not typecheck. The portfolio.ts
# extraction shipped `Cannot find name 'userId'` on its first pass and looked
# fine in the diff.
#
# COST, because that is what decides whether a guard survives
#
# `tsc --noEmit` on this repo is ~1.7s. compileall on the touched Python files
# is under a second. It runs only on `git commit`, and only for the languages
# actually staged. If it ever gets slow enough to be worth bypassing, it will
# get bypassed, and then it is worse than nothing — so keep it cheap.
#
# ESCAPE HATCH
#
# Prefix the command with FUNDAMENTAL_SKIP_VERIFY=1 — deliberately verbose, in
# the same spirit as FUNDAMENTAL_ALLOW_REMOTE_DB. Note that --no-verify does
# NOT bypass this, on purpose: CLAUDE.md forbids it, and letting the forbidden
# flag act as the bypass would teach exactly the wrong reflex.
#
# Exit 0 with no output = allow. A JSON deny decision is emitted rather than a
# bare non-zero exit so the failure text reaches the model, which is the whole
# point — a blocked commit with no reason just gets retried.
set -uo pipefail

cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

# Fast path: this hook sees every Bash call, so leave immediately for the 99%
# that are not commits.
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
case "$cmd" in
  *FUNDAMENTAL_SKIP_VERIFY=1*) exit 0 ;;
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

# What is actually going into this commit. `git commit -a` stages tracked
# modifications at commit time, so the index alone would under-report and the
# guard would pass on files it never looked at — the exact shape of a check
# that cannot fail.
case "$cmd" in
  *"git commit -a"*|*"git commit"*" -am"*|*"git commit"*" -a "*|*--all*)
    files="$(git diff --name-only HEAD 2>/dev/null; git diff --cached --name-only 2>/dev/null)" ;;
  *)
    files="$(git diff --cached --name-only 2>/dev/null)" ;;
esac
[ -z "$files" ] && exit 0

# --- web: TypeScript must typecheck ----------------------------------------
if printf '%s\n' "$files" | grep -qE '^web/.*\.(ts|tsx)$'; then
  if [ -d web/node_modules ]; then
    out="$(cd web && npx tsc --noEmit 2>&1)"
    if [ $? -ne 0 ]; then
      deny "BLOCKED: staged TypeScript does not compile — fix this before committing, do not commit and fix after.

$(printf '%s\n' "$out" | head -n 30)

(cd web && npx tsc --noEmit) to see the rest. Bypass, only if you are certain: prefix the commit with FUNDAMENTAL_SKIP_VERIFY=1"
    fi
  fi
fi

# --- etl / scripts: Python must parse --------------------------------------
# Deliberately only a syntax check. The coverage suite and check-dq.py need a
# live database and take minutes; making them a commit gate would make the gate
# something to route around. Syntax is the part that is free.
py="$(printf '%s\n' "$files" | grep -E '^(etl/src|scripts)/.*\.py$' || true)"
if [ -n "$py" ] && [ -x etl/.venv/bin/python ]; then
  existing=""
  while IFS= read -r f; do
    [ -f "$f" ] && existing="$existing $f"
  done <<EOF
$py
EOF
  if [ -n "$existing" ]; then
    # ast.parse rather than py_compile: py_compile litters __pycache__ next to
    # the source, and a guard that modifies the tree it is guarding is a bad
    # trade for the same signal.
    # shellcheck disable=SC2086
    out="$(etl/.venv/bin/python -c '
import ast, sys
bad = 0
for p in sys.argv[1:]:
    try:
        ast.parse(open(p, encoding="utf-8").read(), filename=p)
    except SyntaxError as e:
        bad = 1
        print(f"{p}:{e.lineno}: {e.msg}")
sys.exit(bad)
' $existing 2>&1)"
    if [ $? -ne 0 ]; then
      deny "BLOCKED: staged Python does not parse.

$(printf '%s\n' "$out" | head -n 20)

Bypass, only if you are certain: prefix the commit with FUNDAMENTAL_SKIP_VERIFY=1"
    fi
  fi
fi

exit 0
