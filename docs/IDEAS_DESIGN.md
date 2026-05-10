# `/ideas` — Design Rules (Don't Forget)

> The `/ideas` page is the highest-risk surface for retail retention. A churning weekly list of "30 interesting stocks" is the same noise every screener produces. If we ship that, retail investors open it once, feel overwhelmed, and never come back.
>
> This doc captures the rules that turn `/ideas` from a noisy screener into a trustworthy watchlist source. Every change to the page must respect these rules.

---

## The mental model (state this on our side first)

> **`/ideas` is not a list of stocks to buy. It is a list of stocks worth opening the page on.**

Every entry must answer three questions before it earns a slot:

1. **What changed?** (Composite went from 62 → 78)
2. **Why?** (Quality up 14 pts on Q3 margin expansion)
3. **Is this a spike or a trend?** (Has been rising for 6 weeks → conviction; jumped this week only → noise)

If any of the three can't be answered cleanly, the entry doesn't qualify.

---

## The six design rules

### Rule 1 — Show *trends*, not *spikes* (conviction gate)
A stock that crossed a threshold this week is **only** interesting if it's also been moving in that direction for 4+ weeks. One-week movers are mostly noise — peer reporting, Friday close oddities, data-pipeline blips.

**SQL implementation:**
- Compute delta vs **4 snapshots ago** (not last week)
- Require `current = MAX(last 4 snapshots)` for "rising" — i.e. fresh high
- Require `current = MIN(last 4 snapshots)` for "falling"

**Graceful degradation:** if fewer than 4 snapshots exist yet (early days of the archive), show a banner explaining the conviction filter activates later, and use whatever window is available.

### Rule 2 — Default to recognizable names (Nifty 500)
A retail user with ₹50K does not want to see SUYOG TELEMATICS. They want HDFC BANK, ITC, TITAN, INFY first.

- **Default toggle:** Nifty 500 only
- **Off-toggle:** all active stocks (for users who want to dig)
- Toggle state lives in URL query param so it's shareable and survives reload

**Schema dependency:** `app.universe.is_nifty500 BOOLEAN` (added in migration `0007_nifty500.sql`). Population is a one-line SQL the operator runs once with the official NSE list — see `docs/SNAPSHOT_CRON.md`-style ops note at the bottom of this doc.

### Rule 3 — Cap the feed at ~5 names per section
**Five well-explained changes beat fifty unexplained ones.**

If only 3 stocks crossed real thresholds this week, show 3. Padding the list to "look full" is the worst thing we can do.

### Rule 4 — One-line "why" with every entry
Every row needs a plain-English reason a retail user can sanity-check. Templated from the pillar deltas:

| Pattern | Example |
|---|---|
| Biggest pillar move drove the change | *"Quality up 14 pts (now top 22% of IT Services). Valuation steady."* |
| Pillar slipped | *"Valuation slipped to bottom 30% — stock has run ahead of fundamentals."* |
| All three pillars improved | *"Broad-based improvement across all three pillars over 6 weeks."* |

If we can't generate a clean "why" line, **the row doesn't qualify.**

For now this is templated from numeric pillar deltas. Phase 3 (Claude narratives) will replace the template with grounded LLM text — same constraint applies: if the validator can't certify the line, it doesn't show.

### Rule 5 — Show the trail, not the snapshot
Every entry includes a 12-week sparkline of the Composite score.

The user **sees** the stock has been climbing for months — not just spiked this week. That visual builds conviction faster than any number can.

(Implementation: pure-SVG `<Sparkline>` from `web/src/components/Sparkline.tsx`. Server-rendered. No client JS.)

### Rule 6 — Persistent disclaimer (the trust builder)
On the page itself, a small persistent note:

> *"These are stocks where our score has changed meaningfully. We don't predict prices — we surface companies whose fundamentals are strengthening or weakening relative to their peers. Do your own research before investing."*

This sounds like boilerplate but it's the **opposite** of what tipster channels do, and retail investors read the difference instantly. A platform that says *"we don't predict prices"* feels different from every Telegram tip.

---

## Sections on the page

Four boards, each capped at 5 entries:

