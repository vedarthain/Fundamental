# Backlog

Deferred work — captured so it isn't lost. Organised into three buckets by the
*kind* of change so you can pick by appetite:

1. **Cosmetic changes** — copy, labels, display/consistency, SEO text. Low risk,
   no new logic.
2. **Feature changes** — enhance / harden / tune something that already exists.
3. **New functional** — brand-new capability that doesn't exist today.

Each item keeps its decision context so it can be picked up cold.

---

## ⚙️ Deployment & fix policy (effective 2026-06-05)

- **Fix on localhost first**, then promote to production.
- **Production deploys on weekends** (batch the week, ship Sat/Sun). No mid-week
  prod fixes unless **very critical** (site down, data corruption, security).
- Localhost DB = local Postgres (`postgres:///fundamental_app` +
  `postgres:///golden_db`). Never point local work at Neon prod.

---

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

### BUG-02 — cluster count stated 3 ways  *(Med)*
`app/page.tsx:519` hardcodes "Forty-one"; `SectorsClient.tsx:241` shows computed
`clusterCount`; `SnapshotRibbon.tsx` shows `s.clusters`. Local truth: cluster=49,
meta_cluster=9; ribbon/sectors now show 46 (populated peer groups).
**Fix:** one canonical count from DB, replace hardcoded copy.
**NEEDS DECISION:** which count is canonical + terminology ("peer groups" vs
"clusters" vs "sectors").

### BUG-03 — coverage count drifts (2,157 / 2,163 / 2,153 / 2,156)  *(Med)*
`app/page.tsx:34` = `COUNT(universe is_active)` (=2163); header/screener use other
sources. **Fix:** single canonical coverage count, computed once, reused.
**NEEDS DECISION:** active-universe vs scored-at-latest-snapshot.

### BUG-04 — peer-comparison max wording mismatch  *(Med)*
`peer-comparison/page.tsx:166` "up to five" vs `:301` "up to three" vs home card
"2–5". **Fix:** read the enforced max; make all 3 strings match.

### BUG-05 — PRICES date chip stale a day on static pages  *(Low)*
Home/about/glossary/feedback vs data pages — ISR cache skew. **Fix:** align the
date source / revalidate across page types. *(Partly mooted now the ribbon shows
TODAY, but static vs data ISR skew can still differ — verify.)*

### BUG-06 — duplicate `<title>` / meta description  *(Med)*
about/glossary/sectors/ideas/screener/tools share meta (only /market, /feedback
unique). **Fix:** per-page `export const metadata` (unique title+desc). Doubles
as SEO for the distribution moat (M4).

### BUG-07 — glossary example dials show 0.0% / 0.00× / 0 days in SSR  *(Med)*
Likely a count-up animation with no no-JS fallback. **Fix:** verify in-browser;
if animation, SSR the final value as the static fallback.

### M5 — regulatory posture / copy scrub  *(mostly non-eng, do early)*
India is aggressive on unregistered "research analyst" activity. **Fix:** get a
real opinion on RA applicability; scrub buy/sell-adjacent language; keep "info /
education, not advice" framing everywhere. Cheap insurance — schedule early.

---

## 2. Feature changes

Enhance / harden / tune existing behaviour.

### BUG-01 — implausible 1D mover guard  *(High)*
`/market` top losers showed TRENT −33.4% 1D from a bad tick/corp-action in the
read-only golden DB (prod-only; local golden is clean). Movers come from
`build-market-snapshot.py`. **Fix:** sanity-guard the mover computation
(drop/winsorize implausible 1D for large-caps). Can't fix the golden source.

### Raise CDN cache TTL on remaining live endpoints (`s-maxage` 60 → 300)
sector-live already done (→10 min). Remaining: `/api/market/index-live`,
`/api/indices/constituents`. **Why:** an open tab re-hits origin ~1×/min (keeps
Neon awake). 300s → ~5× fewer wake-ups; data only changes ~10 min. **Risk:**
headline numbers up to ~5 min staler — pure display latency. Optionally also
bump client poll 60s → 120s.

### Corporate actions — backfill non-dividend history depth
Full CA via indianapi shipped, but verify split/bonus/rights/board-meeting
**history depth** is adequate per stock (indianapi returns a bounded window).
**Fix if thin:** widen the fetch window or paginate; relabel confirmed. Low
priority — revisit if users report missing old actions.

### M3 — zero-touch, gap-proof weekly snapshot  *(highest operational urgency)*
The score archive only compounds if it runs every week with no hole. **Fix:**
(a) [optional] TOTP-automate the daily Upstox token; (b) fully schedule the
weekly snapshot; (c) treat a missed/failed snapshot as Sev-1 — extend
`freshness-check.yml` to alert loudly on a gap. *(User chose manual Upstox tap,
so (a) is optional; (b)+(c) are the live work.)*

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
