# Scoring Design — EquityRoots NSE

**Internal reference.** Explains how "Industry Score" (peer-cluster percentile) and "Your Score" (user-weighted blend) are computed, stored, and displayed.

---

## 1. Overview

Every stock on the platform gets **three pillar percentile scores** (Quality, Valuation, Momentum) and one composite **Industry Score**. All scores are **within-cluster percentile ranks**: 75 means the stock is in the top 25% of its peer cluster — not the whole market.

| Score | What it is | Who sets the weights |
|---|---|---|
| **Industry Score** | Cluster-tuned composite percentile, re-ranked within peers | Platform (per-cluster scorecard) |
| **Your Score** | Direct weighted blend of the same three pillar percentiles | You (sliders on /discover) |

---

## 2. Data Flow — End to End

```
Screener.in xlsx
      │
      ▼
ETL: fundamental_etl (Python)
  ├── formulas.py      → compute 90+ metrics per stock
  ├── metrics.py       → per-stock metric dict + metadata
  ├── scorer.py        → percentile rank within peer cluster
  └── scorecards.py    → formula weights per cluster/tier
      │
      ▼
app.metrics_snapshot  (raw metric values JSONB)
app.scores            (pillar percentiles + composite_pct)
      │
      ▼  scripts/sync-neon.sh  (Nifty 200 subset)
      ▼
Neon cloud Postgres
      │
      ▼
Next.js (Vercel)
  ├── /discover        → table with Industry Score + Your Score
  ├── /stock/[symbol]  → spider chart, pillar breakdown
  └── /sectors         → cluster heatmap
```

---

## 3. Cluster Scorecard

### 3.1 Structure

Each of the 42 industry clusters has its own `Scorecard` dataclass:

```python
@dataclass
class Scorecard:
    pillar_weights: dict[str, float]              # {"q": 50, "v": 30, "m": 20}
    quality: dict[str, float]                      # {formula_id: intra-pillar weight}
    valuation: dict[str, float]
    momentum: dict[str, float]
    loss_maker_val_fallback: list[tuple[str, float]]
```

**pillar_weights** always sum to 100. The three formula dicts (quality, valuation, momentum) also each sum to 100 — they weight individual metrics *within* the pillar.

### 3.2 Example — Private Banks

```python
"bfsi_pvt_banks": Scorecard(
    pillar_weights={"q": 50, "v": 30, "m": 20},
    quality={
        "roa_3y": 25, "roe_3y": 18, "book_value_cagr_5y": 18,
        "loan_book_cagr_3y": 14, "np_cagr_5y": 12,
        "interest_coverage": 8, "net_npa": 5
    },
    valuation={"pb": 50, "pe_ttm": 25, "ev_ebitda_ttm": 15, "div_yield": 10},
    momentum={"ret_12m_rel": 35, "ret_6m_rel": 25, "ret_3m_rel": 20,
               "pct_above_200ema_252d": 20},
    loss_maker_val_fallback=[("pb", 1.0)]
)
```

Banks weight Quality more heavily (50%) and use bank-specific metrics (NIM, NPA, loan book CAGR). A FMCG cluster would heavily weight gross margins and distribution reach instead.

### 3.3 Maturity Tiers

Each cluster scorecard automatically generates **four tier variants**:

| Tier | Logic | Who it applies to |
|---|---|---|
| **VETERAN** | +5% Quality (from Momentum); uses 10y CAGRs | Stocks with 10+ years of listing |
| **MATURE** | Base scorecard | Default; most listed NSE stocks |
| **MID** | −5% Quality, +5% Momentum; uses 3y CAGRs | Mid-sized companies |
| **NEW** | −15% Quality, +15% Momentum; drops all CAGRs | Recently listed or thin-history stocks |

Tier assignment happens at metric-computation time based on available data depth.

---

## 4. Metric Computation (`formulas.py` + `metrics.py`)

### 4.1 Formula Registry

`formulas.py` defines 90+ metric functions grouped into three pillars:

**Quality (22 active formulas)**
- Profitability: `roe_3y`, `roe_5y`, `roa_3y`, `roce_3y`, `roce_5y`
- Margins: `op_margin_3y`, `op_margin_latest`, `op_margin_trend`, `ebitda_margin_3y`
- Growth: `rev_cagr_3y/5y/7y/10y`, `np_cagr_3y/5y/7y/10y`
- Consistency: `np_consistency_3y/5y/7y/10y`, `roe_avg_above_threshold_5y/10y`
- Cash flow quality: `cfo_pat_3y`, `cfo_pat_latest`, `cfo_ebitda_3y`

**Valuation (7 active formulas)**
- `pe_ttm`, `pb`, `ev_ebitda_ttm`, `peg`, `fcf_yield`, `div_yield`, `earnings_yield_trend`
- Fallbacks for loss-makers: `ev_sales_ttm`, `p_aum` (NBFCs), `p_premium` (insurance)

