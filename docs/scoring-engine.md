# Scoring Engine (v1)

Three pillars per stock, each rendered as a **percentile rank within the stock's cluster** (0-100).
Composite is a weighted blend of the three pillars. Default weights:

| Pillar | Default weight | What it measures |
|---|---|---|
| Quality | 40% | Long-term operational durability — does this business compound? |
| Valuation | 30% | Are we paying a fair price for what we're getting? |
| Momentum | 30% | Is the market currently endorsing the thesis? |

Weights become user-configurable in v2 (e.g. value tilt = 50/40/10).

## Quality Pillar

| Component | Formula | Weight inside Quality |
|---|---|---|
| ROE (3yr avg) | mean(net_profit / (equity_share_capital + reserves)) over last 3 FY | 18% |
| ROCE (3yr avg) | mean((PBT + interest) / (equity + reserves + borrowings)) over last 3 FY | 18% |
| Operating margin (3yr avg) | mean(operating_profit / sales) over last 3 FY | 10% |
| Operating margin trend | linear-regression slope of yearly OPM over last 5 FY (positive = improving) | 8% |
| Revenue CAGR (5yr) | (sales_T / sales_T-5)^(1/5) - 1 | 8% |
| Net profit CAGR (5yr) | same on net_profit; require all 5 positive | 12% |
| Net profit consistency | (years with positive NP in last 5) / 5 + 1/(1+CV of NP) | 6% |
| Debt-to-Equity | borrowings / (equity + reserves); inverted (lower = better) | 8% |
| Interest coverage | (PBT + interest) / interest; capped at 50; inverted percentile | 4% |
| CFO/PAT (3yr avg) | mean(cash_from_operating / net_profit) over last 3 FY; clipped to [0, 3] | 8% |

**Cluster-aware substitutions:**
- **bfsi_*** (banks, NBFCs, insurance, capital markets): drop debt-to-equity (banks are levered by design); drop CFO/PAT (CFO not meaningful); reweight ROE 35%, ROCE 0% (use ROA instead — to add when we wire bank-specific data), op-margin 0%, NP-CAGR 25%, NP-consistency 15%, interest coverage 0%, NIM/ROA placeholder 25%. *In v1, banks score on ROE + growth + consistency only*; placeholder fields kept null until we add bank-specific feeds.
- **realty / construction**: cash flow weighting upweighted (CFO/PAT to 15%), revenue CAGR downweighted (lumpy revenues).
- **defense / capital_goods**: order-book / book-to-bill would matter — not in Screener export; defer to v2.

## Valuation Pillar

| Component | Formula | Weight inside Valuation |
|---|---|---|
| P/E (TTM) | market_cap / TTM_net_profit; lower = better | 25% |
| P/B | market_cap / (equity + reserves); lower = better | 20% |
| EV/EBITDA | (market_cap + borrowings - cash) / (operating_profit + depreciation) TTM; lower = better | 20% |
| PEG | P/E / (3yr NP CAGR × 100); lower = better; require positive growth | 15% |
| FCF yield | (CFO_3yr_avg - capex_proxy) / market_cap; higher = better. Capex proxy = ΔNet Block + ΔCWIP | 15% |
| Dividend yield | dividend_amount / market_cap; higher = better | 5% |

TTM = trailing twelve months from `fundamentals_quarterly` (sum of last 4 quarters).

**Cluster-aware substitutions:**
- **bfsi_***: P/E weight 30%, P/B weight 50% (book value central for banks), EV/EBITDA dropped, PEG 15%, FCF dropped, div yield 5%.
- **realty**: NAV / book value would matter — defer; for v1 use the standard formula.
- **growth-tilted clusters** (it_services, fintech, defense_aero): PEG upweighted to 25%, P/E downweighted to 15%.

## Momentum Pillar

Momentum mixes price action (already in `golden.indicators.daily_signals`) and earnings momentum
(derived from `fundamentals_quarterly`).

| Component | Source | Weight inside Momentum |
|---|---|---|
| 3M return relative to Nifty | computed from price_history | 15% |
| 6M return relative to Nifty | computed from price_history | 15% |
| 12M return relative to Nifty | rs_vs_nifty_50d (we'll compute 12M version) | 20% |
| % of last 252 sessions above 200 EMA | derived from indicators.daily_signals.above_200ema | 10% |
| EMA stack health | latest indicators.daily_signals.ema_stack | 5% |
| Net score (technical) | scaled indicators.daily_signals.net_score | 5% |
| Sales YoY growth (latest Q vs same-Q prior year) | fundamentals_quarterly | 15% |
| Net profit YoY growth (latest Q vs same-Q prior year) | fundamentals_quarterly | 15% |

Earnings momentum is critical — it separates "stocks going up because they're good" from "stocks going up on hype". Together with valuation, it catches falling knives.

## Composite Score

```
composite_pct = 0.40 * quality_pct + 0.30 * valuation_pct + 0.30 * momentum_pct
```

Then re-percentile composite within the cluster, so the **composite_pct itself is a cluster percentile** (top 10% within cluster, etc.). This is what the percentile badge displays.

## Storage model

```sql
-- Per-stock raw metrics, computed from fundamentals + indicators
app.metrics_snapshot (symbol, snapshot_date, ...30 columns)

-- Per-stock pillar + composite percentiles, plus per-component sub-percentiles
app.scores (symbol, snapshot_date, cluster_id,
            quality_pct, valuation_pct, momentum_pct, composite_pct,
            quality_components JSONB, valuation_components JSONB, momentum_components JSONB)
```

A new `snapshot_date` row is written **weekly on Sunday** (after Friday close + weekend gap). This builds the score history archive — the moat.

## Score history archive (the moat)

Every Sunday compute → INSERT new row into `app.scores`. Never overwrite. After 12 months we have a complete weekly history per stock; this powers:
- 12-month sparklines on stock pages
- "Score delta feed" (top movers this week)
- Backtest-lite (decile vs forward returns) in v2

## Explainability rule

Every composite_pct must drill down to its three pillar percentiles, and every pillar percentile
must drill down to per-component sub-percentiles (stored in the JSONB columns). The stock page
renders the full tree on click — no black boxes.

## Edge cases

- **IPOs <2 years old**: insufficient history for 3yr/5yr CAGR. Flag as `score_status='partial'` and only compute components where data exists.
- **Loss-making companies**: Quality NP-CAGR drops out (no positive base); P/E drops out (negative). Use price/sales as fallback in valuation. Mark with `loss_making=true` flag.
- **Cluster too small (<10 peers)**: percentile ranks unstable. Compute against meta-cluster instead and flag.
