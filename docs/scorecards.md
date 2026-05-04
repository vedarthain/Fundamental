# Per-Cluster Scorecards (v1)

The single source of truth for **how each of the 41 peer clusters is scored**. Pillar weights vary
by cluster archetype; components inside each pillar are chosen for what an analyst in that space
actually tracks.

Companion docs:
- [sector-clusters.md](sector-clusters.md) — cluster taxonomy
- [scoring-engine.md](scoring-engine.md) — engine mechanics, percentile math, history archive

---

## Shared definitions

### Symbols (from `app.fundamentals_annual` unless noted)

```
sales, op, opex, oi, dep, intr, pbt, tax, np, div                      ← P&L
esc, res, borr, ol, ta=tl, nb, cwip, inv_assets, oa, recv, inv_stk,
   cash, eqs                                                            ← BS
cfo, cfi, cff, ncf                                                       ← CF
acp                                                                      ← annual close price
mc                                                                       ← market cap (current price × current shares)
```

`_3y` = trailing 3 fiscal years; `_5y` = 5; `TTM` = sum of last 4 quarters from `app.fundamentals_quarterly`.

### Maturity tiers

Every stock is tagged with a **maturity tier** based on years of annual fundamentals available
(derived per scoring run from `COUNT(DISTINCT period_end)` in `app.fundamentals_annual`).
Stocks auto-promote as they accumulate history.

| Tier | Years of annual data | Display label | Scorecard variant character |
|---|---|---|---|
| `veteran` | ≥10 | "Long-term Compounder" | Adds 7y + 10y CAGR & consistency metrics; rewards true durability |
| `mature` | 7–9 | "Established" | Full 5y CAGR + 3y averages + 5y trends |
| `mid` | 3–6 | "Emerging" | 3y averages + YoY trends; no 5y CAGR |
| `new` | 1–2 | "New Listing" | Latest year + YoY only; momentum-tilted |
| `insufficient` | <1 | not scored | Excluded with `score_status='insufficient_data'` |

**Peer group for percentile ranking = (cluster_id, maturity_tier)** — apples-to-apples.

Fallback rules when a (cluster × tier) bucket has too few peers for stable percentiles:
1. If <10 peers in (cluster × tier) → percentile against (meta_cluster × tier); flag `score_status='partial-meta-cluster'`
2. If still <10 peers → percentile against (cluster × adjacent tier band) — for veteran/mature collapse together; for mid/new collapse together; flag `score_status='partial-tier-collapsed'`

### Universal formulas (used wherever a cluster references them)

| ID | Formula | Range / handling |
|---|---|---|
| `roe_3y` | mean( np / (esc + res) ) | invalid if equity ≤ 0 |
| `roa_3y` | mean( np / ta ) | bank-friendly |
| `roce_3y` | mean( (pbt + intr) / (esc + res + borr) ) | |
| `op_margin_3y` | mean( op / sales ) | |
| `op_margin_trend` | OLS slope of yearly (op/sales) over 5y | sign + magnitude |
| `gross_margin_3y` | mean( (sales − raw_material_cost − change_in_inventory) / sales ) | requires RM row in export |
| `gross_margin_trend` | OLS slope of yearly gross margin over 5y | |
| `ebitda_margin_3y` | mean( (op + dep) / sales ) | |
| `rev_cagr_3y` | (sales_T / sales_T-3)^(1/3) − 1 | mid-tier metric |
| `rev_cagr_5y` | (sales_T / sales_T-5)^(1/5) − 1 | mature-tier metric |
| `rev_cagr_7y` | (sales_T / sales_T-7)^(1/7) − 1 | mature/veteran metric |
| `rev_cagr_10y` | (sales_T / sales_T-10)^(1/10) − 1 | veteran-only metric |
| `np_cagr_3y` / `np_cagr_5y` / `np_cagr_7y` / `np_cagr_10y` | analogous on np; require np_T-window > 0 | |
| `np_yoy_latest` | (np_T − np_T-1) / abs(np_T-1) | new-tier fallback |
| `rev_yoy_latest` | analogous | new-tier fallback |
| `np_consistency_5y` | (years np > 0 in last 5)/5 + 1/(1 + CV(np_5y)) | mature/mid metric |
| `np_consistency_7y` | analogous over 7y | mature metric (richer) |
| `np_consistency_10y` | analogous over 10y | veteran-only |
| `book_value_cagr_5y` / `_7y` / `_10y` | ((esc+res)_T / (esc+res)_T-window)^(1/window) − 1 | banks especially benefit from 10y |
| `roe_5y` / `roce_5y` | mean over 5y instead of 3y | mature/veteran — smoother |
| `op_margin_5y` / `gross_margin_5y` | mean over 5y | mature/veteran — smoother |
| `op_margin_trend_5y` / `_7y` | OLS slope of yearly margin over 5/7y | longer windows show secular improvement |
| `roe_avg_above_threshold_5y` | share of last 5y where ROE > 15% | "consistently high" durability |
| `roe_avg_above_threshold_10y` | share of last 10y where ROE > 15% | veteran killer feature |
| `np_growth_above_inflation_10y` | share of last 10y where np grew > 6% | true real-growth compounders |
| `loan_book_cagr_3y` | (oa_T / oa_T-3)^(1/3) − 1 | proxy for advances on banks |
| `debt_equity` | borr / (esc + res) | inverted percentile |
| `net_debt_ebitda` | (borr − cash) / (op + dep) TTM | inverted; null if negative EBITDA |
| `equity_to_assets` | (esc + res) / ta | bank capital adequacy proxy |
| `interest_coverage` | (pbt + intr) / intr | capped 50; null if intr ≤ 0 |
| `cfo_pat_3y` | mean( cfo / np ) clipped to [0, 3] | requires np > 0 |
| `cfo_ebitda_3y` | mean( cfo / (op + dep) ) clipped to [0, 2] | |
| `cfo_sales_3y` | mean( cfo / sales ) | |
| `wc_days` | (recv + inv_stk − ol_proxy) × 365 / sales | use ol as payables proxy; report inverted |
| `dso` | recv × 365 / sales | inverted |
| `inv_days` | inv_stk × 365 / sales | inverted |
| `asset_turnover` | sales / ta | proxy for capacity utilization |
| `capex_intensity_3y` | mean( (Δnb + Δcwip) / sales ) | inverted (lower is better in mature cos) |
| `pe_ttm` | mc / TTM_np | inverted; null if TTM_np ≤ 0 |
| `pb` | mc / (esc + res) | inverted |
| `ev_ebitda_ttm` | (mc + borr − cash) / TTM_(op+dep) | inverted; null if EBITDA ≤ 0 |
| `peg` | pe_ttm / (np_cagr_5y × 100) | inverted; require np_cagr_5y > 0 |
| `fcf_yield` | (cfo_3y_avg − capex_3y_avg) / mc | as-is (higher better) |
| `div_yield` | (latest_div / mc) | as-is |
| `earnings_yield_trend` | OLS slope of (np / mc_at_year_end) over 5y | sign |