| Section | Filter | Why it matters |
|---|---|---|
| 🔼 **Building strength** | Composite ≥10 pts higher than 4 weeks ago, current is fresh 4-week high, current ≥50 | Stocks where fundamentals are strengthening with conviction |
| 🔽 **Losing ground** | Composite ≥10 pts lower than 4 weeks ago, current is fresh 4-week low, current <60 | Stocks to be cautious about (or exit) |
| ⚡ **Recent breakouts** | Current ≥75 (top quartile), 4 weeks ago <75 | Stocks just entering top-quartile territory |
| 💔 **Recent breakdowns** | Current <50 (below median), 4 weeks ago ≥50 | Stocks that have lost their footing |

A stock can appear in **at most one** section per render — first match wins, in the order above. This prevents double-counting and keeps the page focused.

---

## What `/ideas` is *not*

- ❌ **Not a buy list.** Never use the word "buy", "recommendation", or "pick" anywhere on the page.
- ❌ **Not personalized.** v1 has no user accounts; the page is the same for everyone. Personalization comes with watchlists later.
- ❌ **Not real-time.** Updates only on weekly snapshot. Live price ticks are a different surface.
- ❌ **Not exhaustive.** If 100 stocks technically qualify this week, we still only show the top 5 per section. The point is signal, not coverage.

---

## The retail user journey we're optimizing for

1. **Lands on `/ideas`** → sees ~20 names total (5 per section), each with a one-line "why" and a 12-week trail
2. **Clicks INFY** (a name she recognizes) → reads the narrative, sees the cluster percentiles, sees that it's been top-quintile in IT Services for 14 weeks
3. **Comes back next Friday** to see if INFY is still strong
4. **Three weeks later** → INFY is still rising, peer median has weakened. Conviction builds.
5. **She buys INFY** through her broker. Then watches the score trail to know when to exit.

That's the loop: **discovery → trail-watching → conviction → action.** Not "buy this list."

---

## The retention hook (future work, not v1)

The feed itself is *discovery*. The retention hook is the **watchlist** — once a user has 8 stocks they're tracking, they come back to see how *their* stocks moved, not just what the algorithm surfaced.

When we add user accounts, every row on `/ideas` gets an "Add to watchlist" button. The feed becomes the entry point into a personalized space — the personalized space is where we keep them.

Don't add a watchlist button before the auth/storage layer exists. A button that doesn't work is worse than no button.

---

## Education layer (tooltips, not lectures)

Every concept needs a **one-line** tooltip a 15-year-old could understand. We do **not** dumb down the math — we **do** translate the labels.

| Term in UI | Tooltip |
|---|---|
| "Top 15% of IT Services" | *"Of 24 IT companies, this one ranks in the top 4."* |
| "Composite 78" | *"Combined score across profitability, valuation, and momentum. 50 is average, 80+ is strong."* |
| "6-week improvement" | *"Score has risen each of the last 6 weekly snapshots."* |
| "Cluster percentile" | *"Where this stock ranks vs only its industry peers — not the whole market."* |
| "Conviction filter" | *"We require 4 weeks of consistent movement before we surface a stock — to filter out one-week noise."* |

Implement as native `<title>` attributes (zero JS) or simple hover popovers later.

---

## Operational notes

### Populating the Nifty 500 flag
The migration `0007_nifty500.sql` adds the column with default FALSE. To populate:

```bash
# Option A — quick manual list (preferred for now)
# Get the official CSV from NSE: https://archives.nseindia.com/content/indices/ind_nifty500list.csv
# Then:
psql fundamental_app -c "
  UPDATE app.universe
     SET is_nifty500 = TRUE
   WHERE symbol IN ('RELIANCE', 'TCS', 'HDFCBANK', /* ...500 symbols... */);
"

# Option B — add an ETL command (future)
# etl seed-nifty500   # fetches CSV from NSE and updates the column
```

Until populated, the toggle still works but the Nifty 500 view returns 0 rows and the page shows a banner.

### Refresh cadence
The page is `revalidate = 1800` (30 minutes). Snapshot data only changes weekly so this is generous. Adjust if needed.

### Performance
Single SQL query joins app.scores (×12 weeks) → app.universe → app.cluster, aggregates 12-week trails as JSON in Postgres. Returns ~2,150 rows max. Pivot + section assignment happens in JS.

If performance becomes an issue (it shouldn't at this size), pre-compute the section assignments in a materialized view refreshed after each `./snap`.

---

## Honest framing of risk

This is the line that earns trust:

> *"We don't predict prices. We give you a defensible current view with history attached."*

`/ideas` lives or dies by whether retail users feel the platform respects their intelligence. Every design rule above flows from that.

---

*Last updated: 2026-05-05*
