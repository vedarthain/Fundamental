# Per-Industry Scorecards

Generated 2026-05-15 by `scripts/generate-scorecards-doc.py`. Re-run after tuning.

**42 active scorecards** across **9 sectors**. Every industry has its own pillar blend (Quality / Valuation / Momentum) and its own per-pillar formula weights. Per `MOAT.md` Moat #2: *"banks judged on bank metrics, IT firms on IT metrics — not blanket rules."*

Within each formula list, weights are shown in parentheses and sorted high → low so the most-impactful signals appear first.

---

## Consumer

_8 industries_

### Beverages  ·  `fmcg_beverages`

**Pillars** — Quality **50**, Valuation **30**, Momentum **20**

- **Quality (9)** — `roce_3y`(22), `op_margin_3y`(16), `np_cagr_5y`(12), `rev_cagr_5y`(12), `wc_days`(10), `cfo_pat_3y`(10), `np_consistency_5y`(8), `op_margin_trend`(6), `debt_equity`(4)
- **Valuation (6)** — `pe_ttm`(30), `ev_ebitda_ttm`(25), `peg`(20), `pb`(10), `fcf_yield`(10), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Consumer Durables  ·  `consumer_durables`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (9)** — `roce_3y`(18), `op_margin_3y`(14), `wc_days`(12), `rev_cagr_5y`(12), `np_cagr_5y`(10), `op_margin_trend`(10), `inv_days`(8), `cfo_pat_3y`(8), `debt_equity`(8)
- **Valuation (6)** — `pe_ttm`(30), `peg`(23), `ev_ebitda_ttm`(22), `pb`(10), `fcf_yield`(10), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `sales_yoy_q`(20), `np_yoy_q`(15), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Diversified FMCG (incl. Tobacco)  ·  `fmcg_diversified`

**Pillars** — Quality **50**, Valuation **30**, Momentum **20**

