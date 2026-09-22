# EquityRoots — operating manual

Read this before changing anything. It is loaded automatically at the start of
every session, and it is short on purpose.

**What this is:** an NSE (Indian equity) analysis platform. Python ETL in
`etl/` pulls and scores ~2,600 listed companies; a Next.js app in `web/` serves
them at **equityroots.in**. Solo project, live users, real money decisions.

---

## 1. Stop rules

These are not preferences. Breaking one loses work or breaks production.

| Never | Why |
|---|---|
| `git push --force` to `main` | Solo repo with no backups but the remote. A force-push is unrecoverable. |
| `git reset --hard`, `git checkout .`, `git clean -f` | Discards uncommitted work with no undo. Use `git stash` instead. |
| Deploy without being asked **in the current message** | Deploys go out **Saturday/Sunday only**. Past approval does not carry forward. |
| Commit or push without being asked | Ask. `z` = commit. `zz` = commit **and** push. Nothing else pushes. |
| `DELETE`/`DROP`/`TRUNCATE` on prod without showing the row count first | Run the `SELECT count(*)` first, show it, wait for a yes. |
| Write to a remote DB without `FUNDAMENTAL_ALLOW_REMOTE_DB=1` | The guard in `etl/src/fundamental_etl/db.py` exists because local and prod URLs look alike. Setting the flag is the deliberate act. |
| `git add -A` or `git add .` | Sweeps in `build/`, `logs/`, `.claude/`, archives. Stage files by name. |

**When you are unsure whether something is destructive, it is.** Ask.

---

## 2. Environment — the four things that waste a session

1. **Python is `etl/.venv/bin/python`.** Plain `python` does not exist on this
   machine, and system `python3` cannot import `fundamental_etl`.
2. **The Bash tool's working directory persists between calls.** A `cd etl` in
   one call is still in effect in the next. Always use absolute paths, or
   `cd /Users/debasissahoo/Documents/Fundamental` first.
3. **Secrets live in `.env.local` at the repo root** and it is gitignored.
   Load with `set -a && . ./.env.local && set +a`. Never print a value, never
   commit it, never paste one into a message.
4. **Local DBs are `postgres:///fundamental_app` and `postgres:///golden_db`.**
   Prod is Neon, via `NEON_APP_URL` / `NEON_GOLDEN_URL`.

Running an ETL command against production looks like this:

```bash
cd /Users/debasissahoo/Documents/Fundamental
set -a && . ./.env.local && set +a
APP_DB_URL="$NEON_APP_URL" GOLDEN_DB_URL="$NEON_GOLDEN_URL" \
  FUNDAMENTAL_ALLOW_REMOTE_DB=1 \
  etl/.venv/bin/python -m fundamental_etl.cli <command>
```

---

## 3. Read before you decide — not optional

**Do not propose a design, a fix, or a schema change until you have read the
relevant document below.** These exist because the same wrong assumption has
been made repeatedly in this codebase, and each document is the record of what
it cost. Reading them is cheaper than rediscovering them.

| Before you… | Read | Because |
|---|---|---|
| touch anything reading `golden.*`, an NSE file, or Screener | `docs/DATA_CONTRACTS.md` | Nearly every bug here came from assuming a guarantee that was never made. |
| change the pipeline, scoring, caching, or a route | `docs/ARCHITECTURE.md` | The pipeline order is load-bearing and nothing enforces it. |
| run anything against prod, or touch a scheduled job | `docs/RUNBOOK.md` | Organised by symptom. Includes what is *not* an incident. |
| anything at all | this file, and §5 below | |

Then, and still: **read the code's own comments.** The heavy modules open with
long docstrings explaining *why*, not what — `classification.py`,
`coverage.py`, `score.ts`, and the numbered files in `db/migrations/`. They sit
in the diff that changes the behaviour, so they stay accurate. Where a document
and the code disagree, **the code wins** — and fixing the document is part of
the change that made it wrong.

**`docs/archive/` is dead.** It documents a June 2026 codebase, ~400 commits
ago. Do not trust it and do not cite it.

> **`docs/` is gitignored and deliberate.** This repo is **public**
> (`vedarthain/Fundamental`); the docs folder is not pushed. So:
> - On this machine the files are there — read them.
> - On a fresh clone they will be **absent, not deleted**. Do not recreate
>   them from guesswork and do not treat their absence as a bug.
> - They have **no backup**. Never `rm` anything under `docs/`. A `PreToolUse`
>   guard (`scripts/guards/block-destructive.sh`) blocks `rm -rf`, but it is a
>   seatbelt, not a backup.

## 4. When you change something

