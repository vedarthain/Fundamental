# EquityRoots.in — Page-by-Page Audit Tracker
Audited: 2 July 2026 · Method: HTML/text-level crawl of key pages (visual rendering, load speed, and mobile behavior NOT covered — verify those separately with Lighthouse + real devices)

Confidence tags: [C]=Certain (observed directly) · [L]=Likely (strong inference) · [G]=Guessing

Status column: ☐ open · ◐ in progress · ☑ done

---

## P0 — CRITICAL (fix before anything else)

| # | Page(s) | Issue | Evidence | Fix | Status |
|---|---------|-------|----------|-----|--------|
| 1 | Site-wide | [C] **Split-brain deployment: two builds live simultaneously.** Homepage, /news, /stock/* serve build `9730e85` (data: 2 Jul, 2,163 stocks, 46 peer groups). /market, /ideas, /about serve build `a85f6b9` (data: 2–5 Jun, 2,157 stocks, 49 clusters). | Footer commit hashes + status-bar dates differ per page | Single deploy pipeline; purge CDN/cache on release; add a build-hash consistency check to CI that fails if any route serves a stale hash | ☐ |
| 2 | /market | [C] **Stale market data presented as current.** "Updated daily after market close" but prices are Thu 4 Jun / Fri 5 Jun — a month old on 2 Jul. Indices, movers, FII flows, advance/decline all stale. | PRICES Fri 5 Jun banner vs actual date 2 Jul | Same root cause as #1; also add a visible "data as of" freshness check that turns the banner red/hides the page if data > 2 sessions old | ☐ |
| 3 | /stock/TITAN | [L] **Contradictory financials.** Revenue shown +80.5% YoY but +5.9% QoQ — implausible for Titan; likely standalone-vs-consolidated mixup or wrong comparison quarter. Same panel: net profit +35.4% YoY but −30% QoQ with narrative "Net profit is higher year-on-year" glossing the sequential collapse. | Q4 FY26 panel on TITAN page | Audit the YoY base-period logic; enforce standalone/consolidated consistency; add sanity bounds (flag YoY > 50% for large caps for manual review) | ☐ |
| 4 | /market | [L] **Unadjusted corporate action shown as price move.** TRENT listed as top loser at −33.4% in one day — almost certainly a split/bonus/demerger not adjusted in the price feed. | Top losers list | Ingest corporate-action calendar; adjust price series before computing returns; add a circuit-breaker rule (single-day move > ±20% on an F&O large cap → hold for review) | ☐ |
| 5 | /ideas | [L] **Ideas computed on month-old snapshot.** "Latest snapshot: 2026-06-02" on 2 Jul — four missed weekly recomputes, despite "recomputed weekly, never edited" being the core promise. | Snapshot date line on /ideas | Same as #1/#2; additionally alert (email/Slack) when the weekly Friday job doesn't land | ☐ |

## P1 — HIGH (credibility & SEO)

| # | Page(s) | Issue | Evidence | Fix | Status |
|---|---------|-------|----------|-----|--------|
| 6 | /stock/*, /ideas, /about | [C] **Generic homepage <title> and meta description on every non-homepage route.** TITAN's page is titled "EquityRoots — Indian stocks, scored against their real peers". Stock pages are your entire SEO surface (2,163 long-tail keywords) and they're all invisible to Google as distinct pages. /market and /news have proper titles, proving the capability exists — it's just not wired up on the dynamic routes. | <title> tags observed | Per-route metadata: "TITAN — Titan Company: Industry Score, Quality/Valuation/Momentum · EquityRoots" + unique description with score/rank; add OpenGraph + JSON-LD (Organization, Dataset/FinancialProduct) | ☐ |
| 7 | Site-wide | [C] **No proof the scores work.** Zero backtest, no historical hit-rate, no "top-decile vs index" chart anywhere, despite immutable snapshots being the perfect raw material for exactly this. | All pages reviewed | Ship a "Receipts" page: performance of each score decile per snapshot vs Nifty 500, updated weekly, dated and immutable. This is your single highest-ROI feature | ☐ |
| 8 | Site-wide | [L] **Anonymous operator.** No team, founder, or entity name anywhere. Combined with "not SEBI-registered," anonymity compounds distrust for a finance product in India. | No about-the-people section on /about | Add a founder/team section with real names; state the legal entity in the footer | ☐ |
| 9 | /ideas | [L] **"Building strength" surfaces illiquid micro-caps with no liquidity/quality floor.** Top 5 = Innovision, SPARC, Motor & General Finance, Insolation Energy, Jaykay Enterprises — mostly micro-caps where momentum spikes are noise or operator-driven. Surfacing these to retail is a SEBI-optics risk even with disclaimers. | Top-5 list on /ideas | Apply floors on the default view: min median daily traded value, min market cap; keep an "include micro-caps" toggle for those who opt in | ☐ |
| 10 | /ideas | [L] **Cluster/tier labels look wrong.** SPARC (loss-making pharma R&D) labeled "Long-term Compounder"; Motor & General Finance under "Commercial Services." "Compounder" as a *tier name for listing age* reads as a quality endorsement to any normal reader. | Idea cards | Rename tiers to neutral terms ("10y+ history", "7–9y", …) — "Long-term Compounder" on a loss-making stock actively misleads; re-verify cluster assignments | ☐ |
| 11 | /news | [C] **Raw URLs rendered as visible text above every headline.** Each item shows the full cnbctv18/ET/livemint URL as a link line, duplicating the headline link below it. | Every news item | Render headline-as-link only; keep source as a small label (e.g., "CNBC-TV18") | ☐ |
| 12 | /news | [C] **Broken category classifier.** "Mumbai rains school holiday" → General; helicopter mishap → Markets; X-Men '97 review → General; football World Cup → General; WhatsApp phishing → Policy▼; France election → Markets. Non-market content pollutes a market-news page. | Category tags across the feed | Add a relevance filter (drop items with no market/finance entity), retrain/re-prompt the classifier, and let users hide "General" | ☐ |
| 13 | /news | [L] **357 items on one page, no pagination or virtualization.** Massive DOM/payload; hurts mobile and Core Web Vitals. | "All 357" with full list rendered | Paginate or infinite-scroll with windowing; cap initial render at ~30 | ☐ |
| 14 | Site-wide | [C] **Nav markup duplicated 3–4×** on every page (Market/Segments/News/Tools repeats). Bloats DOM, confuses screen readers, and one variant on stale-build pages omits News and shows a mystery "Pages▾" instead. | Extracted HTML on every page | One nav component, responsive via CSS not duplication; aria-labels; reconcile the "Pages" vs "News" divergence (falls out of fixing #1) | ☐ |

## P2 — MEDIUM (product & conversion)

| # | Page(s) | Issue | Evidence | Fix | Status |
|---|---------|-------|----------|-----|--------|
| 15 | Homepage | [L] No signup value proposition. "Account▾" exists but nothing tells a visitor why to register; the only hook is buried at the bottom of /market ("watchlist movers... once signed in"). | Homepage + /market footer CTA | Add one homepage section: what an account unlocks (watchlist, alerts); email capture if free | ☐ |
| 16 | Homepage | [G] Heatmap "tear" hides 31 of 46 sectors behind a click. Clever, but most of the product is invisible on the landing page. | "+31 behind the tear" | A/B test full map vs tear; measure click-through to /sectors | ☐ |
| 17 | /market | [C] Confusing empty-state: "No live ticks yet today — switch to 1M/3M" shown while also displaying "+0.05%" for NIFTY. Contradicts itself. | Indices panel | If no intraday data, show last close clearly labeled; don't render a fake 0.00% "Today" | ☐ |
| 18 | /market | [C] "Building strength" panel permanently empty: "Need 4+ snapshots... will populate" while the archive already claims 9 snapshots. Either a bug or stale copy. | Panel text vs "ARCHIVE 9 snapshots" in status bar | Wire the panel to the archive, or remove it until it works | ☐ |
| 19 | /stock/* | [L] No price chart visible in extracted content, and no peer table on the page's first screen — the core promise ("vs its real peers") isn't demonstrated where users land. | TITAN page structure | Ensure peer-rank context (top-5 peers + this stock highlighted) appears above the fold on stock pages | ☐ |
| 20 | /stock/TITAN | [C] Narrative text contradicts its own bullets: headline says "profitability slipped" while bullets lead with positives (+80% rev, +35% NP) — the −30% QoQ profit fall is buried mid-bullet. | Progress panel | Rework the template so sequential deterioration leads when it's the dominant signal | ☐ |
| 21 | Footer (all) | [L] Public GitHub repo (`vedarthain/Fundamental`) linked from every page. Exposes methodology/codebase to anyone; contradicts "What we don't publish" IP stance on /about. | Footer commit link | Decide: open-source as trust play (then embrace it on /about) or make repo private and link to a changelog instead. Current state is accidental | ☐ |
| 22 | /about | [L] "What we don't publish" (cluster definitions, weights) sits in tension with the transparency pitch — and with #21, the weights may literally be in the public repo. | /about copy + footer link | Align the policy with reality; if repo stays public, rewrite this section | ☐ |
| 23 | /ideas | [C] Every bucket shows exactly "top 5" — feels arbitrary and thin for a page called a "feed." | Bucket counts all =5 | Show full ranked lists (paginated), or explain the top-5 cutoff | ☐ |

## P3 — LOW (polish)

| # | Page(s) | Issue | Fix | Status |
|---|---------|-------|-----|--------|
| 24 | Site-wide | [L] Inconsistent terminology: "peer groups" (homepage) vs "clusters" (about/market); "46" vs "49". Partly the build split, but standardize the word too | Pick one term site-wide | ☐ |
| 25 | /news | [G] "Most talked about" counts include TMCV (Tata Motors CV) — check demerger-era ticker mapping so mentions aren't split/misattributed across TMCV/TML tickers | Verify entity-tagging against current NSE symbol master | ☐ |
| 26 | /market | [L] Holiday widget shows "+71d, +112d" offsets — useful, but the nearest holiday is 6 weeks away; consider showing next earnings/expiry dates instead, which traders actually need | Swap or augment widget | ☐ |
| 27 | Site-wide | [G] No visible sitemap.xml/robots reference in content; with per-page titles broken (#6), crawlability of 2,163 stock pages is doubtful | Generate sitemap of all stock/sector routes; verify in Search Console | ☐ |
| 28 | Site-wide | [G] Accessibility unaudited: duplicated navs (#14) suggest more issues (focus order, contrast, aria). | Run axe-core/Lighthouse a11y pass | ☐ |

---

## Suggested execution order
1. **Week 1:** #1–#5 (deployment split + data integrity). Nothing else matters while the site shows wrong numbers.
2. **Week 2:** #6 (per-page SEO metadata) + #14 (nav) — mechanical, high leverage.
3. **Week 3:** #7 (receipts/backtest page) + #8 (identity) — converts skeptics.
4. **Week 4:** #9–#13 (ideas quality floors, news cleanup).
5. **Ongoing:** P2/P3 as capacity allows.

## Visual pass addendum — 2 Jul 2026 (live Chrome session, desktop 1424px + mobile 390px)

Verified in-browser:
- ☑ CONFIRMED #1/#2/#5: split-build is server-side. Homepage = 2 Jul data / 46 groups; /market + /ideas = June data / 49 clusters, in the same live session. Not a crawler artifact.
- ☑ CONFIRMED #11: /news raw URLs render as grey link walls above every headline — worse than expected.
- ☑ CONFIRMED #19 (visual): TITAN page shows no peer-rank context above the fold at 1424×689.
- ☑ CLEARED (downgrade) #14 mobile impact: 390px layout collapses nav correctly, no horizontal scroll. Duplicated markup remains a DOM/a11y issue but does not break mobile rendering.

New visual issues:
| # | Page | Issue | Fix | Status |
|---|------|-------|-----|--------|
| 29 | Status bar (all) | [C] SNAPSHOT date styled orange + underlined — reads as error/broken link, meaning unexplained | Neutral styling, or tooltip explaining snapshot cadence; use color only for genuinely stale states | ☐ |
| 30 | Homepage (mobile) | [C] Heatmap tiles cramped at 390px; smallest sector labels unreadable | Mobile: switch to ranked list or larger-tile top-N view | ☐ |

Positive findings (don't "fix" these): dark theme coherent; serif hero distinctive; status ticker is a good trust device; treemap renders well on desktop; page paints fast subjectively (~<3s) — visual redesign NOT needed.

Still pending: Lighthouse/CWV numbers, logged-in features walk (watchlist), screener + peer-comparison tools, glossary.

## Full-crawl addendum — 2 Jul 2026 (all 14 route templates walked in live browser)

Routes covered: /, /market, /news, /ideas (+4 bucket views), /sectors, /industry/* (sampled bfsi_pvt_banks_large), /stock/* (TITAN, INNOVISION), /tools, /tools/screener, /tools/peer-comparison, /tools/investing-trials, /glossary, /about, /feedback, /watchlist.

### CORRECTION to earlier passes
- ✏️ #1/#2/#5 RESCOPED, P0 → P1: In the live browser, /market shows LIVE 2-Jul data and /ideas shows the current 28-Jun snapshot. The month-old June data appears only in HTML served to fetchers/crawlers (SSR/prerender cache). Users see fresh data; **bots and Google index stale data**. Fix target: prerender/cache invalidation on deploy + data refresh, not the user-facing pipeline. (Earlier "visually confirmed user-facing staleness" was my error.)

### New findings
| # | Page | Sev | Issue | Fix | Status |
|---|------|-----|-------|-----|--------|
| 31 | /stock/INNOVISION, /ideas | P0 | [C] 3-month-old IPO (listed 23 Mar 2026, one reported quarter) scored 92, Rank 2/13, surfaced top of Ideas. Percentile scoring on 1 quarter of data is statistically meaningless and destroys score credibility | Minimum-history gate (e.g. ≥4 quarters) before displaying a score; show "Unscored — insufficient history" | ☐ |
| 32 | /stock/* | P1 | [C] Small-cluster false precision: "92" percentile in a 13-member cluster where each rank ≈ 8 points | In clusters <~20 members, lead with rank ("2nd of 13"), de-emphasize percentile; add uncertainty note | ☐ |
| 33 | /ideas | P1 | [C] "Snapshot 2026-06-28 · comparing vs 2026-05-12" — weekly product comparing vs a 7-week-old base | Compare vs previous weekly snapshot, or label the window explicitly ("6-week change") | ☐ |
| 34 | Footer vs status bar | P3 | [C] Footer: "snapshots recompute every Friday"; snapshot dated Sun 28 Jun 2026 | Align copy with actual job schedule | ☐ |
| 35 | /stock/*, /industry/* | P1 | [C] Refines #6: unique titles EXIST on /tools/peer-comparison and /feedback but not on stock/industry routes — the highest-SEO-value pages | Apply the existing title pattern to /stock/* and /industry/* templates | ☐ |
| 36 | /stock/TITAN | P0 | [C] Reconfirmed in live browser: +80.5% YoY revenue vs +5.9% QoQ — user-facing, not a cache artifact. #3 stands at full severity | Same as #3 | ☐ |

### Cleared / no issues found at visual level
/watchlist, /feedback, /glossary, /sectors, /tools index, /tools/screener, /tools/investing-trials, /industry template — rendered without errors or crash states. Functional stress-testing (running screens, adding watchlist entries, submitting feedback) not performed — next depth level if desired.

### Revised priority order
1. #31 + #36/#3 (score credibility: IPO gating, TITAN YoY bug) — these are what a sophisticated user will judge you on
2. #1/#2/#5 rescoped (prerender cache staleness — SEO integrity)
3. #35/#6 (stock-page titles)
4. #7 (receipts/backtest page), #8 (identity)
5. Everything else as before

## Functional pass addendum — 2 Jul 2026 (interactive testing, SEO infrastructure, console)

| # | Area | Sev | Issue | Fix | Status |
|---|------|-----|-------|-----|--------|
| 37 | SEO infra | P0 | [C] robots.txt declares Sitemap: /sitemap.xml → returns 404. With #35 (generic stock titles) + #1 (stale prerender), the 2,163 stock pages are near-invisible to search | Generate sitemap.xml covering all stock/industry/tool routes; submit in Search Console | ☐ |
| 38 | /tools/opportunities | P0 | [C] Header claims returns are benchmark-relative, "not absolute price change" — but every value is exactly absolute (INFY 985.3 from 1,203 = −18.1% raw). Copy and computation contradict | Either compute true relative returns or fix the copy; add a unit test asserting label matches math | ☐ |
| 39 | robots.txt | P2 | [C] Blocks ~20 AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended…). [G] Likely boilerplate, not strategy | Decide deliberately: AI search referrals vs content protection. Document the choice | ☐ |
| 40 | /watchlist | P1 | [C] Same-screen contradiction: header "Saved to your account" vs empty-state "saved on this device" | Pick one (account, presumably, since login exists) and fix the other string | ☐ |
| 41 | /tools/opportunities | P2 | [C] Filing headlines render raw/mangled: ", Regulations, 2015", "It'S Next-Gen" — leading commas, broken title-casing, no cleanup | Strip boilerplate, sentence-case, min-length filter on filing subjects | ☐ |
| 42 | /tools/opportunities | P2 | [L] "Beaten down" list includes MARUTI at +16.9%/12M and +11.2%/1M (qualifies only via −15.1% 6M) | Require underperformance on ≥2 windows, or label the qualifying window per row | ☐ |
| 43 | Navigation | P1 | [C] /tools/opportunities is orphaned — not linked in footer/main nav (only screener, trials, peer-comparison are) | Add to footer Product column and Tools dropdown | ☐ |
| 44 | 404 page | P3 | [L] Bare framework-default 404 ("This page could not be found"), generic homepage title, no search/nav recovery | Custom 404 with stock search box + popular sectors | ☐ |

### Cleared in functional pass
- Peer-comparison: works, URL-parameterized (?a=INFY&b=TCS&c=HCLTECH) — shareable links, good design. Keep.
- Console: zero JS errors/exceptions across the whole session.
- Screener quick-filters: responsive, no errors observed.

## What this audit did NOT cover (do these yourself)
- Visual design, spacing, color, typography (needs a rendered browser)
- Page load speed / Core Web Vitals (run Lighthouse)
- Mobile layout (test on device)
- Logged-in experience, screener, peer-comparison tool, glossary, investing-trials (not crawled)
- Backend/score correctness beyond the surface contradictions flagged above