- **Quality (9)** — `roce_3y`(20), `op_margin_3y`(14), `cfo_pat_3y`(12), `np_cagr_5y`(12), `rev_cagr_5y`(12), `wc_days`(10), `np_consistency_5y`(10), `op_margin_trend`(6), `debt_equity`(4)
- **Valuation (6)** — `pe_ttm`(25), `ev_ebitda_ttm`(25), `peg`(15), `div_yield`(15), `pb`(10), `fcf_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Leisure & Hospitality  ·  `leisure_hospitality`

**Pillars** — Quality **35**, Valuation **30**, Momentum **35**

- **Quality (8)** — `ebitda_margin_3y`(18), `roce_3y`(16), `asset_turnover`(14), `rev_cagr_5y`(12), `net_debt_ebitda`(12), `np_cagr_5y`(10), `cfo_ebitda_3y`(10), `np_consistency_5y`(8)
- **Valuation (5)** — `ev_ebitda_ttm`(32), `pe_ttm`(22), `pb`(18), `fcf_yield`(18), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Media & Entertainment  ·  `media_entertainment`

**Pillars** — Quality **35**, Valuation **35**, Momentum **30**

- **Quality (9)** — `roce_3y`(16), `cfo_pat_3y`(12), `rev_cagr_5y`(12), `op_margin_3y`(12), `op_margin_trend`(12), `wc_days`(10), `np_cagr_5y`(10), `np_consistency_5y`(10), `debt_equity`(6)
- **Valuation (6)** — `pe_ttm`(25), `ev_ebitda_ttm`(25), `fcf_yield`(20), `pb`(15), `div_yield`(10), `peg`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Packaged Food & Agri  ·  `fmcg_food_agri`

**Pillars** — Quality **50**, Valuation **30**, Momentum **20**

- **Quality (9)** — `roce_3y`(22), `op_margin_3y`(14), `cfo_pat_3y`(12), `np_cagr_5y`(12), `rev_cagr_5y`(12), `wc_days`(10), `np_consistency_5y`(8), `op_margin_trend`(6), `debt_equity`(4)
- **Valuation (6)** — `pe_ttm`(30), `ev_ebitda_ttm`(25), `peg`(20), `pb`(10), `fcf_yield`(10), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Personal Care & Household  ·  `fmcg_personal`

**Pillars** — Quality **50**, Valuation **30**, Momentum **20**

- **Quality (9)** — `roce_3y`(25), `op_margin_3y`(14), `cfo_pat_3y`(12), `np_cagr_5y`(12), `wc_days`(10), `rev_cagr_5y`(10), `np_consistency_5y`(8), `op_margin_trend`(5), `debt_equity`(4)
- **Valuation (6)** — `pe_ttm`(30), `ev_ebitda_ttm`(25), `peg`(20), `pb`(10), `fcf_yield`(10), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Retail  ·  `retail`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (9)** — `roce_3y`(18), `rev_cagr_5y`(14), `asset_turnover`(14), `wc_days`(12), `inv_days`(12), `op_margin_3y`(12), `np_cagr_5y`(10), `np_consistency_5y`(6), `debt_equity`(2)
- **Valuation (6)** — `pe_ttm`(30), `ev_ebitda_ttm`(25), `peg`(22), `pb`(13), `div_yield`(5), `fcf_yield`(5)
- **Momentum (8)** — `sales_yoy_q`(22.5), `ret_12m_rel`(20), `ret_6m_rel`(15), `np_yoy_q`(12.5), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

---

## Diversified

_2 industries_

### Diversified Conglomerates  ·  `diversified`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (8)** — `roce_3y`(18), `roe_3y`(12), `cfo_pat_3y`(12), `np_cagr_5y`(12), `rev_cagr_5y`(12), `op_margin_3y`(12), `np_consistency_5y`(12), `debt_equity`(10)
- **Valuation (6)** — `pe_ttm`(25), `pb`(20), `ev_ebitda_ttm`(20), `fcf_yield`(15), `peg`(10), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Unclassified  ·  `unclassified`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (5)** — `roe_3y`(25), `np_cagr_5y`(20), `rev_cagr_5y`(20), `op_margin_3y`(20), `debt_equity`(15)
- **Valuation (3)** — `pe_ttm`(40), `pb`(30), `div_yield`(30)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

---

## Energy & Utilities

_3 industries_

### Gas Distribution  ·  `gas_distribution`

**Pillars** — Quality **45**, Valuation **30**, Momentum **25**

- **Quality (8)** — `roce_3y`(22), `op_margin_3y`(16), `cfo_ebitda_3y`(12), `np_consistency_5y`(12), `debt_equity`(10), `rev_cagr_5y`(10), `asset_turnover`(10), `op_margin_trend`(8)
- **Valuation (5)** — `pe_ttm`(30), `ev_ebitda_ttm`(28), `fcf_yield`(17), `pb`(15), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Oil & Refining  ·  `oil_refining`

**Pillars** — Quality **35**, Valuation **30**, Momentum **35**

- **Quality (8)** — `roce_3y`(20), `ebitda_margin_3y`(18), `asset_turnover`(12), `net_debt_ebitda`(12), `inv_days`(10), `cfo_ebitda_3y`(10), `op_margin_trend`(10), `np_consistency_5y`(8)
- **Valuation (5)** — `ev_ebitda_ttm`(32), `pe_ttm`(22), `pb`(18), `fcf_yield`(18), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(18), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_3m_rel`(15), `ret_6m_rel`(15), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(2)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Power Generation & Utilities  ·  `power`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (8)** — `roce_3y`(20), `dso`(14), `ebitda_margin_3y`(14), `net_debt_ebitda`(12), `rev_cagr_5y`(10), `cfo_ebitda_3y`(10), `asset_turnover`(10), `np_consistency_5y`(10)
- **Valuation (5)** — `ev_ebitda_ttm`(32), `pe_ttm`(22), `pb`(18), `fcf_yield`(18), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

---

## Financials

_6 industries_

### Capital Markets, Brokers, AMCs  ·  `bfsi_capmarkets`

**Pillars** — Quality **45**, Valuation **30**, Momentum **25**

- **Quality (7)** — `roe_3y`(20), `roce_3y`(18), `np_cagr_5y`(15), `op_margin_3y`(15), `cfo_pat_3y`(12), `op_margin_trend`(10), `np_consistency_5y`(10)
- **Valuation (5)** — `pe_ttm`(35), `pb`(20), `fcf_yield`(20), `earnings_yield_trend`(15), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Fintech  ·  `bfsi_fintech`

**Pillars** — Quality **45**, Valuation **30**, Momentum **25**

- **Quality (7)** — `roe_3y`(20), `roce_3y`(18), `np_cagr_5y`(15), `op_margin_3y`(15), `rev_cagr_5y`(12), `cfo_pat_3y`(10), `op_margin_trend`(10)
- **Valuation (5)** — `pe_ttm`(35), `pb`(20), `fcf_yield`(20), `earnings_yield_trend`(15), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Insurance  ·  `bfsi_insurance`

