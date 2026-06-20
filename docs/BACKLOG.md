# Backlog

Deferred work — captured so it isn't lost. Organised into three buckets by the
*kind* of change so you can pick by appetite:

1. **Cosmetic changes** — copy, labels, display/consistency, SEO text. Low risk,
   no new logic.
2. **Feature changes** — enhance / harden / tune something that already exists.
3. **New functional** — brand-new capability that doesn't exist today.

Each item keeps its decision context so it can be picked up cold.

> **Last reviewed: 2026-06-20.** Keep this current — re-check after each shipping
> session: move done items to "Recently resolved", prune stale context, add new
> work. (Several items below were found already-fixed on the 06-20 review.)

---

## ⚙️ Deployment & fix policy (effective 2026-06-05)

- **Fix on localhost first**, then promote to production.
- **Production deploys on weekends** (batch the week, ship Sat/Sun). No mid-week
  prod fixes unless **very critical** (site down, data corruption, security).
- Localhost DB = local Postgres (`postgres:///fundamental_app` +
  `postgres:///golden_db`). Never point local work at Neon prod.

---

## ✅ Recently resolved (week of 2026-06-15 → 20)

- **Ideas feed redesign** — "Latest signal" band (Score movers / Result winners /
  upcoming-events calendar), unified Nifty 50/100/200/500/All universe control
  (from `app.index_constituent`; added NIFTY200 to the ingest), peer-relative +
  consistency-gated movers with streak/"N/M wks" badges + Nifty 200 fallback,
  full ~12-week comparison window, dashed peer-cluster overlay on sparklines,
  per-row "+ watch" hand-off, paginated calendar/winners (10/row).
- **Dividend ₹ amounts recovered** — ~21% of indianapi dividends had NULL `amount`
  (regex only matched "Rs N"). Fixed `fetch-corporate-actions-iapi.py` to compute
  `pct% × face_value` (+ snap to exact text figure); backfilled 3,624 rows
  (local + prod). e.g. INDIGO 13-Aug-2025 now shows ₹10.
- **BUG-01** — implausible 1D mover guard shipped (`MAX_PLAUSIBLE_1D=0.25` drops
  & logs |1D|>25% in `build-market-snapshot.py`; kills the "TRENT −33.4%" case).
- **BUG-02** — cluster count unified to "populated peer groups" (46) from
  `cluster_composite_cache` at latest snapshot, across home/ribbon/sectors;
  hardcoded "Forty-one" removed.
- **BUG-03** — coverage count unified to `COUNT(universe WHERE is_active)`
  (=2,163) across home hero, ribbon and screener breadcrumb.
- **BUG-04** — peer-comparison max wording consistent ("2–5"); page moved to
  `tools/peer-comparison`.
- **BUG-06** — per-page unique `<title>`/description now on
  about/glossary/sectors/ideas/screener/tools/market/news/indices/peer-comparison.
- **BUG-07** — glossary `MetricViz` now SSRs the final example (number, inputs,
  gauge marker, note) via a `mounted` gate; animation is progressive enhancement
  (no more "0.0% / 0.00× / 0 days" without JS).
- **Weekly Compute + Score** moved to Sunday 18:30 IST (`0 13 * * 0`) — a full
  day after Saturday's fetch.

## ✅ Recently resolved (week of 2026-06-08 → 12)

- **BUG-08** — `tierLabelPlural()` added; "Establisheds/Emergings" fixed.
- **Announcements feed** — per-stock BSE exchange filings, shown in the stock
  page's Corporate-actions sub-tabs (resumable daily sweep, migration 0035/0036).