### Per-cluster valuation fallbacks (loss-makers / negative metrics)

When `pe_ttm` is null (loss-making) or `pb` is null (negative book), the cluster's fallback metric
takes its place at the original weight. This preserves the valuation pillar's weight without
artificial renormalization. Pre-determined per cluster:

| Cluster | Primary missing | Fallback metric | Formula |
|---|---|---|---|
| bfsi_psu_banks, bfsi_pvt_banks | pe_ttm | `pb` (raise to 60% of valuation) | mc / (esc+res); for negative book see notes |
| bfsi_nbfc | pe_ttm | `p_aum` proxy = mc / oa | oa is loan-book proxy |
| bfsi_insurance | pe_ttm | `p_premium` = mc / sales_TTM | premium = sales for insurers |
| bfsi_capmarkets, bfsi_fintech | pe_ttm | `ev_sales_ttm` = (mc + borr − cash)/sales_TTM | |
| it_services_*, it_hardware | pe_ttm | `ev_sales_ttm` | |
| telecom | pe_ttm | `ev_sales_ttm` | EV/EBITDA already primary; secondary fallback |
| pharma, health_services, medtech | pe_ttm | `ev_sales_ttm` | |
| fmcg_* | pe_ttm | `ev_sales_ttm` | |
| consumer_durables, retail | pe_ttm | `ev_sales_ttm` | |
| leisure_hospitality | pe_ttm | `ev_sales_ttm` | |
| media_entertainment | pe_ttm | `ev_sales_ttm` | |
| cap_goods_*, defense_aero | pe_ttm | `ev_sales_ttm` + `pb` (50/50 weight split) | order-book-aware proxy |
| auto_oem, auto_components | pe_ttm | `ev_sales_ttm` | |
| services_commercial, transport_logistics | pe_ttm | `ev_sales_ttm` | |
| chemicals_specialty, chemicals_agro | pe_ttm | `ev_sales_ttm` | |
| metals_*, paper_forest, textiles | pe_ttm | `ev_sales_ttm` + `pb` (60/40) | tangible-asset replacement value |
| cement | pe_ttm | `ev_sales_ttm` | EV/tonne placeholder for v2 |
| realty | pe_ttm | `pb` (raise to 50% of val) | NAV/book the right lens |
| construction | pe_ttm | `ev_sales_ttm` + `pb` (60/40) | |
| oil_refining, gas_distribution, power | pe_ttm | `ev_sales_ttm` | |
| diversified | pe_ttm | `ev_sales_ttm` | |

For **negative book value** (rare; usually buyback-driven like ITC subsidiaries): drop `pb`,
use `pe_ttm` only at full pillar weight, flag `score_status='partial-balance-sheet'`.

For **double-trouble** (loss-making AND negative book): valuation pillar reduced to `ev_sales_ttm`
+ `div_yield` + `earnings_yield_trend` (latter often null too); flag `score_status='partial-valuation'`.

### Universal Momentum scorecard

Used unchanged unless a cluster overrides:

| Component | Formula | Default weight |
|---|---|---|
| `ret_12m_rel` | 12M return − Nifty 12M return | 20% |
| `ret_6m_rel` | 6M return − Nifty 6M return | 15% |
| `ret_3m_rel` | 3M return − Nifty 3M return | 10% |
| `pct_above_200ema_252d` | share of last 252 sessions where `above_200ema` true | 10% |
| `ema_stack_bull` | latest `ema_stack` (binary → 0 or 100) | 5% |
| `tech_net_score_scaled` | min-max of `net_score` to 0-100 (computed cluster-wide) | 5% |
| `sales_yoy_q` | (latest_q sales − YoY q sales)/abs(YoY q sales) | 17.5% |
| `np_yoy_q` | (latest_q np − YoY q np)/abs(YoY q np) | 17.5% |

Pillar weight notation: **Q/V/M** = Quality / Valuation / Momentum.

---

### Tier-variant generation rules

Each cluster section below specifies the **Mature** tier scorecard (the base case). The other
three tiers are derived from it by these mechanical rules — no need to write 4 variants per
cluster manually.

