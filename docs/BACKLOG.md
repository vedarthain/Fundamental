# Backlog

Deferred work — captured so it isn't lost, not yet scheduled. Each item notes
the decision context so it can be picked up cold.

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
