# EquityRoots — Bug List

**Site:** https://equityroots.in  **Reviewed:** 5 Jun 2026

**Method:** Server-rendered HTML of the main pages (home, market, sectors, ideas, about, glossary, screener, peer-comparison, investing-trials, feedback, a sample stock page). JavaScript was not executed in this pass, so items tagged *Needs in-browser check* still need confirming in a live browser.

**Severity key** — High = wrong/implausible data or credibility risk · Medium = inconsistency or SEO/robustness issue users may notice · Low = cosmetic/minor copy.

| ID | Severity | Area / Page | Bug |
|----|----------|-------------|-----|
| BUG-01 | **High** | Market → Top losers (Nifty 50, 1D) | TRENT shown at **−33.4%** for a single day — implausible for a ₹1L Cr Nifty 50 stock; its own stock page shows it healthy (LTP ~₹2,763, score 78). Points to an unadjusted corporate action or a bad tick. |
| BUG-02 | **High** | Sitewide — sector/cluster count | The same concept is stated three different ways: home hero "**Forty-one** peer sectors", header chip "CLUSTERS **49**", /sectors page "**46** peer sectors". |
| BUG-03 | Medium | Sitewide — coverage count | Headline coverage disagrees across pages: header "**2,157**" vs homepage hero & screener breadcrumb "**2,163**" (sub-counts also show 2,153 and 2,156). |
| BUG-04 | Medium | Tools → Peer Comparison | Max-symbols count contradicts itself: intro "Pick up to **five** NSE symbols", empty state "Enter up to **three** NSE symbols above", home card "Compare **2–5**". |
| BUG-05 | Low | Static pages (home, about, glossary, feedback) | PRICES date chip reads **Thu 4 Jun** on static pages but **Fri 5 Jun** on data pages — stale by a day. |
| BUG-06 | Medium | Most pages (about, glossary, sectors, ideas, screener, tools) | Identical `<title>` ("EquityRoots — Indian stocks, scored against their real peers") and identical meta description on nearly all pages; only /market and /feedback are unique. |
| BUG-07 | Medium | Glossary — example gauges | Every example dial reads **0.0% / 0.00× / 0 days** in the HTML while the prose quotes the real figure (e.g. RoE prose "₹0.30 per ₹1" but the dial shows 0.0%). *Needs in-browser check — may be a count-up animation.* |
| BUG-08 | Low | Sectors & Investing Trials — tier labels | Maturity-tier label renders as "**Establisheds**". |

**Still open to verify:** BUG-07 needs a live browser (JavaScript) to confirm. BUG-01 is worth tracing across weekly snapshots to see whether the bad TRENT value persists or was a one-day tick.
