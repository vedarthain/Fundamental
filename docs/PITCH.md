# The 60-Second Pitch

> Use this when someone asks "so what does your platform do?" at a coffee, in an elevator, or on a call. Three versions below — pick the one that fits the audience.

---

## The 60-second version (default)

> *"There are 2,150 actively-traded stocks on the NSE, and most screeners rank them with one formula — same rules for a bank, a cement plant, and an IT company. That's broken, because what makes a bank good is not what makes a cement company good.*
>
> *We split the universe into 41 industry clusters and give each cluster its own scorecard, tuned to what actually matters there — leverage for banks, capacity utilization for cement, margin trend for IT.*
>
> *Every week we run all 2,150 stocks through their right scorecard and save the scores into an append-only archive. After a year, that's 110,000 time-stamped receipts. A competitor who launches later cannot fake that history — they can guess what their score would have been, but they can't prove what they would have said.*
>
> *On top of the scores, we generate plain-English narratives — 'this stock is top-quintile on profitability but valuation has slipped' — validated against the underlying numbers so the LLM can't hallucinate.*
>
> *So the product is: opinionated scoring, industry-specific, with receipts and a story. Bloomberg has more data. We have a sharper view of it."*

**~150 words. ~55 seconds at speaking pace.**

---

## The 30-second version (when they're in a hurry)

> *"It's a stock-scoring platform for the NSE. The trick is: instead of one formula for every company, we use 41 industry-specific scorecards — banks get judged on bank metrics, cement on cement metrics. We save every weekly score into an append-only archive, so over time we can show how our view of a stock evolved before the market caught on. That history is the moat — competitors who launch later can't reconstruct it."*

**~75 words. ~25 seconds.**

---

## The 10-second version (one-liner)

> *"Stock scoring for Indian equities, but with industry-specific scorecards and a tamper-proof archive of every score we've ever published — so when we tell you a stock looked good six months ago, we can prove it."*

**~35 words.**

---

## How to deliver it

### The hook (first sentence)
Always start with the **problem**, not the product. "Most screeners use one formula for every company — that's broken." People lean in for problems. They tune out for product descriptions.

### The pivot (middle)
One sentence on **what's different**: "industry-specific scorecards" + "append-only archive". Don't list features. Two ideas, max.

### The mic drop (last sentence)
End with the **moat in plain language**: "Competitors can't reconstruct that history." Or: "Bloomberg has more data; we have a sharper view of it." A line they'll repeat to someone else.

---

## What to skip

These details matter for builders, **not for a pitch**:

- ❌ Maturity tiers, percentile bands, scoring weights, table names
- ❌ "We use Postgres / Next.js / Claude API" — nobody cares about your stack in a pitch
- ❌ Exhaustive feature lists (heat map, cluster pages, score feed, search…)
- ❌ Competitor name-dropping. Don't punch sideways.

These are credibility-builders that come up **after** they ask "tell me more."

---

## Common follow-up questions, with crisp answers

**"How is this different from [stock screener X]?"**
> "Most screeners give you filters and let you build your own rule. We give you an opinion — a single number per stock per pillar — and the receipts behind it. Different product."

**"Do you predict prices?"**
> "No. We give you a defensible current view with history attached. What you do with it is your call."

**"What's your data source?"**
> "Public filings and public prices. Same as everyone. The edge is the opinionated framework on top, not the raw data."

**"Why should I trust your score?"**
> "Because we've been publishing it weekly for [N] months and the archive is append-only. You can pull up any stock and see the score trend — including the times we were wrong. Most platforms only show you the wins."

**"Who's it for?"**
> "Self-directed retail investors who want a starting opinion to react to, and analysts who want a fast peer-cluster view without building one themselves."

**"Are you SEBI-registered?"**
> "It's an information platform, not advisory. We score and narrate. We don't tell you to buy or sell."
> *(Update this line based on your actual regulatory posture — placeholder.)*

---

## Three audience-specific tweaks

### To a fellow engineer
Lead with: *"It's a percentile-rank scoring engine with industry-specific weighting and an append-only score archive."* They'll get it instantly.

### To an investor (money person)
Lead with: *"There's no ranking platform for Indian equities that's actually opinionated and has a verifiable track record. That's a category gap."* Then the product.

### To a non-finance friend
Lead with: *"You know how Goodreads ranks books? It's like that for stocks — except the rankings are industry-specific and we save the history so you can see how our view changed over time."* Then dial up detail if they're interested.

---

## The two phrases worth memorizing

If you only remember two lines from this whole doc:

1. **The problem:** *"Most screeners use one formula for every company. That's broken."*
2. **The moat:** *"A competitor can guess what their score would have been. They can't prove what they would have said."*

Everything else is filler around those two ideas.

---

*Last updated: 2026-05-05*
