# Backlog

Deferred work — captured so it isn't lost, not yet scheduled. Each item notes
the decision context so it can be picked up cold.

---

## ⚙️ Deployment & fix policy (effective 2026-06-05)

- **Fix on localhost first**, then promote to production.
- **Production deploys happen once a week — Saturdays/Sundays only.** Batch the
  week's changes and ship them together on the weekend.
- **No production fixes mid-week** unless **very critical** (site down, data
  corruption, security). Everything else waits for the weekend window.
- Localhost DB = local Postgres (`postgres:///fundamental_app` +
  `postgres:///golden_db`). Never point local work at Neon prod.

---

## Cost / infra

### Raise CDN cache TTL on live endpoints (`s-maxage` 60 → 300)
- **Status:** Deferred (2026-06-04).
- **What:** Bump `Cache-Control: s-maxage` from 60s to 300s on the polled live
  endpoints — `/api/market/index-live`, `/api/market/sector-live`,
  `/api/indices/constituents` (keep `stale-while-revalidate`).
- **Why (benefit):** An open `/market` or `/indices` tab makes the CDN re-hit
  the origin ~once/min (≈1 DB query/min) which keeps Neon awake and accrues
  compute-hours. At 300s the CDN serves cache for 5 min → ~5× fewer DB
  wake-ups (and fewer Vercel invocations). Underlying data only changes every
  ~10 min (pinger cadence), so freshness loss is negligible.
- **Risk:** Headline "live" numbers can be up to ~5 min staler (≈11 → up to
  ~15 min old); the on-screen tick/badge refreshes visibly every ~5 min
  instead of ~1 min. No correctness impact — pure display latency. Only helps
  *while a tab is open*; the 24/7 win was the cron market-hours guard
  (already shipped, commit c765b3b).
- **Decision:** Worth doing but low urgency — leave at 60s for now; revisit if
  compute-hours climb from leaving live pages open. Optionally also bump the
  client poll interval 60s → 120s for further reduction.

---

## Moat — pre-mortem actions (2026-06-04)

From a pre-mortem ("it's 2028, the site stalled — why?"). Ordered by ROI.
These turn the stated moats (Score Archive → Cluster Scorecards → Narratives)
from a story into a defensible asset. Pick from here.

### M1. Make the score archive tamper-EVIDENT (highest ROI)
- **Risk it kills:** The core pitch is "show me the row — we can prove what we
  said." But `app.scores` is a normal table the admin can UPDATE/DELETE, so
  immutability is a promise, not a proof. Diligence question "prove you didn't
  edit it" currently has no answer.
- **What:** Hash-chain each weekly snapshot — store
  `snapshot_hash = sha256(ordered rows + prev snapshot_hash)` per
  `snapshot_date` (new column/table). Then anchor each weekly hash somewhere
  public + free: a git commit in this repo, a tweet, and/or OpenTimestamps.
  "Show me the row" becomes "here's cryptographic proof it existed unedited on
  that date."
- **Effort:** M (one migration + a hash step in the snapshot job + a tiny
  publish step). **Depends on:** snapshot job being reliable (see M3).

### M2. Prove the score has edge (backtest + honest scorecard)
- **Risk it kills:** Receipts of *what?* No evidence `composite_pct` predicts
  forward returns / avoids blowups. If the score has no edge, the archive
  documents mediocrity.
- **What:** Backtest harness over the existing `app.scores` archive + golden
  prices: forward 1M/3M/6M/12M returns by score quintile, hit-rate, and the
  misses. Publish it (landing-page hook) — including when we were wrong.
- **Effort:** M–L (analysis script + a results page). **Note:** needs enough
  archive depth; partly time-gated, but can start with what exists.

### M3. Zero-touch, gap-proof weekly snapshot (protects M1's value)
- **Risk it kills:** The archive only compounds if it runs every week for
  years with no hole. Today it leans on manual acts that broke this week
  (Upstox re-auth, Screener cookie, manual triggers). One missed week =
  permanent gap = pitch dies under diligence.
- **What:** (a) TOTP-automate the daily Upstox token; (b) fully schedule the
  weekly snapshot; (c) treat a missed/failed snapshot as Sev-1 — extend
  `freshness-check.yml` to page/alert loudly on a gap.
- **Effort:** M. **Highest operational urgency.**