**Momentum (8 active formulas)**
- Market-relative returns: `ret_3m_rel`, `ret_6m_rel`, `ret_12m_rel`
- Technical: `pct_above_200ema_252d`, `ema_stack_bull`, `tech_net_score_scaled`
- Earnings momentum: `sales_yoy_q`, `np_yoy_q`

### 4.2 Direction Convention

Each formula is decorated with `@_higher` or `@_lower`:

```python
@_higher   # higher ROE → better rank (percentile=100)
def roe_3y(annual, quarterly, meta, signals, nifty_returns): ...

@_lower    # lower P/E → better rank (lower is cheaper)
def pe_ttm(annual, quarterly, meta, signals, nifty_returns): ...
```

The `_percentile_rank()` function in `scorer.py` inverts ranks for `higher_is_better=False` metrics before computing percentiles.

### 4.3 Per-Stock Computation (`metrics.py`)

For each stock in a snapshot, `compute_metrics_for_symbol()`:
1. Loads annual/quarterly fundamentals from `app.fundamentals_*`
2. Loads 252-day price history and technical signals from `golden.*`
3. Computes Nifty returns (3m/6m/12m) as market benchmark for relative momentum
4. Calls every formula in the cluster's active scorecard
5. Returns a `cluster_metrics` JSONB dict: `{formula_id: value_or_null}`

---

## 5. Percentile Scoring (`scorer.py`)

### 5.1 Peer Bucket

Scoring is always **within a peer bucket**. Primary bucket = `(cluster_id, maturity_tier)`.

If a bucket has fewer than 10 stocks, the system falls back:
1. `(cluster_id, all_tiers)` → flagged `partial-cluster-mixed-tiers`
2. `(meta_cluster_id, maturity_tier)` → flagged `partial-meta-cluster`

The `score_status` column in `app.scores` records which bucket was used.

### 5.2 Percentile Rank Algorithm

```python
def _percentile_rank(values: list[float | None], higher_is_better: bool) -> list[float | None]:
    valid = [(i, v) for i, v in enumerate(values) if v is not None]
    n = len(valid)
    sorted_valid = sorted(valid, key=lambda x: x[1], reverse=higher_is_better)
    ranks = {}
    for rank, (i, _) in enumerate(sorted_valid):
        ranks[i] = round((1 - rank / (n - 1)) * 100) if n > 1 else 50
    return [ranks.get(i) for i in range(len(values))]
```

- Best stock = 100, worst = 1 (or 0 — adjusted based on n)
- Null values stay null (stock not penalized for missing data)
- Applied once per (formula, peer_bucket)

### 5.3 Loss-Maker Fallback

When `pe_ttm` is null (company reporting losses), `_splice_loss_maker_fallback()` substitutes alternative valuation metrics at the same weight:

| Cluster type | Fallback formula |
|---|---|
| Banks/NBFCs | `pb` (1.0 weight) |
| Insurance | `p_premium` (1.0 weight) |
| NBFCs (AUM-based) | `p_aum` (1.0 weight) |
| Tech, industrials | `ev_sales_ttm` (1.0) or `ev_sales_ttm` (0.6) + `pb` (0.4) |

This prevents loss-makers from being unfairly rated on a metric that doesn't apply to them.

### 5.4 Pillar Score Formula

```python
def _weighted_pillar_score(component_pcts: dict[str, float | None],
                            weights: dict[str, float]) -> float | None:
    total_w = 0
    total_score = 0
    for formula_id, pct in component_pcts.items():
        if pct is None:
            continue
        w = weights[formula_id]
        total_score += pct * w
        total_w += w
    if total_w == 0:
        return None
    return total_score / total_w   # renormalized across non-null components
```

If 3 of 8 quality formulas are null (missing data), the remaining 5 are re-weighted to sum to 100% internally. The stock is not penalized for missing metrics as long as ≥1 formula computes.

### 5.5 Composite (Industry Score) Computation

```
composite_raw = quality_pct * w_q + valuation_pct * w_v + momentum_pct * w_m
                (renormalized if any pillar is null)
```

The `composite_raw` values for all stocks in the peer bucket are then **re-percentiled** → `composite_pct` (0–100).

This double-percentiling ensures the final Industry Score distribution is always uniform across the cluster — not skewed by which pillar dominates.

---

## 6. Your Score — Custom Weighting

### 6.1 What it is

"Your Score" lets you set your own Q/V/M weights via sliders on `/discover`. It uses the **same three pillar percentiles** already stored in `app.scores` — it does NOT recompute raw metrics or run a new percentile pass.

### 6.2 Computation (SQL, server-side)

```sql
ROUND(
  (COALESCE(s.quality_pct, 0)   * :w_q +
   COALESCE(s.valuation_pct, 0) * :w_v +
   COALESCE(s.momentum_pct, 0)  * :w_m) / 100.0
)::int AS blend
```

- `:w_q + :w_v + :w_m = 100` (always enforced by the UI)
- Null pillar treated as 0 for the blend (not excluded)
- Result: 0–100, integer