**Pillars** — Quality **55**, Valuation **25**, Momentum **20**

- **Quality (6)** — `roe_3y`(25), `book_value_cagr_5y`(25), `np_cagr_5y`(20), `rev_cagr_5y`(15), `np_consistency_5y`(10), `equity_to_assets`(5)
- **Valuation (3)** — `pb`(60), `pe_ttm`(25), `div_yield`(15)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['p_premium', 1.0]]

### NBFCs / Lenders  ·  `bfsi_nbfc`

**Pillars** — Quality **50**, Valuation **25**, Momentum **25**

- **Quality (7)** — `roa_3y`(22), `roe_3y`(18), `loan_book_cagr_3y`(18), `book_value_cagr_5y`(14), `np_cagr_5y`(12), `equity_to_assets`(8), `np_consistency_5y`(8)
- **Valuation (4)** — `pb`(45), `pe_ttm`(30), `earnings_yield_trend`(15), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['p_aum', 1.0]]

### Private Banks  ·  `bfsi_pvt_banks`

**Pillars** — Quality **50**, Valuation **30**, Momentum **20**

- **Quality (7)** — `roa_3y`(25), `roe_3y`(18), `book_value_cagr_5y`(18), `loan_book_cagr_3y`(14), `np_cagr_5y`(12), `np_consistency_5y`(8), `equity_to_assets`(5)
- **Valuation (4)** — `pb`(50), `pe_ttm`(25), `earnings_yield_trend`(15), `div_yield`(10)
- **Momentum (8)** — `np_yoy_q`(25), `ret_12m_rel`(20), `ret_6m_rel`(15), `ret_3m_rel`(10), `sales_yoy_q`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['pb', 1.0]]

### PSU Banks  ·  `bfsi_psu_banks`

**Pillars** — Quality **50**, Valuation **30**, Momentum **20**

- **Quality (7)** — `roa_3y`(30), `roe_3y`(15), `book_value_cagr_5y`(15), `loan_book_cagr_3y`(14), `np_cagr_5y`(12), `np_consistency_5y`(8), `equity_to_assets`(6)
- **Valuation (4)** — `pb`(45), `pe_ttm`(25), `div_yield`(20), `earnings_yield_trend`(10)
- **Momentum (8)** — `np_yoy_q`(25), `ret_12m_rel`(20), `ret_6m_rel`(15), `ret_3m_rel`(10), `sales_yoy_q`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['pb', 1.0]]

---

## Healthcare

_3 industries_

### Hospitals & Diagnostics  ·  `health_services`

**Pillars** — Quality **45**, Valuation **30**, Momentum **25**

- **Quality (9)** — `roce_3y`(18), `ebitda_margin_3y`(18), `rev_cagr_5y`(12), `cfo_ebitda_3y`(12), `np_cagr_5y`(10), `op_margin_trend`(10), `asset_turnover`(8), `np_consistency_5y`(8), `net_debt_ebitda`(4)
- **Valuation (6)** — `pe_ttm`(32), `ev_ebitda_ttm`(23), `peg`(22), `fcf_yield`(10), `pb`(8), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### MedTech  ·  `medtech`

**Pillars** — Quality **45**, Valuation **30**, Momentum **25**

- **Quality (8)** — `roce_3y`(22), `op_margin_3y`(14), `np_cagr_5y`(12), `rev_cagr_5y`(12), `cfo_ebitda_3y`(12), `wc_days`(10), `op_margin_trend`(10), `np_consistency_5y`(8)
- **Valuation (6)** — `pe_ttm`(32), `ev_ebitda_ttm`(23), `peg`(22), `fcf_yield`(10), `pb`(8), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Pharmaceuticals  ·  `pharma`

**Pillars** — Quality **45**, Valuation **30**, Momentum **25**

- **Quality (8)** — `roce_3y`(22), `op_margin_3y`(14), `np_cagr_5y`(12), `rev_cagr_5y`(12), `cfo_ebitda_3y`(12), `wc_days`(10), `op_margin_trend`(10), `np_consistency_5y`(8)
- **Valuation (6)** — `pe_ttm`(32), `ev_ebitda_ttm`(23), `peg`(22), `fcf_yield`(10), `pb`(8), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

---

## Industrials

_7 industries_