**Veteran (≥10y data)** = Mature scorecard PLUS:
- Replace `np_consistency_5y` → `np_consistency_10y` (same weight)
- Replace `book_value_cagr_5y` → `book_value_cagr_10y` (same weight)
- Replace `op_margin_trend` (5y) → `op_margin_trend_7y` (same weight)
- Add **two new Quality components** (each at 5%, taken from existing components proportionally):
  - `roe_avg_above_threshold_10y` (5%) — share of last 10y where ROE > 15%
  - `np_growth_above_inflation_10y` (5%) — share of last 10y where np grew > 6%
- Pillar weights: shift +5% to Quality, −5% from Momentum (long-term compounders deserve it)

**Mid (3–6y data)** = Mature scorecard with these substitutions:
- `*_cagr_5y` → `*_cagr_3y` everywhere (same weights)
- `np_consistency_5y` → `np_consistency_3y` (using available years; same weight)
- `op_margin_trend` (5y) → `op_margin_trend_3y` (3y slope; same weight)
- `book_value_cagr_5y` → `book_value_cagr_3y` (same weight)
- Pillar weights: shift +5% from Quality, −5% to Momentum (less history = lean on price action more)

**New (1–2y data)** = Mature scorecard rewritten:
- All `*_cagr_*` and `*_consistency_*` and trend metrics dropped
- `roe_3y`/`roce_3y`/`op_margin_3y`/`gross_margin_3y` → `roe_latest`/`roce_latest`/`op_margin_latest`/`gross_margin_latest` (same weights)
- `cfo_pat_3y` → `cfo_pat_latest` (same weight)
- Quality components freed up by dropping CAGR/trend/consistency (typically ~30-40% weight) is redistributed:
  - +50% to remaining Quality components proportionally
  - +50% goes to Momentum pillar (price action is most of what we know about a new IPO)
- Pillar weights: −15% from Quality, +15% to Momentum vs Mature (so e.g. FMCG New becomes Q35/V30/M35 from Q50/V30/M20)

This is **deterministic** — implementation reads the Mature scorecard config and generates the other 3 tier variants programmatically. Easy to audit, easy to change.

### Worked example — `fmcg_food_agri` across all 4 tiers

| Component | Veteran | Mature | Mid | New |
|---|---|---|---|---|
| **Pillar weights** | Q 55 / V 30 / M 15 | Q 50 / V 30 / M 20 | Q 45 / V 30 / M 25 | Q 35 / V 30 / M 35 |
| roce_3y / roce_latest | 18% (3y) | 18% (3y) | 18% (3y) | 26% (latest) |
| gross_margin_3y / gross_margin_latest | 14% | 14% | 14% | 20% |
| op_margin_3y / op_margin_latest | 10% | 10% | 10% | 14% |
| wc_days | 10% | 10% | 10% | 14% |
| cfo_pat_3y / cfo_pat_latest | 10% | 10% | 10% | 14% |
| debt_equity | 4% | 4% | 4% | 6% |
| op_margin_trend_5y/_7y | 8% (7y) | 8% (5y) | 8% (3y) | — |
| rev_cagr_5y / 3y | 10% (becomes _10y, weight 5%; +new threshold metrics 5%) | 10% (5y) | 10% (3y) | — |
| np_cagr_5y / 3y | 10% (becomes _10y, weight 5%; +new threshold metrics 5%) | 10% (5y) | 10% (3y) | — |
| np_consistency_*y | 6% (10y) | 6% (5y) | 6% (3y) | — |
| roe_above_15_10y | 5% | — | — | — |
| np_growth_above_6_10y | 5% | — | — | — |

The Veteran scorecard is **strictly richer** than Mature for the same business — and a 10-year
compounder like Nestle India will score higher on Veteran metrics than someone passing the
shorter windows but failing the long ones.

## Cluster archetypes (groups of clusters that share scorecards)

Rather than copy-paste 41 near-identical tables, scorecards are organized by **archetype**. The
table at the start of each archetype lists the clusters it covers; deltas for individual clusters
are listed inline.

---

## A. Lender clusters — banks, NBFCs, capital markets, insurance, fintech

Scoring lenders requires fundamentally different inputs because:
- Their "Sales" = interest earned, so margin metrics are non-comparable to industrials
- They are levered by design — debt/equity is meaningless
- Asset quality (NPA) and net interest margin (NIM) are central but not in the Screener export
- For v1 we score on **return on assets, return on equity, book value compounding, loan-book growth,
  capital cushion proxy, and consistency** — meaningfully useful even without NPA/NIM

### A1. `bfsi_pvt_banks` — Private Banks
**Pillar weights: Q 50 / V 30 / M 20** (banks are compounding stories — quality dominates)

| Pillar | Component | Weight | Notes |
|---|---|---|---|
| Q | `roa_3y` | 25% | Single most important bank metric |
| Q | `roe_3y` | 18% | |
| Q | `book_value_cagr_5y` | 18% | The compounding engine |
| Q | `loan_book_cagr_3y` | 14% | Top-line growth |
| Q | `np_cagr_5y` | 12% | |
| Q | `np_consistency` | 8% | Cycle resilience |
| Q | `equity_to_assets` (3y avg) | 5% | Capital cushion proxy (CAR substitute) |
| V | `pb` | 50% | Banks trade on P/B |
| V | `pe_ttm` | 25% | |
| V | `earnings_yield_trend` | 15% | Re-rating direction |
| V | `div_yield` | 10% | |
| M | universal momentum, with `np_yoy_q` upweighted to 25%, `sales_yoy_q` to 12.5% | — | NII growth = sales |
| **DROPPED** | debt_equity, net_debt_ebitda, interest_coverage, cfo_pat_3y, cfo_ebitda_3y, fcf_yield, ev_ebitda_ttm | — | Non-meaningful for banks |

