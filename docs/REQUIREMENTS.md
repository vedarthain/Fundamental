# NSE Equity Intelligence Platform — Master Requirements

**Status:** Phase 1 (data + scoring) functional. Phase 2 (web app) starting.
**Last updated:** 2026-05-04
**Source-of-truth doc:** `~/Downloads/NSE_Platform_Requirements_Analysis_1.docx`
**Working directory:** `/Users/debasissahoo/Documents/Fundamental`

This document is the consolidated specification. Reading order:
[product vision](#1-product-vision) →
[core visuals](#1a-core-visuals--the-shareable-units) →
[differentiation pillars](#1b-differentiation-pillars-per-source-doc-9) →
[retention hooks](#1c-retention-hooks-per-source-doc-10) →
[non-negotiables](#2-non-negotiables-hard-launch-constraints) →
[data foundation](#3-data-foundation) →
[cluster taxonomy](#4-sector-cluster-taxonomy) →
[scoring engine](#5-scoring-engine) →
[moat](#5a-moat--what-compounds-over-time) →
[editable scorecards](#5b-editable-scorecards-architecture) →
[v1 scope](#6-v1-scope-from-product-doc) →
[web app design](#7-web-app--design-system) →
[build sequence](#8-build-sequence) →
[current status](#9-current-implementation-status).
Cross-references in `[brackets]` point at the detailed docs in `docs/`.

---

## 1. Product vision

**An insight-first web platform for analysing Indian equities listed on NSE.** The platform
surfaces composite quality / valuation / momentum scores for 2,000+ stocks, ranked within
sector-specific peer clusters, with AI-generated narrative summaries that explain *why* a stock
scores the way it does — in plain language, not raw data.

Differentiated from Screener / Tickertape / Trendlyne by being **score-first, sector-relative,
explainable, and shareable** — not a data-and-filter tool.

### Three jobs the product replaces

1. **Discovery** — "Surface stocks I haven't seen that score well within their sector cluster"
2. **Diagnosis** — "Tell me *why* this stock scores 62nd percentile on quality, not just *what* the number is"
3. **Monitoring** — "Alert me when a stock in my watchlist deteriorates on momentum or quality"

### Audience

| Primary | Secondary |
|---|---|
| Self-directed retail investors on NSE | Independent equity analysts |
| Quantitatively inclined (comfortable with scores/percentiles) | SEBI-registered advisors |
| Active screener users (Screener, Tickertape power users) | Fintech builders evaluating data/API |
| Portfolio holding 15–60 stocks | The user's own analytical workflow (dual-use) |

### Acquisition wedge

Three free-to-access shareable surfaces; one click → registration → depth.

| Feature | Why it's the wedge |
|---|---|
| **Portfolio X-Ray** — paste Zerodha/Groww holdings → cluster concentration map, pillar exposure, weak links | Highest viral coefficient |
| **Sector Heat Map** — NSE sectors colour-coded by avg composite score; weekly refresh; no login | Strong repeat usage |
| **Narrative Engine Preview** — land on any stock page → 3-sentence AI analyst note | High word-of-mouth among analysts |

---

## 1a. Core visuals — the shareable units

Every visual is designed to be **screenshot-worthy, self-explanatory out of context, and worth
sharing on Twitter/LinkedIn fintwit circles**. These are the units users will share.

| # | Visual | What it shows | Placement | Notes |
|---|---|---|---|---|
| 1 | **Cluster radar chart** | 5-axis spider of the stock vs its (cluster, tier) median; immediate visual diagnosis of strengths and gaps | Stock page — above the fold | The 5 axes are *standardized diagnostic dimensions* (see below) — consistent across clusters so users learn the layout once |
| 2 | **Sector heat map** | 41 cluster tiles colour-graded by avg composite score; filterable by meta-cluster (8 buckets) | Home / discovery — public, no login | Weekly refresh; click a tile → cluster detail |
| 3 | **Portfolio X-Ray card** | Donut of cluster concentration + pillar heatmap for held stocks + 3 flagged "weak link" stocks | Portfolio tool | Shareable PNG export |
| 4 | **Score history sparkline** | 12-month composite score trend per stock; shows whether quality/momentum is improving or deteriorating | Stock page sidebar | Auto-builds from weekly score snapshots from launch day onward |
| 5 | **Score delta feed** | "What changed this week" — ranked list of biggest movers by pillar score across the universe | Home feed + daily/weekly digest email | Drives daily/weekly return visits |
| 6 | **Percentile badge** | Single clean badge: e.g. *"Top 12% in BFSI Pvt Banks · Established · Quality"* | Stock page header + share-card | Designed to be embedded or shared; tier label always shown to disambiguate "Top 12%" |

### The 5 spider axes (standardized across clusters)

The radar uses **5 standardized diagnostic axes** so users can read any stock's spider at a
glance, regardless of cluster. Each axis is a percentile (0–100) within the stock's
`(cluster, tier)` peer group. Which underlying metrics roll up to each axis is **cluster-aware**
— a bank's Profitability axis aggregates RoA + RoE + book-value CAGR; a cement company's
aggregates RoCE + EBITDA margin.

| Axis | Description | Cluster-specific roll-up examples |
|---|---|---|
| **Profitability** | Returns on capital deployed | Banks: RoA + RoE + book-value CAGR. FMCG: RoCE + RoE. Cement: RoCE + EBITDA margin. |
| **Growth** | Top-line and bottom-line CAGR | Universal: rev_cagr + np_cagr (window scaled to tier). Banks: + loan-book growth. |
| **Cash & Balance Sheet** | Cash conversion + leverage discipline | FMCG/IT: CFO/PAT + debt/equity. Cement: net debt/EBITDA + capex intensity. Banks: equity-to-assets. |
| **Valuation** | The Valuation pillar (already a percentile) | Cluster-specific: P/B-heavy for banks; P/E + PEG for IT; EV/EBITDA for cement. |
| **Momentum** | The Momentum pillar (already a percentile) | Universal momentum scorecard with cluster-specific tweaks (e.g. NP YoY upweighted for banks). |

Cluster median is rendered as a faint reference polygon; stock polygon overlaid in the cluster's
accent colour. Hover any axis → drill-down showing which underlying metrics rolled up.

### A 7th visual added per source-doc §9 — SHAP-style feature waterfall

| # | Visual | Placement |
|---|---|---|
| 7 | **Feature-importance waterfall** — horizontal bar chart decomposing a stock's composite score into positive (green) and negative (red) contributions per pillar component, with magnitudes scaled by `pillar_weight × component_weight × (sub_pct − 50)`. Reads like SHAP. | Stock page — below the radar; expandable per pillar |

This is the deepest "no black boxes" surface — every score traceable to its drivers in one glance.
Data already exists in `app.scores.{quality,valuation,momentum}_components` JSONB; this is purely a rendering layer.

---

## 1b. Differentiation pillars (per source-doc §9)

How the platform distinguishes itself, with our delivery status per item.

| # | Pillar | Source-doc sub-points | Status / where delivered |
|---|---|---|---|
| 1 | **Biggest unlock — Narrative engine** | AI 3-sentence "stock story"; auto-generated analyst notes; plain-language pillar explanation; sector-benchmarked commentary | v1 scope; Phase 3 implementation (Claude API + concall transcript ingestion). No competitor does this. |
| 2 | **Cluster-relative scoring** | Spider/radar per pillar vs cluster median; percentile bands (not raw); "Cluster leaders" leaderboard | Spider radar = visual #1. Percentile bands = `app.scores.composite_pct` etc. **Cluster leaders leaderboard = new explicit page** (`/cluster/[id]/leaders`). |
| 3 | **Model feature transparency** | SHAP-style feature importance waterfall; "what changed this week" delta feed; historical score trajectory per stock | Waterfall = visual #7 (new). Delta feed = visual #5. Trajectory = sparkline visual #4. |
| 4 | **Watchlist intelligence** | Score-ranked watchlists (auto-sorted); pillar-level breakout alerts; weekly digest | v1 scope; needs auth → Phase 2. |

These four pillars are the "elevator pitch" surfaces — every page must reinforce at least one.

---

## 1c. Retention hooks (per source-doc §10)

What keeps users returning. Each tagged with the engagement purpose the source-doc assigns.

| Feature | Purpose | v1? | Where it lives |
|---|---|---|---|
| **Weekly score pulse** | Retention | v1 | Email digest + `/feed` web page; cluster-personalized once auth lands |
| **Custom screener builder** | Power users | v1 | `/screener` — adds **score-weighted filters** (rank by score-weighted blend, not just gate); distinguishes us from Screener.in's pure-filter model |
| **Portfolio X-Ray** | Viral hook | v1 (manual input) | `/portfolio` — login-gated; v2 adds broker API |
| **Sector heat map** | Discovery | v1 | `/` — public, no login; the wedge |
| **Ideas feed** | Engagement | **v1 (new)** | `/ideas` — daily algo-surfaced "rising star" / "deteriorating quality" alerts across the universe; distinct from weekly delta feed (daily cadence, threshold-triggered, themed by signal type) |
| **Backtest lite** | Trust builder | v2 | Needs 12+ months of score history; "Validates the model to skeptics" framing |

---

## 2. Non-negotiables (hard launch constraints)

| | Constraint |
|---|---|
| 1 | **Data freshness** — scores update at minimum weekly; ideally daily post-close |
| 2 | **Sector-relative framing** — every score displayed with its cluster context; no orphan absolute numbers |
| 3 | **Score explainability** — every composite score must drill down to its pillar scores; every pillar to underlying metrics. No black boxes. |
| 4 | **Mobile readability** — core stock page + watchlist must work at 390px |
| 5 | **Speed** — stock page <2s; screener results <3s |
| 6 | **No paywall on discovery** — sector heat map + basic stock scores free without login. Gate depth (narrative engine, X-ray, alerts) behind signup. |
| 7 | **NSE universe completeness** — all 2,163 actively traded NSE stocks, not just Nifty 500. The long tail is the differentiation. |

---

## 3. Data foundation

### `golden_db` — read-only source (never modified)

Connection: `postgresql://golden_reader_user:golden_read_2026@127.0.0.1:5432/golden_db`

| Schema | Key tables | Purpose |
|---|---|---|
| `golden` | `stocks` (7,182 rows; 2,163 NSE active), `price_history` (21M rows, partitioned by interval; 1d/1wk/1mo/3mo OHLCV from yfinance, 2019-04-29 → present), `index_constituents`, `delivery_data` | Universe + price data |
| `indicators` | `daily_signals` (7.2M rows; 100+ technical indicators including EMAs, ADX, Supertrend, RSI, MACD, BB, ATR, OBV, MFI, pivots, CPR, fib, 52w breakouts, candlestick + chart pattern detection, plus legacy `bull_score`/`bear_score`/`net_score`) | Technical indicators |
| `backtest`, `paper` | infra tables | Out of scope for v1 |

**Important:** the legacy `net_score` is technicals-only. We are building a new fundamentals-aware
scoring engine from scratch. The legacy score is not used.

### `fundamental_app` — our writable DB

Connection: `postgresql://fundamental_app:<see .env.local>@127.0.0.1:5432/fundamental_app`

All app tables under `app.` schema. Migrations in `db/migrations/`.

| Table | Purpose | Approx rows |
|---|---|---|
| `app.universe` | NSE active stocks (synced from golden) + maturity_tier + years_of_data | 2,163 |
| `app.cluster` | 41 peer clusters | 41 + unclassified |
| `app.meta_cluster` | 8 meta-clusters (heat-map level) | 9 |
| `app.cluster_assignment` | symbol → cluster_id | 2,163 |
| `app.screener_meta` | Per-stock scrape state + current_price/market_cap | 2,163 |
| `app.screener_export_raw` | Versioned xlsx blobs (for re-parse) | 2,162 |
| `app.fundamentals_annual` | 10y annual P&L/BS/CF per stock | 17,848 |
| `app.fundamentals_quarterly` | 10q quarterly results per stock | 20,037 |
| `app.metrics_snapshot` | Computed metrics per stock per snapshot | 2,151/snapshot |
| `app.scores` | Pillar + composite percentiles + per-component sub-percentiles (JSONB); APPEND-ONLY (the moat) | 2,151/snapshot |
| `app.scores_latest` | View — most recent score per symbol | — |

### Screener.in (paid subscription) — fundamentals source

Cookies stored in `.env.local` (gitignored). Two-step scrape per ticker:
1. GET `/company/{TICKER}/consolidated/` (fall back to `/company/{TICKER}/` for standalone-only) → parse `export_id` + CSRF token
2. POST `/user/company/export/{export_id}/` → returns xlsx with **Data Sheet** tab containing 10y P&L, 10y BS, 10y CF, 10q quarterly results, annual close prices

Throttle ~2 s/stock. Full backfill: ~1h45m. Idempotent — re-runs skip stocks scraped <20h ago.

### Future external feeds (Phase 3)

For the narrative engine + bank-specific scoring (NIM, NPA, CASA), planned sources:
- BSE/NSE filings RSS
- Concall transcripts (Researchbytes / Trendlyne / company IR)
- Quarterly disclosures (XBRL parsing)

---

## 4. Sector cluster taxonomy

**[Full doc: docs/sector-clusters.md](sector-clusters.md)**

41 peer clusters under 8 meta-clusters. Mapping is rule-based from `(sector, industry, market_cap_category)`
+ a hardcoded PSU bank list. All 2,163 stocks are classified (0 unclassified).

### Meta-clusters and their cluster counts

| Meta-cluster | Clusters | Notable splits |
|---|---|---|
| **Financials** | 6 | PSU banks vs Pvt banks (different cost-of-funds, growth profiles); NBFCs separate; Insurance separate; Capital Markets/AMCs/Brokers separate; Fintech separate |
| **Tech** | 4 | IT Services Large vs Mid/Small (client concentration, deal mix differ); IT Hardware separate; Telecom separate |
| **Healthcare** | 3 | Pharma; Hospitals & Diagnostics; MedTech |
| **Consumer** | 8 | FMCG split into Food/Agri, Personal Care, Beverages, Diversified (incl. tobacco); Consumer Durables; Retail; Leisure & Hospitality; Media |
| **Industrials** | 7 | Cap Goods Industrial / Electrical / Defense & Aero split; Auto OEM vs Components; Commercial Services; Transport & Logistics |
| **Materials** | 7 | Specialty Chemicals vs Agrochemicals; Ferrous vs Non-Ferrous Metals; Cement; Paper; Textiles |
| **Real Estate & Infra** | 2 | Realty Developers; Construction & EPC |
| **Energy & Utilities** | 3 | Oil & Refining; Gas Distribution; Power |
| **Diversified** | 1 | Conglomerates |

### Why this granularity

A cluster must group businesses with **comparable economics** (so percentile ranks are
meaningful) AND have ≥10 peers per cluster (for stable percentiles). PSU vs private banks have
wildly different return profiles, capital structures, regulation — splitting is essential.

---

## 5. Scoring engine

**[Full mechanics: docs/scoring-engine.md](scoring-engine.md)**
**[Per-cluster scorecards: docs/scorecards.md](scorecards.md)**

### Three pillars

| Pillar | What it measures |
|---|---|
| **Quality** | Long-term operational durability — does this business compound? |
| **Valuation** | Are we paying a fair price for what we're getting? |
| **Momentum** | Is the market currently endorsing the thesis? (price + earnings momentum combined) |

Pillar weights vary by cluster — from 35/30/35 (cement, oil refining, realty — momentum-heavy
cyclicals) to 55/25/20 (insurance — pure compounder).

### Maturity tiers — apples-to-apples comparison

Every stock is bucketed by years of annual fundamentals available:

| Tier | Years of data | Display label | Population (current) | Scorecard character |
|---|---|---|---|---|
| `veteran` | ≥10 | "Long-term Compounder" | **1,337** (62%) | Adds 7y + 10y CAGR & 10y consistency metrics; rewards true durability with 2 killer features (`roe_avg_above_threshold_10y`, `np_growth_above_inflation_10y`) |
| `mature` | 7–9 | "Established" | 299 (14%) | Full 5y CAGR + 3y averages + 5y trends |
| `mid` | 3–6 | "Emerging" | 418 (19%) | 3y averages + YoY trends; no 5y CAGR |
| `new` | 1–2 | "New Listing" | 97 (4.5%) | Latest year + YoY only; momentum-tilted |
| insufficient | <1 | not scored | 12 | excluded |

**Peer group for percentile = (cluster, tier).** True apples-to-apples.

Tier-variant generation is **mechanical**: each cluster's Mature scorecard is the source of
truth; Veteran/Mid/New variants are programmatically derived using documented substitution rules.

### Per-cluster scorecards — the differentiation

Each cluster has its own scorecard reflecting what an analyst in that space actually tracks.
Examples:

- **Banks** score on RoA, RoE, book value CAGR, loan-book growth proxy, equity-to-assets — drop
  debt/equity (banks levered by design), drop CFO/PAT (not meaningful)
- **FMCG** scores on RoCE, gross margin trend, working capital cycle, cash conversion (CFO/PAT)
- **IT Services** scores on EBIT margin trend, cash conversion (CFO/EBITDA), DSO trend, ROCE
- **Cement** scores on EBITDA margin, RoCE, net debt/EBITDA, asset turnover (capacity utilization
  proxy), capex intensity
- **Construction/EPC** scores on working capital cycle (very heavy weight — defines viability),
  debt/equity (inverted), CFO/Sales

Per-cluster **valuation fallbacks for loss-makers** (`pe_ttm` null) are pre-defined: banks fall
to P/B; NBFCs to P/AUM proxy; insurance to P/Premium; industrials to 60% EV/Sales + 40% P/B;
asset-light services to EV/Sales; etc.

### Score composition

```
For each metric in the cluster's scorecard (tier-variant):
  → percentile rank within (cluster_id, maturity_tier) bucket
  → direction-aware (lower-is-better metrics inverted)

For each pillar:
  → weighted blend of component percentiles, renormalized over non-null components

Composite:
  → weighted blend of pillar scores using cluster-specific pillar weights
  → re-percentile within (cluster, tier) bucket → composite_pct (0-100)
```

### Fallback for thin buckets

When a `(cluster, tier)` bucket has <10 peers (small clusters, new tiers), percentile is computed against:
1. `(cluster, all-tiers)` first — keeps comparison within same business type
2. `(meta_cluster, tier)` second — same maturity, broader peer set

Score row is flagged with `score_status='partial-cluster-mixed-tiers'` or `'partial-meta-cluster'`.

### Score history archive (the moat)

Every Sunday compute → INSERT new row into `app.scores`. Never overwrite. After 12 months we have
a complete weekly history per stock; this powers:
- 12-month sparklines on stock pages
- "Score delta feed" (top movers this week)
- Backtest-lite (decile vs forward returns) in v2

Competitors cannot retroactively generate this archive.

---

## 5a. Moat — what compounds over time

Four compounding advantages that get harder to replicate the longer the platform runs.
Competitors face an irrecoverable time-to-parity gap on each.

| Moat | How it compounds | Why competitors can't catch up |
|---|---|---|
| **Score history archive** | Weekly snapshots of every stock's composite + pillar + component scores. After 12 months: full year of weekly history per stock × 2,163 stocks ≈ 110k rows. After 36 months: 330k. | Competitors cannot retroactively generate this data. Backtesting (decile vs forward returns), drift detection, and trend visualization become exclusive features. |
| **User behavioural signals** | Watchlists, screens run, and stock-page views feed a community-interest signal layer. "Trending in BFSI", "Most-watched microcap defense play", etc. | Proprietary demand-side dataset; powers a social layer no new entrant can replicate. Strengthens daily-return habit loop. |
| **Narrative engine tuning** | AI-generated stock notes improve as Claude is fine-tuned on analyst feedback (👍/👎), edits, and usage patterns. Concall transcript ingestion (Phase 3) deepens context. | Generic LLM prompts can't match a domain-tuned model with feedback history. Defensible quality gap on the most-shared surface (narratives). |
| **Cluster taxonomy refinement** | The 41 peer clusters + per-cluster scorecards evolve as edge cases surface. Sector-specific metric substitutions (already in place) get richer over time. | Screener and Tickertape use static raw NSE sectors (22 buckets). A dynamic, audit-trailed cluster taxonomy with editable scorecards becomes a research product in itself. |

### 5b. Editable scorecards (architecture)

Per the user's instruction, scorecards must be **editable**, not hardcoded forever. Two-tier
design:

| Tier | Who edits | When | Storage |
|---|---|---|---|
| **Platform defaults** | Admin (us) — tunes weights as we learn | Continuous; takes effect on next scoring run | DB table `app.cluster_scorecard` (one row per cluster; weights stored as JSONB; versioned with `effective_from` timestamp). Python config in `scorecards.py` becomes the seed; loader reads DB at scoring time. |
| **User overrides** | Logged-in users — value-tilt, growth-tilt, "Buffett-style", "Lynch-style" presets | v2 feature when auth is wired | DB table `app.user_scorecard_override`; user picks a base cluster scorecard, drags weight sliders, saves a named preset. Composite is recomputed on-demand from the per-component sub-percentiles already in `app.scores.{quality,valuation,momentum}_components` (cheap — no re-ranking needed). |

**Why this is cheap:** the heavy work (computing each component's percentile within
`(cluster, tier)`) is already snapshot-stable. Custom weights only change how we **blend** those
sub-percentiles into pillar + composite scores. Per-user composite recompute is a linear blend
on data we already have. No re-ranking required.

**v1 scope for editable scorecards:** ship admin-editable (DB-backed) scorecards. Build a simple
admin UI later. User overrides deferred to v2 alongside login.

---

## 6. v1 scope (from product doc)

| Feature | v1? | Notes |
|---|---|---|
| Stock page with composite + pillar scores | ✓ | Cluster radar chart + percentile badge included |
| Sector heat map (public, no login) | ✓ | Primary acquisition wedge. Weekly refresh. |
| Basic screener — filter by pillar score + cluster | ✓ | Replaces Screener.in for score-based filtering |
| AI narrative engine (3-sentence stock story) | ✓ | Key differentiator — must launch with it |
| Watchlist with score-ranked sorting | ✓ | Login required; max 3 watchlists in free tier |
| Score delta feed (weekly movers) | ✓ | Home page feed; drives daily/weekly return visits |
| Portfolio X-Ray | partial | Manual holding input in v1; broker API in v2 |
| Score history sparklines (12 months) | ✓ | Archive building starts on launch day |
| Pillar-level score alerts | partial | Email only in v1; push in v2 |
| Backtest-lite (score decile vs returns) | v2 | Needs 12+ months of score history |
| Broker integration (Zerodha, Groww) | v2 | Complex; post-PMF priority |
| API / data export | v2 | Monetization layer |
| Mobile app (iOS/Android) | v3 | Mobile-responsive web sufficient for v1 |
| **Editable scorecards (admin)** | ✓ v1 | DB-backed weights; admin can tweak any cluster's scorecard without code change. Re-scores on next run. |
| **Editable scorecards (user-customizable)** | v2 | Save named presets ("Buffett-style", "Growth investor"); composite recomputed on-demand. Needs auth. |
| **5-axis cluster radar** (cluster-aware roll-up) | ✓ v1 | Stock-page hero visual. 5 standardized axes (Profitability / Growth / Cash & BS / Valuation / Momentum). Cluster median overlay. |
| **SHAP-style feature waterfall** (per source-doc §9) | ✓ v1 | Stock page — decomposes composite into per-component positive/negative contributions; uses sub-percentiles already stored in `app.scores.*_components` |
| **Cluster leaders leaderboard** (per source-doc §9) | ✓ v1 | `/cluster/[id]/leaders` — top stocks per cluster, multiple lenses (Quality / Valuation / Momentum / Composite) |
| **Ideas feed** — daily algo-surfaced rising star / deteriorating quality (per source-doc §10) | ✓ v1 | `/ideas` — distinct from weekly delta feed: daily, threshold-triggered, themed (e.g. "Quality up >10pct in 4 weeks"; "Momentum collapsed below median") |
| **Score-weighted filters in screener** (per source-doc §10) | ✓ v1 | Screener default ranks results by user-selectable score blend, not just gates them |

---

## 7. Web app + design system

**[Full architecture doc: docs/architecture.md](architecture.md)**

### Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript | RSC for fast initial paint; route handlers for API |
| Styling | Tailwind CSS + shadcn/ui (Radix primitives) | Accessible defaults; theme-controllable |
| Charts | Recharts (radar, line, sparkline) + custom SVG (heat map) | React 19 / RSC compatible |
| DB driver | postgres.js | Smallest, fastest; no ORM ceremony |
| LLM | Claude API (claude-sonnet-4-6 default) | Narrative engine, Phase 3 |

### Design system — "Claude" aesthetic

Goal: warm, editorial, calm. The opposite of every Bloomberg-clone fintech site.

| Token | Value | Usage |
|---|---|---|
| `paper` | `#faf9f5` | Page background |
| `ink` | `#191919` | Primary text |
| `muted` | `#5a584f` | Secondary text |
| `border` | `#e8e4d9` | Hairline dividers |
| `card` | `#ffffff` | Raised surfaces |
| `accent.400` | `#cc785c` | Primary accent (Claude tan-orange) |
| `accent.600` | `#a05a42` | Accent hover/pressed |
| `score.excellent` | `#3f7d4a` | Top quintile (muted forest green) |
| `score.good` | `#7ea874` | Above-median |
| `score.neutral` | `#c9b876` | Middle (warm sand) |
| `score.weak` | `#cc8a5c` | Below-median |
| `score.poor` | `#a8543c` | Bottom quintile (burnt sienna; not alarm red) |

**Typography:**
- Headings: serif — `Source Serif 4` (free Tiempos alternative); never bold; tracking `-0.015em`
- Body / UI: `Inter`, system-ui
- Numerics: tabular figures always (`font-feature-settings: 'tnum', 'cv11'`)

**Layout:**
- Page max-width 1200px; comfortable reading column 680px
- Section gaps 24/32/48px (generous)
- Cards 1px border, no shadow, 12px radius
- No icons-as-decoration; only when informational

### Page map (v1)

| Route | Auth | Purpose |
|---|---|---|
| `/` | public | **Sector heat map** — 41 cluster tiles colour-graded by avg composite_pct. Click → cluster detail. |
| `/cluster/[id]` | public | Cluster detail — table of stocks with their pillar scores, sortable |
| `/cluster/[id]/leaders` | public | **Cluster leaders leaderboard** — top stocks across multiple lenses (Quality / Valuation / Momentum / Composite); per source-doc §9 |
| `/stock/[symbol]` | public | **Stock page** — 5-axis cluster radar, percentile badges, **SHAP-style feature waterfall**, score history sparkline, fundamentals tables, narrative |
| `/screener` | public | Filter + **rank** by pillar score blend (score-weighted, not just gating) + cluster + tier + market cap |
| `/feed` | public | **Score delta feed** — biggest movers this week, ranked |
| `/ideas` | public | **Ideas feed** — daily algo-surfaced "rising star" + "deteriorating quality" themes |
| `/portfolio` | login | Portfolio X-Ray — paste holdings → cluster concentration + weak links + PNG export |
| `/watchlist` | login | Up to 3 watchlists in free tier; auto-sorted by score movement; pillar-level breakout alerts |
| `/admin/scorecards` | admin | Edit cluster scorecards (weights UI → `app.cluster_scorecard`) |
| `/about` | public | The methodology — full transparency on scoring |

---

## 8. Build sequence

| # | Step | Status |
|---|---|---|
| 1 | Backfill 2,163 stocks of fundamentals from Screener | ✅ Done (2,162/2,163 success) |
| 2 | Cluster taxonomy + assignment for all stocks | ✅ Done |
| 3 | Maturity tier classifier | ✅ Done |
| 4 | Formula library (50+ named formulas) | ✅ Done |
| 5 | Per-cluster scorecards + tier-variant generator (validated) | ✅ Done |
| 6 | Metrics computation engine (loads fundamentals + indicators + price + median NSE benchmark) | ✅ Done |
| 7 | Scorer (percentile + composite + 3-tier fallback) | ✅ Done |
| 8 | Validate scores manually against ~25 well-known stocks | ✅ Done |
| 9 | Migration 0005: DB-backed scorecards (`app.cluster_scorecard`) + loader refactor | ▶ Next |
| 10 | Scaffold Next.js app + Claude design system | ⬜ |
| 11 | Build sector heat map (the wedge) | ⬜ |
| 12 | Build stock page with **5-axis cluster radar** + percentile badges + **SHAP-style feature waterfall** + sub-component drill-down | ⬜ |
| 13 | Build cluster detail + **cluster leaders leaderboard** | ⬜ |
| 14 | Build screener with **score-weighted ranking** (not just filter-gating) | ⬜ |
| 15 | Build score delta feed (needs 2nd snapshot week) | ⬜ |
| 16 | Build **Ideas feed** (daily algo-surfaced rising star / deteriorating quality) — needs delta-tracking job | ⬜ |
| 17 | Build admin scorecard editor (weights UI → DB) | ⬜ |
| 18 | Wire Claude narratives + auto-generated analyst notes | ⬜ |
| 19 | Portfolio X-Ray + watchlist + alerts (login) | ⬜ |
| 20 | Polish + launch | ⬜ |

---

## 9. Current implementation status

**Latest scoring snapshot:** `2026-05-04` — 2,151 stocks scored, 145 (cluster × tier) buckets, 0 failures.

### Pipeline timings

| Job | Time |
|---|---|
| Full Screener backfill (2,163 stocks) | ~1h45m (one-time; incremental updates skip recent) |
| Cluster + maturity-tier assignment (full universe) | <1 second |
| Compute metrics (full universe) | ~4.5 minutes |
| Score (full universe across 145 buckets) | <1 second |

### Sample scores (sanity-checked against analyst intuition)

```
HDFCBANK     bfsi_pvt_banks       veteran  Q=27 V=64 M=89  composite=81  ✓ top quintile
BAJFINANCE   bfsi_nbfc            veteran  Q=29 V=74 M=42  composite=81  ✓ top quintile
MARUTI       auto_oem             veteran  Q=43 V=39 M=60  composite=81  ✓ auto leader
SUNPHARMA    pharma               veteran  Q=33 V=57 M=42  composite=80  ✓ pharma leader
TCS          it_services_large    veteran  Q=32 V=50 M=57  composite=67  ✓ reasonable
TITAN        consumer_durables    veteran  Q=47 V=83 M=14  composite=58  ✓ momentum-dragged
ULTRACEMCO   cement               veteran  Q=46 V=79 M=34  composite=56  ✓ cement cycle weak
NESTLEIND    fmcg_food_agri       mid      Q=41 V=89 M=31  composite=53  ✓ premium valuation hit
RELIANCE     oil_refining         veteran  Q=54 V=69 M=51  composite=26  ✓ refining margin pressure
IRFC         bfsi_nbfc            veteran  Q=62 V=67 M=69  composite=09  ✓ low growth PSU
```

### Code layout

```
Fundamental/
├── .env.local              gitignored — Screener cookies, DB URLs
├── .gitignore
├── db/
│   └── migrations/
│       ├── 0001_initial.sql            universe, screener_meta, fundamentals_*
│       ├── 0002_clusters_scores.sql    cluster taxonomy + scores tables
│       ├── 0003_seed_clusters.sql      9 meta + 41 + unclassified
│       └── 0004_extras.sql             maturity_tier columns + cluster_metrics JSONB
├── etl/
│   ├── pyproject.toml
│   └── src/fundamental_etl/
│       ├── config.py        pydantic-settings
│       ├── db.py            golden_conn, app_conn
│       ├── log.py           structlog
│       ├── cli.py           typer commands
│       ├── screener/
│       │   ├── scraper.py   2-step scrape (consolidated → standalone fallback)
│       │   ├── parser.py    xlsx Data Sheet → annual + quarterly dicts
│       │   └── persist.py   raw blob + parsed rows + meta state
│       ├── clusters/
│       │   ├── rules.py     ordered rule list (sector, industry → cluster_id)
│       │   └── assigner.py  apply rules + maturity tier to all stocks
│       └── scoring/
│           ├── formulas.py    50+ named formulas; @higher / @lower decorators
│           ├── scorecards.py  41 mature scorecards + tier-variant generator
│           ├── metrics.py     compute metrics_snapshot per stock (incl NSE-median benchmark)
│           └── scorer.py      percentile + composite + 3-tier fallback
└── docs/
    ├── REQUIREMENTS.md       this file (master spec)
    ├── architecture.md       stack + design system + page map
    ├── sector-clusters.md    cluster taxonomy
    ├── scoring-engine.md     pillar mechanics + history archive
    └── scorecards.md         per-cluster scorecards (mature) + tier-variant generation rules
```

### CLI commands (working)

```bash
# Bulk Screener fetch (idempotent; skips recently-scraped)
.venv/bin/python -m fundamental_etl.cli fetch-many

# Single stock fetch (testing)
.venv/bin/python -m fundamental_etl.cli fetch RELIANCE

# Assign clusters + maturity tiers across universe
.venv/bin/python -m fundamental_etl.cli assign-clusters

# Compute metrics_snapshot (defaults to today)
.venv/bin/python -m fundamental_etl.cli compute-metrics

# Run percentile + composite scorer for a snapshot date
.venv/bin/python -m fundamental_etl.cli score --snapshot 2026-05-04
```

### What's NOT yet built

| Feature | Estimated complexity |
|---|---|
| Next.js web app (any pages) | Phase 2 — starting now |
| **DB-backed scorecards** (migration 0005 + loader refactor) | Phase 2 — small; needed for admin-edit |
| **5-axis cluster radar component** (with cluster median overlay) | Phase 2 — first stock-page visual |
| **Sector heat map** (41 tiles, weekly-refresh, filterable by meta-cluster) | Phase 2 — the wedge |
| **Portfolio X-Ray** (paste holdings → cluster concentration donut + pillar heatmap + 3 weak links + PNG export) | Phase 2 — login flow + html-to-png |
| **Score delta feed** (weekly movers ranked) | Phase 2 — pure SQL once we have 2 snapshot weeks |
| **Score history sparkline** (12-mo composite trend) | Auto-builds from weekly snapshots; UI in Phase 2 |
| **Percentile badge** (embed-ready share card) | Phase 2 — Stock page header + standalone share endpoint |
| Bank-specific scoring (NIM, NPA, CASA) | Phase 3 — needs external feed |
| AI narrative engine | Phase 3 — Claude API + concall transcript ingestion |
| Watchlist + alerts (email) | Phase 2 — auth needed |
| User-customizable scorecard presets | v2 — needs auth |
| Backtest-lite | v2 — needs 12 months of score history first |

### Open design questions to revisit during web-app build

1. **Small-cap bias in percentiles** — Ujjivan SFB outranks HDFCBANK because Ujjivan grows
   faster on every CAGR metric. Mathematically correct but conflicts with user intuition that
   "blue chips should rank highest". Mitigations to consider:
   - Sub-cluster by market_cap_category within cluster (large-cap leaders ranked separately)
   - Add a "stability" pillar that explicitly rewards low-CV / low drawdown
2. **Quality scores look low for blue-chips** in the current run — at the meta level the engine is
   working, but veteran-tier scoring could lean harder on the threshold metrics
   (`roe_above_15_10y`, `np_growth_above_inflation_10y`) to elevate true compounders
3. **Cluster-tier matrix is sparse for some clusters** (e.g. it_services_large veteran = 5 stocks).
   Current 3-tier fallback handles this but produces "partial-meta-cluster" tags. Consider manual
   cluster mergers for chronically thin buckets

These are refinements, not blockers — the engine is producing defensible scores end-to-end.

---

## 10. Memory persistence

Project context is saved across Claude Code sessions in:
- `~/.claude/projects/-Users-debasissahoo-Documents-Fundamental/memory/MEMORY.md` (index)
- `~/.claude/projects/-Users-debasissahoo-Documents-Fundamental/memory/project_nse_platform.md`
- `~/.claude/projects/-Users-debasissahoo-Documents-Fundamental/memory/reference_data_sources.md`