### Auto Components  ·  `auto_components`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (9)** — `roce_3y`(18), `wc_days`(14), `op_margin_3y`(14), `cfo_pat_3y`(10), `rev_cagr_5y`(10), `op_margin_trend`(10), `np_cagr_5y`(8), `debt_equity`(8), `np_consistency_5y`(8)
- **Valuation (6)** — `pe_ttm`(30), `ev_ebitda_ttm`(25), `peg`(18), `pb`(12), `fcf_yield`(10), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Auto OEMs  ·  `auto_oem`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (9)** — `roce_3y`(20), `op_margin_3y`(14), `rev_cagr_5y`(12), `op_margin_trend`(12), `cfo_pat_3y`(10), `asset_turnover`(10), `np_cagr_5y`(8), `np_consistency_5y`(8), `debt_equity`(6)
- **Valuation (6)** — `pe_ttm`(30), `ev_ebitda_ttm`(25), `peg`(18), `pb`(12), `fcf_yield`(10), `div_yield`(5)
- **Momentum (8)** — `sales_yoy_q`(22), `np_yoy_q`(18), `ret_12m_rel`(18), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(2)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Commercial Services  ·  `services_commercial`

**Pillars** — Quality **45**, Valuation **30**, Momentum **25**

- **Quality (8)** — `roce_3y`(22), `cfo_pat_3y`(14), `op_margin_3y`(14), `rev_cagr_5y`(12), `wc_days`(10), `np_cagr_5y`(10), `np_consistency_5y`(10), `op_margin_trend`(8)
- **Valuation (6)** — `pe_ttm`(32), `ev_ebitda_ttm`(25), `peg`(18), `pb`(10), `fcf_yield`(10), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Defense & Aerospace  ·  `defense_aero`

**Pillars** — Quality **40**, Valuation **25**, Momentum **35**

- **Quality (9)** — `roce_3y`(20), `wc_days`(18), `op_margin_3y`(14), `cfo_pat_3y`(12), `np_cagr_5y`(8), `rev_cagr_5y`(8), `op_margin_trend`(8), `inv_days`(6), `np_consistency_5y`(6)
- **Valuation (5)** — `peg`(35), `pe_ttm`(25), `ev_ebitda_ttm`(20), `pb`(10), `fcf_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(22), `sales_yoy_q`(22), `np_yoy_q`(15), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(1)
- _Loss-maker fallback_: [['ev_sales_ttm', 0.6], ['pb', 0.4]]

### Electrical Equipment  ·  `cap_goods_electrical`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (10)** — `roce_3y`(20), `op_margin_3y`(14), `wc_days`(12), `op_margin_trend`(12), `cfo_pat_3y`(10), `rev_cagr_5y`(10), `inv_days`(8), `np_cagr_5y`(8), `np_consistency_5y`(4), `debt_equity`(2)
- **Valuation (6)** — `pe_ttm`(30), `ev_ebitda_ttm`(25), `peg`(22), `pb`(10), `fcf_yield`(8), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 0.6], ['pb', 0.4]]

### Industrial Products & Manufacturing  ·  `cap_goods_industrial`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (10)** — `roce_3y`(20), `wc_days`(14), `op_margin_3y`(14), `cfo_pat_3y`(10), `rev_cagr_5y`(10), `inv_days`(8), `np_cagr_5y`(8), `op_margin_trend`(8), `debt_equity`(4), `np_consistency_5y`(4)
- **Valuation (6)** — `pe_ttm`(30), `ev_ebitda_ttm`(25), `peg`(22), `pb`(10), `fcf_yield`(8), `div_yield`(5)
- **Momentum (8)** — `sales_yoy_q`(22), `ret_12m_rel`(20), `ret_6m_rel`(15), `np_yoy_q`(12), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `tech_net_score_scaled`(6), `ema_stack_bull`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 0.6], ['pb', 0.4]]

### Transport & Logistics  ·  `transport_logistics`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (8)** — `roce_3y`(18), `op_margin_3y`(14), `asset_turnover`(14), `cfo_pat_3y`(12), `rev_cagr_5y`(12), `np_cagr_5y`(10), `net_debt_ebitda`(10), `np_consistency_5y`(10)
- **Valuation (6)** — `pe_ttm`(28), `ev_ebitda_ttm`(28), `fcf_yield`(15), `pb`(14), `div_yield`(10), `peg`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

---

## Materials

_7 industries_

### Agrochemicals & Fertilizers  ·  `chemicals_agro`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (10)** — `roce_3y`(18), `op_margin_3y`(14), `np_consistency_5y`(12), `cfo_pat_3y`(10), `rev_cagr_5y`(10), `np_cagr_5y`(8), `asset_turnover`(8), `capex_intensity_3y`(8), `wc_days`(6), `op_margin_trend`(6)
- **Valuation (6)** — `pe_ttm`(28), `ev_ebitda_ttm`(25), `peg`(22), `pb`(10), `fcf_yield`(10), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Cement  ·  `cement`

**Pillars** — Quality **35**, Valuation **30**, Momentum **35**

- **Quality (8)** — `ebitda_margin_3y`(22), `roce_3y`(18), `net_debt_ebitda`(14), `asset_turnover`(12), `rev_cagr_5y`(10), `capex_intensity_3y`(10), `op_margin_trend`(8), `np_consistency_5y`(6)
- **Valuation (5)** — `ev_ebitda_ttm`(35), `pe_ttm`(22), `fcf_yield`(18), `pb`(15), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(18), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `tech_net_score_scaled`(7), `ema_stack_bull`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1]]

### Ferrous Metals  ·  `metals_ferrous`

**Pillars** — Quality **35**, Valuation **30**, Momentum **35**

- **Quality (8)** — `ebitda_margin_3y`(22), `roce_3y`(18), `net_debt_ebitda`(14), `asset_turnover`(12), `op_margin_trend`(12), `capex_intensity_3y`(10), `np_cagr_5y`(6), `rev_cagr_5y`(6)
- **Valuation (5)** — `ev_ebitda_ttm`(35), `pe_ttm`(22), `fcf_yield`(18), `pb`(15), `div_yield`(10)
- **Momentum (8)** — `ret_6m_rel`(18), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_3m_rel`(15), `ret_12m_rel`(15), `pct_above_200ema_252d`(8), `ema_stack_bull`(5), `tech_net_score_scaled`(4)
- _Loss-maker fallback_: [['ev_sales_ttm', 0.6], ['pb', 0.4]]

