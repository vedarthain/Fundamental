# Decisions

Choices that are not attached to any one diff.

Everything else about *why* already lives in a commit message or a code comment
sitting in the diff that changed the behaviour, which is where it stays accurate.
This file is only for the residue: decisions that span files, decisions to NOT
build something, and directions agreed in conversation that no code records.

**What keeps it current:** `scripts/guards/decisions-current.sh` blocks a commit
that adds a new route, a new migration or a new workflow unless this file is
staged alongside it. Those three are the things in this repo that always encode
a decision and never record it anywhere a future reader will look. The guard is
mechanical and cheap; it cannot tell whether the entry is *good*, only that one
was written. `docs/` was written once in June and never touched again — that is
the outcome this guard exists to prevent, and the reason this file is committed
rather than living in the gitignored, unbacked-up `docs/`.

Newest first. Each entry: the decision, why, and what would reverse it.

---

## 2026-10-05 — `/dashboard` is the signed-in home, not a redirect

`/dashboard` is one composed page: collapsed `AttentionStrip`, latest FII/DII cash-market net from `app.fii_dii_flow` (date shown; do not hide staleness), equity KPIs + top holdings from `loadPortfolio`. Watchlist and calls stay on `/watchlist` — they are not peeks on this page. `/portfolio` stays the full book. The strip does not appear on those two routes. Until this page is finished, it is **not** in the main nav and the logo does **not** go there — both stay on `/`. Reach it from the signed-in account menu. Login without `?next=` also lands on `/`. Do not paste `PortfolioClient` or `WatchlistClient` onto this route. Do not run a 309-name golden waterfall here. Do not read `market_snapshot_cache` just for FII — that blob is the retired `/market` page.

**Why:** a returning visitor wants one scan of the equity book, not a bounce into whichever workspace was heavier. The list and calls are first-class elsewhere; duplicating them here was clutter.

**Reverses if:** the page becomes a second portfolio (full table, trade log, charts). Then it is drift, and the redirect is the cheaper home again.

---

## 2026-10-05 — `/dashboard` is a redirect; attention lives on /portfolio and /watchlist

**Superseded the same day** by the composed-home entry above. Left here so the reversal is visible.

Do not build a widget home. `/dashboard` only chooses between `/portfolio` (has holdings, or empty account) and `/watchlist` (saved names or open calls). The morning job is an `AttentionStrip` on those two pages (alerts, stale broker file, headlines that name your symbols). Logo goes there when signed in; `/` stays the ISR marketing page. Alerts are in the account menu, not a seventh desktop nav item.

**Why:** `/portfolio` is already the book dashboard. A third composition of the same numbers would drift, and the header already overflowed once. Named `/dashboard` exists so login and the logo have one URL.

**Reverses if:** the strip on two pages starts disagreeing — then extract is already done (`AttentionStrip`); do not duplicate it into a third route.

---

## 2026-10-04 — User dashboard first; ops dashboard lives under `/admin`

Build a user-facing `/dashboard` before the operational one. Ops panels go under
`/admin`, never on a public route.

**Why:** both were wanted. The user one compounds — it is the thing a returning
visitor lands on. The ops one saves my time, not theirs. Separately, `/` is a
marketing page with `revalidate = 86400`; a per-user dashboard is uncacheable,
so they must stay separate routes rather than one page branching on auth.

**Reverses if:** operational blindness starts costing more than a slow user
surface. On 2026-10-04 a failed compute run was found by eyeballing a GitHub
Actions screenshot, which is the argument for flipping the order.

---

## 2026-10-04 — SME names are scored in the same cohort as the main board

The 475 NSE EMERGE symbols onboarded on 2026-10-04 sit in the same clusters and
the same percentile cohorts as main-board names. `app.universe.is_sme` exists so
this can be revisited, and is currently used only to scope DQ assertions.

**Why:** deferred, not settled. Separating them touches `cluster_id`, which
feeds `app.cluster_composite` and several caches — a bigger change than the
onboarding itself, and one with no evidence yet that the blended percentiles are
misleading.

**Reverses if:** SME names cluster at one end of the composite distribution once
they have enough history to be scored properly. Worth re-measuring after the
Screener backfill drains.

---

## 2026-10-04 — A DQ failure that needs a human is advisory, not fatal

`AssertionResult.advisory`: reported in full, never sets the exit code.

**Why:** a red DQ run exits 1, and on 2026-10-04 an exit 1 *after* a completed
scoring run skipped the snapshot rebuild and the cache purge — 479 freshly
scored symbols stayed off the site over one unlabelled microcap. The check was
right; the blast radius was wrong.

**Scope, and this is the load-bearing half:** advisory is only for "a person has
to decide something", where the run's output is sound. Integrity failures — a
column that stopped populating, a stale feed, a collapsed count — mean the
output is untrustworthy and publishing it is the harm. Those stay fatal. If this
flag ever appears on an integrity check, the decision has been misapplied.

---

## 2026-10-04 — Screener's session cookie lives in Postgres, not in CI secrets

One copy, in `app.screener_session`, rotated from `/admin/screener`. The GitHub
secrets were deleted.

**Why:** the original ask was to have the web app write the GitHub secret. That
needs a PAT with secrets-write on a **public** repo, parked in Vercel's
environment and held by a public-facing app — a non-expiring credential that can
inject anything into CI, guarding a cookie that expires by itself. The table
needs no new credential: every workflow already holds `NEON_APP_URL`.

**Reverses if:** never, on the PAT. The storage location could move, but the
rule that there is exactly ONE copy should not — two independently expiring
copies was the original bug, and a better reminder was not the fix.

---

## 2026-10-04 — Symbols Screener cannot classify get a named bucket, not NULL

`sector = 'Unclassified'`, not NULL, and never a guessed real sector.

**Why:** a NULL drops out of `GROUP BY` and out of every count, so the hole is
invisible to exactly the queries someone would run to find it — that is how 484
symbols went unscored for five months. The precedent is `dividend_only.SECTOR`:
this repo's existing answer to "does not fit the taxonomy" is a named group.

**Reverses if:** the bucket stops being temporary in practice. It carries its own
expiry (`dq.unclassified_sector_aged`), so that would show up rather than accrue.