- **Say what you measured, not what you expect.** Claims about production get
  a query. Claims about the world (is a company still listed? does a route
  exist?) get checked — training data is stale and has been wrong here before.
- **Tag confidence:** `[Certain]` (hard evidence) / `[Likely]` (strong
  inference) / `[Guessing]` (filling gaps).
- **A migration is applied to prod AND committed, in that order, same
  session.** Prod ahead of the repo is the worst state to leave.
- **After changing anything that affects what the site shows, the Vercel Data
  Cache must be purged.** It survives deploys, and the loaders precompute
  values server-side. A DB fix that is not followed by a purge is invisible.

### Regression impact — state it before the edit, prove it after

A fix that creates a bug is worse than the bug it fixed, because the new one
arrives wearing the trust of a fix. So every change names its blast radius
**up front**, in the message that proposes it — not afterwards as reassurance.

Three questions, answered with commands, not confidence:

1. **Who else calls this?** `grep -rn` the symbol across `web/src` and
   `etl/src` before changing its behaviour or its signature, and list what came
   back. If the rule being fixed lives in a *comment* rather than a function,
   every caller is a copy that will never receive the fix — say so, and extract
   it. That is exactly how the watchlist buy marker drifted from the portfolio's.
2. **What does this widen or narrow?** A changed threshold, filter, `LIMIT`,
   or `WHERE` clause changes a row count. Measure both sides — run it before and
   after and report the two numbers. "Should be unaffected" is not a measurement.
3. **What proves it still works?** §6's commands. Run them, don't cite them. A
   refactor that merely *looks* clean has already shipped a scope bug here.
   Question 3 is the only one with teeth: `scripts/guards/verify-before-commit.sh`
   blocks any `git commit` whose staged TypeScript does not typecheck or whose
   staged Python does not parse. It is a floor, not a substitute — it cannot
   tell you whether the change is *right*, only that it compiles. Questions 1
   and 2 are still yours.

And the trap specific to fixing bugs: **a fix must fail on the bug it fixes.**
Before trusting a new guard, threshold or check, feed it the original broken
input and confirm it rejects it. The buy-anchor tripwire was first set at 2.0×
while the bug that motivated it measured 1.75× — it would have passed, green,
forever. Tuning by intuition and never testing the actual case is how §5's
"checks that cannot fail" gets rewritten from scratch each time.

Where a change genuinely cannot be verified here — anything visual — say so
plainly and say what Deb should look at. Never substitute a claim for a check.

---

## 5. The recurring failure in this codebase

Read this once; it explains most of the bugs.

**Things get seeded and then nothing maintains them.** `golden.stocks` was
populated once and never enriched, so every symbol onboarded afterwards had a
NULL sector. `app.screener_meta` froze at 2,150 rows. The coverage ledger
upserted but could not evict, so retired symbols stayed forever. `docs/` was
written in June and never touched again.

**And checks that cannot fail.** A DQ assertion that starts `FROM app.scores`
asks "of the stocks we scored, how many did we score?" — it passes at 100%
while a third of the universe is missing. A skipped check that renders as a
green tick. A job that exits 0 because the error was counted in the wrong
bucket.

So when you add a check, ask: **what would make this fail?** If you cannot
answer, it is decoration. And when you add data, ask: **what keeps this
current?** If the answer is "the initial load", you have built the next bug.

---

## 6. Verifying your work

```bash
# ETL: syntax + the full coverage suite (should be 8 passed, 0 failed, 0 skipped)
etl/.venv/bin/python -c "import ast;ast.parse(open('etl/src/fundamental_etl/cli.py').read())"
... coverage            # see §2 for the env prefix

# Web
cd web && npx tsc --noEmit && npm run build
```

`npx next lint` does **not** work in this repo — it misreads the argument as a
directory. Use `tsc --noEmit`.

**Never run `npm run build` while `npm run dev` is running.** Both write
`web/.next` and they corrupt each other's Turbopack persistence, which then
surfaces as a 500 on every page with a `Failed to deserialize AMQF ...`
traceback that looks nothing like a build error. Stop the dev server first, or
just run `tsc --noEmit`. To recover: stop dev, **move** `web/.next` aside
(`mv`, not `rm`), restart. The code is almost certainly fine — check by
building with dev stopped before you go hunting for a bug that isn't there.

**You cannot verify the GUI.** There is no browser access to the rendered app.
Do not claim a visual result. Report what you changed and ask Deb to look.

---

## 7. Working with Deb

Advisor, not assistant. Lead with the uncomfortable finding. Challenge the
premise of a decision before executing it — but for pure execution (run this,
rename that), just do it well.

Hold your position when you have evidence and he pushes back. Defer on
preference and product direction: make the case once, then his call wins.

He wants the verdict, not the process.