### Non-Ferrous & Mining  ·  `metals_nonferrous_mining`

**Pillars** — Quality **35**, Valuation **30**, Momentum **35**

- **Quality (8)** — `ebitda_margin_3y`(22), `roce_3y`(18), `net_debt_ebitda`(14), `asset_turnover`(12), `op_margin_trend`(12), `capex_intensity_3y`(10), `np_cagr_5y`(6), `rev_cagr_5y`(6)
- **Valuation (5)** — `ev_ebitda_ttm`(35), `pe_ttm`(22), `fcf_yield`(18), `pb`(15), `div_yield`(10)
- **Momentum (8)** — `ret_6m_rel`(18), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_3m_rel`(15), `ret_12m_rel`(15), `pct_above_200ema_252d`(8), `ema_stack_bull`(5), `tech_net_score_scaled`(4)
- _Loss-maker fallback_: [['ev_sales_ttm', 0.6], ['pb', 0.4]]

### Paper & Forest Products  ·  `paper_forest`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (8)** — `roce_3y`(22), `ebitda_margin_3y`(18), `net_debt_ebitda`(12), `np_cagr_5y`(10), `rev_cagr_5y`(10), `asset_turnover`(10), `np_consistency_5y`(10), `capex_intensity_3y`(8)
- **Valuation (5)** — `ev_ebitda_ttm`(32), `pe_ttm`(22), `pb`(18), `fcf_yield`(18), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 0.6], ['pb', 0.4]]

### Specialty Chemicals  ·  `chemicals_specialty`

**Pillars** — Quality **45**, Valuation **30**, Momentum **25**

- **Quality (10)** — `roce_3y`(18), `op_margin_3y`(14), `wc_days`(10), `cfo_pat_3y`(10), `rev_cagr_5y`(10), `np_cagr_5y`(8), `asset_turnover`(8), `op_margin_trend`(8), `capex_intensity_3y`(8), `np_consistency_5y`(6)
- **Valuation (6)** — `pe_ttm`(28), `ev_ebitda_ttm`(25), `peg`(22), `pb`(10), `fcf_yield`(10), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Textiles  ·  `textiles`

**Pillars** — Quality **35**, Valuation **35**, Momentum **30**

- **Quality (8)** — `roce_3y`(16), `debt_equity`(14), `op_margin_3y`(14), `wc_days`(12), `rev_cagr_5y`(12), `np_consistency_5y`(12), `inv_days`(10), `cfo_pat_3y`(10)
- **Valuation (5)** — `pb`(25), `pe_ttm`(22), `ev_ebitda_ttm`(20), `fcf_yield`(18), `div_yield`(15)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 0.6], ['pb', 0.4]]

---

## Real Estate & Infra

_2 industries_

### Construction & EPC  ·  `construction`

**Pillars** — Quality **35**, Valuation **30**, Momentum **35**

- **Quality (8)** — `wc_days`(20), `roce_3y`(16), `debt_equity`(12), `cfo_sales_3y`(12), `op_margin_3y`(12), `dso`(10), `rev_cagr_5y`(10), `np_consistency_5y`(8)
- **Valuation (6)** — `pb`(25), `pe_ttm`(25), `ev_ebitda_ttm`(20), `fcf_yield`(15), `peg`(10), `div_yield`(5)
- **Momentum (8)** — `sales_yoy_q`(22), `ret_12m_rel`(20), `ret_6m_rel`(15), `np_yoy_q`(12), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `tech_net_score_scaled`(6), `ema_stack_bull`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 0.6], ['pb', 0.4]]

### Realty Developers  ·  `realty`

**Pillars** — Quality **35**, Valuation **30**, Momentum **35**

- **Quality (8)** — `roe_3y`(18), `inv_days`(18), `debt_equity`(18), `cfo_sales_3y`(12), `rev_cagr_5y`(10), `np_cagr_5y`(8), `op_margin_3y`(8), `np_consistency_5y`(8)
- **Valuation (5)** — `pb`(35), `pe_ttm`(22), `ev_ebitda_ttm`(18), `fcf_yield`(15), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['pb', 1.0]]

---

## Tech & Communication

_4 industries_

### IT Hardware  ·  `it_hardware`

**Pillars** — Quality **40**, Valuation **30**, Momentum **30**

- **Quality (8)** — `roce_3y`(18), `op_margin_3y`(18), `wc_days`(12), `rev_cagr_5y`(12), `asset_turnover`(12), `cfo_pat_3y`(10), `np_cagr_5y`(10), `np_consistency_5y`(8)
- **Valuation (6)** — `pe_ttm`(30), `ev_ebitda_ttm`(25), `pb`(15), `peg`(15), `fcf_yield`(10), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### IT Services — Large Cap  ·  `it_services_large`

**Pillars** — Quality **45**, Valuation **30**, Momentum **25**

- **Quality (8)** — `op_margin_3y`(22), `roce_3y`(18), `cfo_ebitda_3y`(14), `rev_cagr_5y`(12), `op_margin_trend`(12), `dso`(8), `np_cagr_5y`(8), `np_consistency_5y`(6)
- **Valuation (5)** — `pe_ttm`(35), `peg`(25), `ev_ebitda_ttm`(20), `fcf_yield`(15), `div_yield`(5)
- **Momentum (8)** — `sales_yoy_q`(22.5), `np_yoy_q`(17.5), `ret_6m_rel`(15), `ret_12m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### IT Services — Mid/Small  ·  `it_services_midsmall`