- **Full corporate actions** — dividends/splits/bonus/rights/board-meetings via
  indianapi.in (resumable monthly sweep). *(Closes most of the old "splits/bonus/
  rights + announcements" feature gap — see Feature-changes for the remainder.)*
- **News reliability** — moved off GitHub's flaky cron to cron-job.org →
  `workflow_dispatch`.
- **Mega-cap `.NS`/ISIN repair** — INFY/TCS/RELIANCE/ICICIBANK/HDFCBANK names +
  ISINs fixed; sync now carries `isin`; search-by-name works.
- **Market UI** — top tape shows TODAY + ARCHIVE removed; signed-in cards moved
  to /watchlist; Nifty/Bank hero shows points + %; sector heatmap → 10-min.
- **sector-live cache** — bumped 60s → 10 min (part of the s-maxage item below;
  index-live + constituents still pending).

---

## 1. Cosmetic changes

Copy / label / display-consistency / SEO. Mostly safe weekend batches.

### BUG-05 — PRICES date chip stale a day on static pages  *(Low)*
Home/about/glossary/feedback vs data pages — ISR cache skew. **Fix:** align the
date source / revalidate across page types. *(Partly mooted now the ribbon shows
TODAY, but static vs data ISR skew can still differ — verify in-browser.)*

### M5 — regulatory posture / copy scrub  *(mostly non-eng, do early)*
India is aggressive on unregistered "research analyst" activity. **Fix:** get a
real opinion on RA applicability; scrub buy/sell-adjacent language; keep "info /
education, not advice" framing everywhere. Cheap insurance — schedule early.

---

## 2. Feature changes

Enhance / harden / tune existing behaviour.

### Raise CDN cache TTL on remaining live endpoints (`s-maxage` 60 → 300)  *(Quick)*
sector-live already done (→10 min). **Still 60s:** `/api/market/index-live`,
`/api/indices/constituents`. **Why:** an open tab re-hits origin ~1×/min (keeps
Neon awake). 300s → ~5× fewer wake-ups; data only changes ~10 min. **Risk:**
headline numbers up to ~5 min staler — pure display latency. Optionally also
bump client poll 60s → 120s. *(Quick win #2 from the 06-20 review — not yet done.)*

### Shift GitHub cron schedules off `:00`  *(Quick — reliability)*
All 5 schedules sit on the top of the hour (`refresh-ltp 0 13`, `refresh-announcements
0 22`, `refresh-constituents 0 4`, `weekly-fetch 0 13`, `weekly-compute 0 13`) —
GitHub load-sheds `:00` events, so runs get delayed or dropped (observed: a
weekly-fetch that didn't fire). **Fix:** move each a few minutes past the hour
(e.g. `17 13`). *(Quick win #1 from the 06-20 review — not yet done. Bulletproof
alternative: cron-job.org `workflow_dispatch` like news.)*

### Corporate actions — backfill non-dividend history depth
Full CA via indianapi shipped, but verify split/bonus/rights/board-meeting
**history depth** is adequate per stock (indianapi returns a bounded window).
**Fix if thin:** widen the fetch window or paginate; relabel confirmed. Low
priority — revisit if users report missing old actions.

### M3 — zero-touch, gap-proof weekly snapshot  *(highest operational urgency)*
The score archive only compounds if it runs every week with no hole. **Fix:**
(a) [optional] TOTP-automate the daily Upstox token; (b) fully schedule the
weekly snapshot; (c) treat a missed/failed snapshot as Sev-1.
- **(c) ✅ DONE (2026-06-20):** `check-freshness.py` gained `snapshot_cadence`
  (alerts if the gap between the last two weekly snapshots > 10d — a skipped
  week / permanent archive hole, double-run-robust, self-clearing).
  `freshness-check.yml` now also runs immediately after "Weekly Compute + Score"
  (`workflow_run`) and, on any failure, opens/append a **GitHub Issue** as a
  loud, trackable Sev-1 alert (de-duped by title).
- **(b) partial:** weekly fetch + compute are scheduled (fetch Sat, compute Sun);
  remaining is the cron-off-`:00` reliability shift (see hands-off item).
- **(a) optional:** user chose the manual morning Upstox tap.

### M6 — de-risk the data layer  *(don't-own-it fragility)*
Archive sits on Screener (cookie-gated), NSE (403s), Upstox (daily token). **Fix:**
cache raw inputs so a block can't corrupt a snapshot; write the archive only from
cached clean inputs (never a flaky live scrape); line up fallback sources; expand
freshness alerts.

### Fully hands-off operations hardening
Goal: zero daily intervention except the accepted morning Upstox tap. **Gaps:**
GitHub `schedule:` still drives refresh-ltp, weekly-snapshot, refresh-announcements,
refresh-constituents, freshness-check — GitHub load-sheds `:00` events and
auto-disables schedules after 60 days of no commits.
- **Quick win:** shift each cron off `:00` (`0 13` → `17 13`).
- **Bulletproof:** move critical ones (esp. refresh-ltp) to cron-job.org dispatch
  like news.
- Confirm `freshness-check` alert emails are on; set `GH_DISPATCH_TOKEN` PAT to
  long/no-expiry. **Rec:** quick cron-shift + alerts first (90% of reliability for
  ~zero effort); escalate to cron-job.org only if GitHub drops a run.

---

## 3. New functional

Brand-new capability.

### M1 — tamper-EVIDENT score archive  *(highest moat ROI)*
`app.scores` is a normal table — immutability is a promise, not a proof. **What:**
hash-chain each weekly snapshot (`snapshot_hash = sha256(ordered rows + prev
hash)` per `snapshot_date`) and anchor each weekly hash publicly + free (git
commit / tweet / OpenTimestamps). "Show me the row" → cryptographic proof it
existed unedited on that date. **Effort:** M. **Depends on:** M3 (reliable job).

### M2 — prove the score has edge (backtest + honest scorecard)
No evidence yet that `composite_pct` predicts forward returns. **What:** backtest
over the existing `app.scores` archive + golden prices — forward 1M/3M/6M/12M
returns by score quintile, hit-rate, and the misses. Publish it (landing hook),
including when we were wrong. **Effort:** M–L. Partly time-gated on archive depth;
can start with what exists. Feeds M4's hook.

### M4 — cold-start value + distribution
The archive moat is invisible to a day-one user. **What:** landing hook = the M2
backtest; SEO the `/stock/[symbol]` pages (rank for "<TICKER> stock score /
quality" — overlaps BUG-06); weekly "biggest score moves" email to build the
return-weekly habit. **Effort:** L (ongoing). **Depends on:** M2.

### StockEdge-style daily-updates dashboard
A market "daily updates" page. ~70% buildable from sources we already own —
movers, 52w H/L, FII/DII, sector moves, corporate actions, announcements (now
shipped), **bulk/block deals (NSE archive CSVs)**, IPO updates, price/volume
shockers. **Next step:** spec the tabs + per-tab source/query; new fetchers mainly
for bulk/block deals + IPO.

---

> **Moat sequencing:** M3 (uptime) + M5 (reg) are cheap insurance — do first.
> M1 + M2 are the real moat-makers. M4 monetises them (M2 feeds M4's hook; M1's
> value depends on M3).