### A2. `bfsi_psu_banks` — PSU Banks
Same scorecard as A1 with these deltas:
- `roa_3y` weight 30% (PSUs differentiate sharply on RoA), `roe_3y` 15%, `book_value_cagr_5y` 15%
- `div_yield` weight in V raised to 20% (PSU banks pay generously); `pb` 45%
- All else identical

### A3. `bfsi_nbfc` — NBFCs / Lenders
**Pillar weights: Q 50 / V 25 / M 25**

| Pillar | Component | Weight |
|---|---|---|
| Q | `roa_3y` | 22% |
| Q | `roe_3y` | 18% |
| Q | `loan_book_cagr_3y` | 18% |
| Q | `book_value_cagr_5y` | 14% |
| Q | `np_cagr_5y` | 12% |
| Q | `np_consistency` | 8% |
| Q | `equity_to_assets` | 8% |
| V | `pb` | 45%, `pe_ttm` 30%, `earnings_yield_trend` 15%, `div_yield` 10% |
| M | universal | — |
| **DROPPED** | same as A1 | |

### A4. `bfsi_insurance` — Insurance
**Pillar weights: Q 55 / V 25 / M 20**

| Pillar | Component | Weight | Notes |
|---|---|---|---|
| Q | `roe_3y` | 25% | Insurance ROE is the headline metric |
| Q | `book_value_cagr_5y` | 25% | Embedded value proxy |
| Q | `np_cagr_5y` | 20% | |
| Q | `rev_cagr_5y` (= premium growth) | 15% | |
| Q | `np_consistency` | 10% | |
| Q | `equity_to_assets` | 5% | Solvency proxy |
| V | `pb` | 60% (book / EV-driven), `pe_ttm` 25%, `div_yield` 15% | |
| M | universal | — |
| **DROPPED** | same as A1 + capex_intensity, asset_turnover | |

### A5. `bfsi_capmarkets` — Capital Markets, Brokers, AMCs
**Pillar weights: Q 45 / V 30 / M 25**

| Pillar | Component | Weight | Notes |
|---|---|---|---|
| Q | `roe_3y` | 20% | Asset-light high-RoE businesses |
| Q | `roce_3y` | 18% | |
| Q | `op_margin_3y` | 15% | Operating leverage on brokerage/AUM |
| Q | `op_margin_trend` | 10% | |
| Q | `np_cagr_5y` | 15% | |
| Q | `cfo_pat_3y` | 12% | Real earnings (vs accruals) |
| Q | `np_consistency` | 10% | |
| V | `pe_ttm` | 35%, `pb` 20%, `earnings_yield_trend` 15%, `div_yield` 10%, `fcf_yield` 20% | |
| M | universal | — |
| **DROPPED** | debt_equity, net_debt_ebitda, ev_ebitda_ttm | |

### A6. `bfsi_fintech` — Fintech
Same as A5 (capmarkets) except `np_consistency` dropped (most are recent-IPO loss-makers); replaced with `rev_cagr_5y` 12%. `score_status='partial'` flagged for any without 3 profitable years.

---

## B. Asset-light services — IT, telecom

### B1. `it_services_large` — IT Services Large Cap
**Pillar weights: Q 45 / V 30 / M 25**

| Pillar | Component | Weight |
|---|---|---|
| Q | `op_margin_3y` (= EBIT margin proxy) | 22% |
| Q | `op_margin_trend` | 12% |
| Q | `roce_3y` | 18% |
| Q | `cfo_ebitda_3y` | 14% |
| Q | `dso` (inverted) | 8% |
| Q | `rev_cagr_5y` | 12% |
| Q | `np_cagr_5y` | 8% |
| Q | `np_consistency` | 6% |
| V | `pe_ttm` | 35%, `ev_ebitda_ttm` 20%, `peg` 25%, `fcf_yield` 15%, `div_yield` 5% |
| M | universal with `np_yoy_q` 22.5%, `sales_yoy_q` 22.5%, `ret_12m_rel` 15% | — |

### B2. `it_services_midsmall` — IT Services Mid/Small
Same as B1 with deltas:
- `peg` weight in V 30% (growth premium), `pe_ttm` 30%
- `np_consistency` in Q 10% (small caps swing more)

### B3. `it_hardware` — IT Hardware
**Pillar weights: Q 40 / V 30 / M 30**
- Lower margin / capital-heavier than services. Use `op_margin_3y` 18%, `roce_3y` 18%, `wc_days` 12%, `gross_margin_3y` 12%, `rev_cagr_5y` 12%, `np_cagr_5y` 10%, `cfo_pat_3y` 10%, `np_consistency` 8%
- V: `pe_ttm` 30%, `ev_ebitda_ttm` 25%, `pb` 15%, `peg` 15%, `fcf_yield` 10%, `div_yield` 5%
- M: universal

### B4. `telecom`
**Pillar weights: Q 35 / V 35 / M 30** (heavily capex-cyclic — valuation matters more)
- Q: `ebitda_margin_3y` 25%, `roce_3y` 15%, `cfo_ebitda_3y` 18%, `net_debt_ebitda` (inverted) 15%, `op_margin_trend` 10%, `np_consistency` 10%, `rev_cagr_5y` 7%
- V: `ev_ebitda_ttm` 35%, `pe_ttm` 20%, `fcf_yield` 25%, `pb` 10%, `div_yield` 10%
- M: universal
- **NOTE**: ARPU placeholder for v2

