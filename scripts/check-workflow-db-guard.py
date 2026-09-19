#!/usr/bin/env python3
"""
check-workflow-db-guard.py — every CI job that runs the ETL against Neon must
opt in to remote DB access explicitly.

WHY THIS EXISTS

etl/src/fundamental_etl/db.py refuses to open APP_DB_URL when it resolves to a
remote host. That guard exists so a local session cannot drift onto production:
one stray `export APP_DB_URL=...` used to be enough to point every tool in the
repo at prod while every command looked exactly as it always had.

CI is the legitimate exception — it writes to prod on purpose — and opts in with
FUNDAMENTAL_ALLOW_REMOTE_DB=1.

The problem is that the guard and the opt-in live in different files, in
different languages, edited at different times. When the guard was added, four
workflows already set APP_DB_URL to the Neon secret, and every one of them would
have failed on its next scheduled run: Weekly Fetch, Weekly Compute + Score,
sync-universe, refresh-shareholding. The entire pipeline, broken by a change
that tested clean locally, and discoverable only on Saturday evening when the
cron fired.

That is the same failure shape as the coverage bug this project spent a week
on: a check whose blind spot is exactly the thing it is supposed to protect.
So the coupling is asserted mechanically instead of remembered.

WHAT IT CHECKS

For every .github/workflows/*.yml, for every step that
  (a) sets APP_DB_URL or GOLDEN_DB_URL to a NEON_* secret, AND
  (b) runs the Python ETL (`fundamental_etl`), which is what routes through
      db.py and therefore through the guard
assert FUNDAMENTAL_ALLOW_REMOTE_DB is set in that step's env (or the job's).

Steps that talk to Neon through a standalone script in scripts/ are NOT flagged:
those use psycopg directly and never import db.py, so the guard does not apply
to them. Narrowing on the actual import path rather than on "mentions Neon"
keeps this from becoming a nag that people learn to suppress.

USAGE
  scripts/check-workflow-db-guard.py

Exit codes:
  0 — every ETL-on-Neon step opts in
  1 — at least one step would be refused at runtime (named, with the fix)
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"

DB_VARS = ("APP_DB_URL", "GOLDEN_DB_URL")
OPT_IN = "FUNDAMENTAL_ALLOW_REMOTE_DB"
# Importing the package is what pulls in db.py and its guard. A workflow that
# shells out to scripts/foo.py connects with psycopg directly and is unaffected.
ETL_MARKER = "fundamental_etl"


def uses_neon(env: dict) -> bool:
    return any("NEON_" in str(env.get(v, "")) for v in DB_VARS)


def main() -> int:
    problems: list[str] = []
    checked = 0

    for path in sorted(WORKFLOWS.glob("*.yml")):
        try:
            wf = yaml.safe_load(path.read_text()) or {}
        except yaml.YAMLError as e:
            problems.append(f"{path.name}: unparseable YAML — {e}")
            continue

        for job_name, job in (wf.get("jobs") or {}).items():
            job_env = job.get("env") or {}
            for step in job.get("steps") or []:
                env = {**job_env, **(step.get("env") or {})}
                run = str(step.get("run") or "")

                if not uses_neon(env) or ETL_MARKER not in run:
                    continue

                checked += 1
                if OPT_IN not in env:
                    label = step.get("name") or run.strip().splitlines()[0][:50]
                    problems.append(
                        f"{path.name} → job '{job_name}' → step '{label}'\n"
                        f"      runs the ETL against Neon but does not set {OPT_IN}.\n"
                        f"      db.py will REFUSE the connection and this step will fail.\n"
                        f"      Fix: add  {OPT_IN}: \"1\"  to that step's env."
                    )

    if problems:
        print(f"FAIL — {len(problems)} workflow step(s) would be refused at runtime:\n")
        for p in problems:
            print(f"  ✗ {p}\n")
        return 1

    print(f"OK — all {checked} ETL-on-Neon workflow step(s) opt in to remote DB access.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