**Pillars** — Quality **45**, Valuation **30**, Momentum **25**

- **Quality (8)** — `op_margin_3y`(22), `roce_3y`(18), `cfo_ebitda_3y`(14), `rev_cagr_5y`(12), `op_margin_trend`(12), `np_consistency_5y`(10), `dso`(8), `np_cagr_5y`(4)
- **Valuation (5)** — `peg`(30), `pe_ttm`(30), `ev_ebitda_ttm`(20), `fcf_yield`(15), `div_yield`(5)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

### Telecom  ·  `telecom`

**Pillars** — Quality **35**, Valuation **35**, Momentum **30**

- **Quality (7)** — `ebitda_margin_3y`(25), `cfo_ebitda_3y`(18), `roce_3y`(15), `net_debt_ebitda`(15), `op_margin_trend`(10), `np_consistency_5y`(10), `rev_cagr_5y`(7)
- **Valuation (5)** — `ev_ebitda_ttm`(35), `fcf_yield`(25), `pe_ttm`(20), `pb`(10), `div_yield`(10)
- **Momentum (8)** — `ret_12m_rel`(20), `np_yoy_q`(17.5), `sales_yoy_q`(17.5), `ret_6m_rel`(15), `ret_3m_rel`(10), `pct_above_200ema_252d`(10), `ema_stack_bull`(5), `tech_net_score_scaled`(5)
- _Loss-maker fallback_: [['ev_sales_ttm', 1.0]]

---