---

## C. Brand-led consumer — FMCG, pharma, consumer durables

These score on **brand pricing power (gross margin), distribution efficiency (working capital),
and capital efficiency (RoCE)**.

### C1. `fmcg_food_agri` — Packaged Food & Agri
**Pillar weights: Q 50 / V 30 / M 20**

| Pillar | Component | Weight |
|---|---|---|
| Q | `roce_3y` | 18% |
| Q | `gross_margin_3y` | 14% |
| Q | `gross_margin_trend` | 8% |
| Q | `op_margin_3y` | 10% |
| Q | `wc_days` (inverted) | 10% |
| Q | `rev_cagr_5y` | 10% |
| Q | `np_cagr_5y` | 10% |
| Q | `cfo_pat_3y` | 10% |
| Q | `np_consistency` | 6% |
| Q | `debt_equity` (inverted) | 4% |
| V | `pe_ttm` 30%, `ev_ebitda_ttm` 25%, `peg` 20%, `pb` 10%, `fcf_yield` 10%, `div_yield` 5% | — |
| M | universal | — |

### C2. `fmcg_personal` — Personal Care & Household
Same as C1 with `gross_margin_3y` upweighted to 18%, `gross_margin_trend` to 12%, `wc_days` to 8%, `rev_cagr_5y` to 8%. Brand is everything.

### C3. `fmcg_beverages`
Same as C1 with `op_margin_3y` upweighted to 14%, `gross_margin_3y` to 16%. Beverage premiumization shows in OPM.

### C4. `fmcg_diversified` (incl. Cigarettes)
Same as C1 with `div_yield` weight in V raised to 15%, `pe_ttm` 25% (multi-segment conglomerates). `np_consistency` upweighted to 10%.

### C5. `consumer_durables`
**Pillar weights: Q 40 / V 30 / M 30** (more cyclical than FMCG)
- Q: `roce_3y` 18%, `op_margin_3y` 14%, `op_margin_trend` 10%, `wc_days` 12%, `inv_days` 8%, `rev_cagr_5y` 12%, `np_cagr_5y` 10%, `cfo_pat_3y` 8%, `debt_equity` 8%
- V: `pe_ttm` 30%, `ev_ebitda_ttm` 22%, `peg` 23%, `pb` 10%, `fcf_yield` 10%, `div_yield` 5%
- M: universal with `np_yoy_q` 20%, `sales_yoy_q` 20%

### C6. `pharma`
**Pillar weights: Q 45 / V 30 / M 25**

| Pillar | Component | Weight |
|---|---|---|
| Q | `roce_3y` | 18% |
| Q | `gross_margin_3y` | 14% |
| Q | `gross_margin_trend` | 8% |
| Q | `op_margin_3y` | 10% |
| Q | `cfo_ebitda_3y` | 12% |
| Q | `wc_days` | 10% |
| Q | `rev_cagr_5y` | 10% |
| Q | `np_cagr_5y` | 10% |
| Q | `np_consistency` | 8% |
| V | `pe_ttm` 32%, `ev_ebitda_ttm` 23%, `peg` 22%, `pb` 8%, `fcf_yield` 10%, `div_yield` 5% | — |
| M | universal | — |
| **NOTE**: R&D intensity, US generics %, ANDA pipeline → v2 placeholders | | |

### C7. `health_services` — Hospitals & Diagnostics
**Pillar weights: Q 45 / V 30 / M 25**
- Q: `roce_3y` 18%, `ebitda_margin_3y` 18%, `op_margin_trend` 10%, `cfo_ebitda_3y` 12%, `asset_turnover` 8%, `rev_cagr_5y` 12%, `np_cagr_5y` 10%, `np_consistency` 8%, `net_debt_ebitda` 4%
- V: same as C6
- M: universal

### C8. `medtech`
Same as C6 (small N — ~6 stocks; use meta-cluster percentile fallback per scoring-engine.md edge case).

---

## D. Asset-heavy cyclicals — cement, metals, power, oil refining, paper

These score on **capital efficiency (RoCE), capacity utilization (asset turnover),
leverage discipline (net debt/EBITDA), and capex intensity**. Momentum heavily weighted because
cycles dominate medium-term returns.

### D1. `cement`
**Pillar weights: Q 35 / V 30 / M 35**

| Pillar | Component | Weight |
|---|---|---|
| Q | `ebitda_margin_3y` | 22% |
| Q | `roce_3y` | 18% |
| Q | `net_debt_ebitda` (inverted) | 14% |
| Q | `asset_turnover` | 12% |
| Q | `capex_intensity_3y` (inverted) | 10% |
| Q | `op_margin_trend` | 8% |
| Q | `rev_cagr_5y` | 10% |
| Q | `np_consistency` | 6% |
| V | `ev_ebitda_ttm` 35%, `pe_ttm` 22%, `pb` 15%, `fcf_yield` 18%, `div_yield` 10% | — |
| M | universal with `np_yoy_q` 22.5%, `sales_yoy_q` 22.5%, `ret_12m_rel` 18% | — |

### D2. `metals_ferrous` — Ferrous Metals (steel)
Same as D1 with deltas:
- `op_margin_trend` upweighted to 12% (steel cycles violently)
- `np_consistency` downweighted to 4%
- `np_cagr_5y` 6% (cycle-dependent so less informative)
- M: `ret_3m_rel` upweighted to 15%, `ret_6m_rel` to 18% (commodities lead)

