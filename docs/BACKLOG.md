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