### 6.3 Key Difference from Industry Score

| | Industry Score | Your Score |
|---|---|---|
| Weights | Cluster-tuned (e.g., Banks: Q=50/V=30/M=20) | Your slider setting |
| Re-percentiled? | Yes — double-percentile ensures uniform distribution | No — direct weighted average of pillar percentiles |
| Stored in DB? | Yes (`composite_pct` in `app.scores`) | No — computed per-request from stored pillar pcts |
| Use case | "How does this stock rank within its cluster by platform consensus?" | "How does this stock rank if I care more about value than quality?" |

### 6.4 Slider Auto-Renormalization (Controls.tsx)

The three weight sliders are coupled — they always sum to 100:

```typescript
// When user drags Quality slider to 60:
const other_sum_before = v + m          // e.g. 30 + 30 = 60
const other_sum_after = 100 - 60        // = 40
new_v = Math.round((v / other_sum_before) * other_sum_after)  // 20
new_m = 100 - 60 - new_v               // 20
```

### 6.5 Preset Weights

| Preset | Quality | Valuation | Momentum |
|---|---|---|---|
| Balanced | 40% | 30% | 30% |
| Compounders | 50% | 30% | 20% |
| Value | 30% | 50% | 20% |
| Momentum | 30% | 20% | 50% |

---

## 7. Score Bands (Display)

All scores 0–100 map to 5 color bands:

| Band | Range | Color token | Meaning |
|---|---|---|---|
| Excellent | ≥ 80 | `--color-score-excellent` (green) | Top 20% of peers |
| Good | 60–79 | `--color-score-good` (teal) | Above average |
| Neutral | 40–59 | `--color-score-neutral` (amber) | Middle of the pack |
| Weak | 20–39 | `--color-score-weak` (orange) | Below average |
| Poor | < 20 | `--color-score-poor` (red) | Bottom 20% of peers |

---

## 8. Database Tables

```sql
-- Per-stock metric values (JSONB), written by ETL
app.metrics_snapshot (
    symbol          TEXT,
    snapshot_date   DATE,
    maturity_tier   TEXT,           -- veteran / mature / mid / new
    cluster_metrics JSONB,          -- {formula_id: numeric_value_or_null}
    market_cap      NUMERIC,
    current_price   NUMERIC,
    score_status    TEXT
)

-- Pillar + composite percentile scores, written by ETL scorer
app.scores (
    symbol              TEXT,
    snapshot_date       DATE,
    cluster_id          TEXT,
    maturity_tier       TEXT,
    quality_pct         NUMERIC,    -- 0-100, percentile within peer bucket
    valuation_pct       NUMERIC,
    momentum_pct        NUMERIC,
    composite_pct       NUMERIC,    -- Industry Score (re-percentiled blend)
    quality_components  JSONB,      -- {formula_id: percentile_value}
    valuation_components JSONB,
    momentum_components JSONB,
    score_status        TEXT        -- full | partial-cluster-mixed-tiers | partial-meta-cluster
)

-- Cluster-level scorecard overrides (admin-editable via /admin/scorecards)
app.cluster_scorecard_active (
    cluster_id          TEXT PRIMARY KEY,
    pillar_weights      JSONB,      -- {"q": 50, "v": 30, "m": 20}
    quality             JSONB,      -- {formula_id: weight}
    valuation           JSONB,
    momentum            JSONB,
    loss_maker_val_fallback JSONB
)

-- Live prices (updated daily by GitHub Action via NSE bhavcopy)
app.screener_meta (
    symbol          TEXT PRIMARY KEY,
    current_price   NUMERIC,
    market_cap_cr   NUMERIC,
    face_value      NUMERIC,
    no_of_shares    BIGINT
)
```

---

## 9. ETL Commands

```bash
# Compute metrics + scores for a new snapshot
./fetch                          # full universe (~50–60 min, 2150 stocks)
./fetch --limit 100              # smoke test (first 100 stocks)
./fetch --only TCS,INFY,HDFC     # specific symbols

./snap                           # run scorer.py on latest metrics (fast, ~2 min)

# Sync latest snapshot to production Neon
scripts/sync-neon.sh             # idempotent; syncs Nifty 200 subset only
```

---

## 10. Limitations & Known Trade-offs

| Limitation | Reason / Workaround |
|---|---|
| Your Score is NOT re-percentiled | Doing so would require a server-side re-rank pass per request; the current approach is instant from stored pillars |
| Null pillar treated as 0 in blend | A stock with no valuation data gets unfairly penalized when V weight is high; use score_status to filter |
| Thin peer buckets (<10) use fallback groups | Emerging clusters may mix-compare tiers; check `score_status` column |
| ETL is weekly manual | Full fetch takes ~60 min; GitHub Action only refreshes current prices daily |
| Banking-specific metrics (NIM, NPA) | Scraped from Screener xlsx; not available for all banks if Screener's export is incomplete |