### D3. `metals_nonferrous_mining` — Aluminum, copper, zinc, mining
Same as D2.

### D4. `cement` covers itself; redundant — see D1.

### D5. `paper_forest`
Same as D1 with deltas: pillar weights Q 40 / V 30 / M 30. `roce_3y` upweighted to 22%. `np_consistency` 10%.

### D6. `oil_refining`
**Pillar weights: Q 35 / V 30 / M 35**
- Q: `roce_3y` 20%, `ebitda_margin_3y` 18%, `op_margin_trend` 10% (GRM proxy), `asset_turnover` 12%, `net_debt_ebitda` 12%, `cfo_ebitda_3y` 10%, `np_consistency` 8%, `inv_days` 10% (refining inventory cycle)
- V: `ev_ebitda_ttm` 32%, `pe_ttm` 22%, `pb` 18%, `fcf_yield` 18%, `div_yield` 10%
- M: universal with momentum components weighted toward shorter horizons (`ret_3m_rel` 15%, `ret_6m_rel` 15%)
- **NOTE**: GRM placeholder for v2

### D7. `gas_distribution`
**Pillar weights: Q 45 / V 30 / M 25** (more stable than refining — regulated/contracted)
- Q: `roce_3y` 22%, `op_margin_3y` 16%, `op_margin_trend` 8%, `cfo_ebitda_3y` 12%, `asset_turnover` 10%, `rev_cagr_5y` 10%, `np_consistency` 12%, `debt_equity` 10%
- V: `pe_ttm` 30%, `ev_ebitda_ttm` 28%, `pb` 15%, `fcf_yield` 17%, `div_yield` 10%
- M: universal

### D8. `power` — Power Generation + Other Utilities
**Pillar weights: Q 40 / V 30 / M 30**

| Pillar | Component | Weight |
|---|---|---|
| Q | `roce_3y` | 20% |
| Q | `ebitda_margin_3y` | 14% |
| Q | `dso` (inverted — DISCOM receivables proxy) | 14% |
| Q | `net_debt_ebitda` (inverted) | 12% |
| Q | `asset_turnover` (PLF proxy) | 10% |
| Q | `cfo_ebitda_3y` | 10% |
| Q | `rev_cagr_5y` | 10% |
| Q | `np_consistency` | 10% |
| V | `ev_ebitda_ttm` 32%, `pe_ttm` 22%, `pb` 18%, `fcf_yield` 18%, `div_yield` 10% | — |
| M | universal | — |

---

## E. Project-led — capital goods, defense, construction, EPC

These score on **working capital cycle (huge), order book proxy, RoCE, and execution margin**.
Working-capital intensity defines viability; over-stretched balance sheets blow up.

### E1. `cap_goods_industrial` — Industrial Products & Manufacturing
**Pillar weights: Q 40 / V 30 / M 30**

| Pillar | Component | Weight |
|---|---|---|
| Q | `roce_3y` | 20% |
| Q | `op_margin_3y` | 14% |
| Q | `op_margin_trend` | 8% |
| Q | `wc_days` (inverted) | 14% |
| Q | `inv_days` (inverted) | 8% |
| Q | `cfo_pat_3y` | 10% |
| Q | `rev_cagr_5y` | 10% |
| Q | `np_cagr_5y` | 8% |
| Q | `np_consistency` | 4% |
| Q | `debt_equity` | 4% |
| V | `pe_ttm` 30%, `ev_ebitda_ttm` 25%, `peg` 22%, `pb` 10%, `fcf_yield` 8%, `div_yield` 5% | — |
| M | universal with `np_yoy_q` 22%, `sales_yoy_q` 22% | — |

### E2. `cap_goods_electrical`
Same as E1 with `op_margin_trend` upweighted to 12% (margin expansion key signal).

### E3. `defense_aero`
**Pillar weights: Q 40 / V 25 / M 35** (re-rating story; momentum weighted)
- Q: same as E1 but `wc_days` upweighted to 18% (defense WC cycles are extreme), `np_consistency` 6%, `cfo_pat_3y` 12%
- V: `pe_ttm` 25%, `peg` 35% (growth-trade), `ev_ebitda_ttm` 20%, `pb` 10%, `fcf_yield` 10%
- M: universal with `np_yoy_q` 22%, `sales_yoy_q` 22%, `ret_12m_rel` 22%
- **NOTE**: order book / book-to-bill placeholder for v2

### E4. `construction` — Construction & EPC
**Pillar weights: Q 35 / V 30 / M 35** (cyclical, leverage-sensitive)
- Q: `roce_3y` 16%, `op_margin_3y` 12%, `wc_days` (inverted) **20%**, `dso` (inverted) 10%, `cfo_sales_3y` 12%, `debt_equity` (inverted) 12%, `rev_cagr_5y` 10%, `np_consistency` 8%
- V: `pe_ttm` 25%, `pb` 25%, `ev_ebitda_ttm` 20%, `fcf_yield` 15%, `div_yield` 5%, `peg` 10%
- M: universal with `np_yoy_q` 22%, `sales_yoy_q` 22%

### E5. `realty` — Realty Developers
**Pillar weights: Q 35 / V 30 / M 35**
- Q: `roe_3y` 18%, `inv_days` (inverted, **heavy**) 18%, `debt_equity` (inverted) 18%, `cfo_sales_3y` 12%, `rev_cagr_5y` 10%, `np_cagr_5y` 8%, `op_margin_3y` 8%, `np_consistency` 8%
- V: `pb` 35% (book/NAV-driven), `pe_ttm` 22%, `ev_ebitda_ttm` 18%, `fcf_yield` 15%, `div_yield` 10%
- M: universal
- **NOTE**: pre-sales growth, NAV → v2 placeholders