### M4. Cold-start value + distribution
- **Risk it kills:** Moats defend a position you've reached; right now there's
  no acquisition story, and the archive moat is invisible to a day-one user
  (they see today's score, same feel as free incumbents).
- **What:** Landing hook = the M2 backtest; SEO the `/stock/[symbol]` pages
  (rank for "<TICKER> stock score/quality"); weekly "biggest score moves"
  email to build the return-weekly habit (which is what makes the archive
  matter to the user).
- **Effort:** L (ongoing). **Depends on:** M2 for the hook.

### M5. Regulatory posture (SEBI) — existential tail risk
- **Risk it kills:** India is aggressive on unregistered "research analyst" /
  finfluencer activity. Ranking stocks + "valuation slipped" can be read as RA
  services. PITCH flags the reg line as a placeholder.
- **What:** Get a real opinion on RA applicability; scrub buy/sell-adjacent
  language; frame as information/education; keep "not advice" everywhere.
- **Effort:** S (mostly non-eng) but **do early** — cheap insurance.

### M6. De-risk the data layer (don't-own-it fragility)
- **Risk it kills:** Archive sits on Screener (scraped, cookie-gated), NSE
  (403/timeouts), Upstox (daily token). Any block poisons the permanent
  archive.
- **What:** Freshness monitoring + alerts; cache raw inputs so a block doesn't
  corrupt a snapshot; write the archive only from cached clean inputs (never a
  flaky live scrape); line up fallback sources.
- **Effort:** M.

> Sequencing note: M3 (uptime) and M5 (reg) are the cheap insurance to do
> first; M1 + M2 are the real moat-makers; M4 monetises them. M2 feeds M4's
> hook, and M1's value depends on M3.

---

## Bug inventory (from EquityRoots_bug_list.md, reviewed 5 Jun 2026)

Fix on localhost, ship the batch on the weekend. Severity per the source list.
See that file for full descriptions. Located + planned 2026-06-05.

| ID | Sev | Source (located) | Fix |
|----|-----|------------------|-----|
| BUG-01 | High | `/market` top losers — TRENT −33.4% 1D. Bad tick/corp-action in **read-only golden** (prod-only; local golden TRENT is clean). Movers built by `build-market-snapshot.py`. | Trace prod golden tick; add a sanity guard (drop/winsorize implausible 1D for large-caps) in the mover computation. Can't fix golden source. |
| BUG-02 | High | Cluster count stated 3 ways: `app/page.tsx:519` hardcodes "Forty-one"; `SectorsClient.tsx:241` shows computed `clusterCount`; `SnapshotRibbon.tsx:184` shows `s.clusters`. Local truth: **cluster=49, meta_cluster=9**. | One canonical count from DB; replace hardcoded copy; reconcile cluster (49) vs "peer sectors" wording. NEEDS DECISION: which count is canonical + terminology. |
| BUG-03 | Med | Coverage count drifts 2,157/2,163/2,153/2,156. `app/page.tsx:34` = `COUNT(universe is_active)` (local=2163); header/screener use other sources. | Single canonical coverage count, computed once, reused. NEEDS DECISION: active-universe vs scored-at-latest-snapshot. |
| BUG-04 | Med | `peer-comparison/page.tsx:166` "up to five" vs `:301` "up to three" vs home card "2–5". | Read enforced max; make all 3 strings match. |
| BUG-05 | Low | PRICES date chip stale a day on static pages (home/about/glossary/feedback) vs data pages — ISR cache skew. | Align ribbon date source / revalidate across page types. |
| BUG-06 | Med | Identical `<title>`/meta description on about/glossary/sectors/ideas/screener/tools (only `/market`,`/feedback` unique). | Per-page `export const metadata` (unique title+desc). Doubles as moat M4 SEO. |
| BUG-07 | Med | Glossary example dials show 0.0%/0.00×/0 days in SSR HTML. Likely count-up animation. | Verify in-browser first; if animation, SSR the final value as no-JS fallback. |
| BUG-08 | Low | `SectorsClient.tsx:561/619/836` do `tierLabel(t)+"s"` → "Establisheds" (also breaks "Emergings"). | Add `tierLabelPlural()` in `lib/score.ts`; use at all 3 sites. |

**Suggested batches:** A = copy/counts (02,03,04,08) · B = SEO metadata (06) ·
C = date+glossary (05,07) · D = data guard (01, needs prod golden trace).

---

## Features — deferred

### Corporate actions: splits / bonus / rights history + announcements
- **Status:** Deferred (2026-06-07). Dividend history (BSE) shipped (52e50fe).
- **What's missing:** deep **split/bonus/rights** history and the **announcements**
  feed (Reg-30: board meetings, results dates, order wins, ratings, insider/SAST).
- **Why deferred — proven data ceiling:** BSE's free per-stock endpoint returns
  only the ~last 5 actions; a full-universe run (7,068 actions / 1,630 stocks)
  came back **100% dividends** — splits/bonus are rarer and fall outside that
  window, and BSE's `CorpactCustom` (full history) returns HTML, while its
  `AnnGetData` (announcements) returns "No Record Found" for us even market-wide.
  NSE has it all but **403s** (anti-bot wall).
- **Source options (a SOURCE decision, not a code one):**
  - **indianapi.in** — documented developer API, key-based; has `/corporate_actions`
    **and** `/news` (announcements). Recommended richer source. Freemium → **paid**
    for our ~2,160-stock volume; third-party dependency.
  - **Paid vendor** (NSE official feed / Refinitiv) — authoritative, costly.
  - **NOT StockEdge** — consumer app with a private/undocumented API; scraping it
    is fragile + ToS-violating. Evaluated and rejected.
- **Where it lands:** same `app.corporate_action` table (already has `action_type`
  + `source` + `details` jsonb) — just add a second fetcher writing source='indianapi'
  and relabel the stock card back to "Corporate actions" once non-dividends flow.
- **Decision:** revisit only if users ask for announcements / non-dividend actions;
  otherwise the BSE dividend feature stands.

### StockEdge-style daily-updates dashboard
- **Status:** Idea (2026-06-07).
- **What:** a market "daily updates" page. ~70% buildable from sources we already
  own/proven — movers, 52w H/L, FII/DII, sector moves, **corporate actions (BSE)**,
  **bulk/block deals (NSE archive CSVs)**, IPO updates, price/volume shockers.
  The other ~30% (announcements, insider, board meetings, ratings) needs the
  richer source above.
- **Next step if picked up:** spec the tabs + per-tab source/query; new fetchers
  mainly for bulk/block deals + IPO.

### Fully hands-off operations hardening
- **Status:** Idea (2026-06-10). Goal: zero daily intervention except the one
  accepted manual task below.
- **Accepted manual task (by choice):** Upstox token reauth every morning ~08:30
  IST via `/admin/upstox`. Upstox v2 has no refresh-token, so the daily OAuth is
  unavoidable for live intraday. User chose the 20-sec manual tap over automating
  it. (Automation option, if ever wanted: headless Playwright login + `pyotp`
  TOTP on GitHub Actions, dispatched by cron-job.org ~08:40 IST — needs TOTP 2FA
  enabled + creds in GH secrets; fragile if Upstox changes its login UI. The
  alternative, EOD-only via NSE bhavcopy, was rejected because we want 10-min data.)
- **Reliability gaps to close (the real hands-off work):**
  - GitHub `schedule:` still drives `refresh-ltp`, `weekly-snapshot`,
    `refresh-announcements`, `refresh-constituents`, `freshness-check`. GitHub
    load-sheds top-of-hour (`:00`) scheduled events (the bug that broke news) and
    **auto-disables scheduled workflows after 60 days of no commits**.
    - **Quick win:** shift each cron off `:00` (e.g. `0 13` → `17 13`) to dodge
      contention. ~2-min change, keeps GitHub scheduling.
    - **Bulletproof:** move the critical ones (esp. `refresh-ltp`) to cron-job.org
      dispatch — same pattern as news (`/api/cron/refresh-news` → workflow_dispatch).
      Eliminates GitHub-scheduler dependency + the 60-day auto-disable.
- **Alerting:** `freshness-check` already emails on stale prices/scores — confirm
  repo Watch → "All Activity" / Settings → Notifications so breakage pings you.
  That's the hands-off contract: ignore until it emails.
- **Credential expiry:** set `GH_DISPATCH_TOKEN` PAT to long/no-expiry; indianapi
  key renews with the monthly plan. One calendar reminder covers both.
- **Recommendation when picked up:** quick cron-shift + confirm alert emails first
  (90% of the reliability for ~zero effort); escalate to cron-job.org migration
  only if GitHub drops a run again.