---

## F. Distribution-led discretionary — auto OEM, auto components, retail, leisure

### F1. `auto_oem` — Auto OEMs (incl. Agri/Construction Vehicles)
**Pillar weights: Q 40 / V 30 / M 30**
- Q: `roce_3y` 20%, `op_margin_3y` 14%, `op_margin_trend` 12% (operating leverage), `asset_turnover` 10%, `cfo_pat_3y` 10%, `rev_cagr_5y` 12%, `np_cagr_5y` 8%, `np_consistency` 8%, `debt_equity` 6%
- V: `pe_ttm` 30%, `ev_ebitda_ttm` 25%, `peg` 18%, `pb` 12%, `fcf_yield` 10%, `div_yield` 5%
- M: universal with `sales_yoy_q` 22% (volume momentum), `np_yoy_q` 22%

### F2. `auto_components`
**Pillar weights: Q 40 / V 30 / M 30**
- Q: `roce_3y` 18%, `op_margin_3y` 14%, `op_margin_trend` 10% (margin pressure from OEMs), `wc_days` 14%, `cfo_pat_3y` 10%, `rev_cagr_5y` 10%, `np_cagr_5y` 8%, `np_consistency` 8%, `debt_equity` 8%
- V: same as F1
- M: universal

### F3. `retail`
**Pillar weights: Q 40 / V 30 / M 30**
- Q: `roce_3y` 18%, `op_margin_3y` 12%, `wc_days` (inverted) 12%, `inv_days` (inverted) 12%, `asset_turnover` 14% (store productivity proxy), `rev_cagr_5y` 14% (same-store proxy), `np_cagr_5y` 10%, `np_consistency` 6%, `debt_equity` 2%
- V: `pe_ttm` 30%, `ev_ebitda_ttm` 25%, `peg` 22%, `pb` 13%, `fcf_yield` 5%, `div_yield` 5%
- M: universal with `sales_yoy_q` 22% (footfall + ticket size proxy)

### F4. `leisure_hospitality`
**Pillar weights: Q 35 / V 30 / M 35** (cyclical to consumer sentiment)
- Q: `ebitda_margin_3y` 18%, `roce_3y` 16%, `asset_turnover` 14% (occupancy proxy), `cfo_ebitda_3y` 10%, `net_debt_ebitda` 12%, `rev_cagr_5y` 12%, `np_cagr_5y` 10%, `np_consistency` 8%
- V: `ev_ebitda_ttm` 32%, `pe_ttm` 22%, `pb` 18%, `fcf_yield` 18%, `div_yield` 10%
- M: universal

### F5. `media_entertainment`
**Pillar weights: Q 35 / V 35 / M 30** (structural pressure — valuation matters)
- Q: `roce_3y` 16%, `op_margin_3y` 12%, `op_margin_trend` 12% (declining for many), `cfo_pat_3y` 12%, `wc_days` 10%, `rev_cagr_5y` 12%, `np_cagr_5y` 10%, `np_consistency` 10%, `debt_equity` 6%
- V: `pe_ttm` 25%, `ev_ebitda_ttm` 25%, `pb` 15%, `fcf_yield` 20%, `div_yield` 10%, `peg` 5%
- M: universal

---

## G. Specialty manufacturing — chemicals, agrochem, textiles

### G1. `chemicals_specialty`
**Pillar weights: Q 45 / V 30 / M 25**
- Q: `roce_3y` 18%, `gross_margin_3y` 14%, `gross_margin_trend` 8%, `op_margin_3y` 10%, `cfo_pat_3y` 10%, `capex_intensity_3y` 8%, `asset_turnover` 8%, `rev_cagr_5y` 10%, `np_cagr_5y` 8%, `np_consistency` 6%
- V: `pe_ttm` 28%, `ev_ebitda_ttm` 25%, `peg` 22%, `pb` 10%, `fcf_yield` 10%, `div_yield` 5%
- M: universal

### G2. `chemicals_agro` — Agrochemicals & Fertilizers
Same as G1 with deltas: `np_consistency` upweighted to 12% (agri cycles), `wc_days` 10% added (replacing some `gross_margin_3y` weight to 10%), pillar weights Q 40 / V 30 / M 30.

### G3. `textiles`
**Pillar weights: Q 35 / V 35 / M 30** (commodity-textile cycles)
- Q: `roce_3y` 16%, `op_margin_3y` 14%, `wc_days` 12%, `inv_days` 10%, `debt_equity` (inverted) 14%, `cfo_pat_3y` 10%, `rev_cagr_5y` 12%, `np_consistency` 12%
- V: `pe_ttm` 22%, `pb` 25%, `ev_ebitda_ttm` 20%, `fcf_yield` 18%, `div_yield` 15%
- M: universal

---

## H. Services — commercial services, transport & logistics

### H1. `services_commercial`
**Pillar weights: Q 45 / V 30 / M 25** (asset-light, scalable)
- Q: `roce_3y` 22%, `op_margin_3y` 14%, `op_margin_trend` 8%, `cfo_pat_3y` 14%, `wc_days` 10%, `rev_cagr_5y` 12%, `np_cagr_5y` 10%, `np_consistency` 10%
- V: `pe_ttm` 32%, `ev_ebitda_ttm` 25%, `peg` 18%, `pb` 10%, `fcf_yield` 10%, `div_yield` 5%
- M: universal

### H2. `transport_logistics`
**Pillar weights: Q 40 / V 30 / M 30**
- Q: `roce_3y` 18%, `op_margin_3y` 14%, `asset_turnover` 14% (fleet/network productivity), `cfo_pat_3y` 12%, `net_debt_ebitda` 10%, `rev_cagr_5y` 12%, `np_consistency` 10%, `np_cagr_5y` 10%
- V: `pe_ttm` 28%, `ev_ebitda_ttm` 28%, `pb` 14%, `fcf_yield` 15%, `div_yield` 10%, `peg` 5%
- M: universal

---

## I. Diversified

### I1. `diversified`
Generic balanced scorecard (these are conglomerates — no specific tilt makes sense).
**Pillar weights: Q 40 / V 30 / M 30**
- Q: `roce_3y` 18%, `op_margin_3y` 12%, `cfo_pat_3y` 12%, `rev_cagr_5y` 12%, `np_cagr_5y` 12%, `np_consistency` 12%, `debt_equity` 10%, `roe_3y` 12%
- V: `pe_ttm` 25%, `pb` 20%, `ev_ebitda_ttm` 20%, `fcf_yield` 15%, `div_yield` 10%, `peg` 10%
- M: universal

---

## Summary table — pillar weights per cluster

| Cluster | Q | V | M | Archetype |
|---|---|---|---|---|
| bfsi_psu_banks | 50 | 30 | 20 | Lender |
| bfsi_pvt_banks | 50 | 30 | 20 | Lender |
| bfsi_nbfc | 50 | 25 | 25 | Lender |
| bfsi_insurance | 55 | 25 | 20 | Lender |
| bfsi_capmarkets | 45 | 30 | 25 | Asset-light services |
| bfsi_fintech | 45 | 30 | 25 | Asset-light services |
| it_services_large | 45 | 30 | 25 | Asset-light services |
| it_services_midsmall | 45 | 30 | 25 | Asset-light services |
| it_hardware | 40 | 30 | 30 | Mixed |
| telecom | 35 | 35 | 30 | Asset-heavy stable |
| pharma | 45 | 30 | 25 | Brand consumer |
| health_services | 45 | 30 | 25 | Brand consumer |
| medtech | 45 | 30 | 25 | Brand consumer |
| fmcg_food_agri | 50 | 30 | 20 | Brand consumer |
| fmcg_personal | 50 | 30 | 20 | Brand consumer |
| fmcg_beverages | 50 | 30 | 20 | Brand consumer |
| fmcg_diversified | 50 | 30 | 20 | Brand consumer |
| consumer_durables | 40 | 30 | 30 | Distribution-led |
| retail | 40 | 30 | 30 | Distribution-led |
| leisure_hospitality | 35 | 30 | 35 | Distribution-led cyclical |
| media_entertainment | 35 | 35 | 30 | Distribution-led cyclical |
| cap_goods_industrial | 40 | 30 | 30 | Project-led |
| cap_goods_electrical | 40 | 30 | 30 | Project-led |
| defense_aero | 40 | 25 | 35 | Project-led growth |
| auto_oem | 40 | 30 | 30 | Distribution-led |
| auto_components | 40 | 30 | 30 | Distribution-led |
| services_commercial | 45 | 30 | 25 | Asset-light services |
| transport_logistics | 40 | 30 | 30 | Asset-medium services |
| chemicals_specialty | 45 | 30 | 25 | Specialty mfg |
| chemicals_agro | 40 | 30 | 30 | Specialty mfg |
| metals_ferrous | 35 | 30 | 35 | Asset-heavy cyclical |
| metals_nonferrous_mining | 35 | 30 | 35 | Asset-heavy cyclical |
| cement | 35 | 30 | 35 | Asset-heavy cyclical |
| paper_forest | 40 | 30 | 30 | Asset-heavy cyclical |
| textiles | 35 | 35 | 30 | Asset-heavy cyclical |
| realty | 35 | 30 | 35 | Project-led leveraged |
| construction | 35 | 30 | 35 | Project-led leveraged |
| oil_refining | 35 | 30 | 35 | Asset-heavy cyclical |
| gas_distribution | 45 | 30 | 25 | Asset-heavy stable |
| power | 40 | 30 | 30 | Asset-heavy stable |
| diversified | 40 | 30 | 30 | Mixed |

---

## v2 placeholders (where external data feeds slot in)

| Cluster | Metric | Source needed |
|---|---|---|
| All bfsi_* | NIM, GNPA, NNPA, CASA, CAR | Bank annual reports (XBRL) or specialised data |
| pharma | R&D intensity, US generics %, ANDA pipeline | Annual reports + USFDA data |
| telecom | ARPU, subs growth | TRAI / quarterly disclosures |
| oil_refining | GRM, throughput | Quarterly company disclosures |
| cement, metals | Volume growth, EBITDA/tonne | Quarterly disclosures |
| auto_oem | Segment-wise market share, volumes | SIAM / company data |
| cap_goods_*, defense | Order book, book-to-bill | Quarterly disclosures |
| realty | Pre-sales, NAV, project pipeline | Company quarterly updates |
| power | PLF, receivables ageing from DISCOMs | Annual reports |
| retail | Same-store growth, store count | Quarterly company disclosures |
| it_services_* | Top-5 client concentration, deal TCV, attrition | Quarterly company disclosures |
| consumer_durables, fmcg_* | Volume growth (vs price-led) | Quarterly company disclosures |

These will be sourced from concall transcripts (auto-extracted via Claude) and quarterly disclosures
in Phase 3 of the roadmap.
