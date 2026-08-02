"""READ-ONLY prototype: does run-rate-penalized valuation move NATCOPHARM off #1?

Option #1 from the discussion: for lower-is-better valuation ratios built on a
trailing-12-month earnings base (pe_ttm, ev_ebitda_ttm, peg via pe), replace the
TTM denominator with min(TTM, run_rate) where run_rate annualizes the latest N
quarters. When recent quarters have collapsed below the TTM average (windfall
decaying out of the trailing window), this yields a LESS favorable (higher) ratio.

Nothing is written to any DB. We reuse the real scorer helpers + live scorecard so
the percentile/blend math matches production exactly. Only the valuation pillar is
recomputed; quality and momentum pillars are taken as-is from app.scores (they are
unaffected by this change).
"""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row

from fundamental_etl.scoring.scorer import (
    _percentile_rank, _weighted_pillar_score, _shrink_toward_50,
)
from fundamental_etl.scoring.scorecards import get_scorecard_from, load_db_overrides
from fundamental_etl.scoring.formulas import REGISTRY as FORMULAS

CLUSTER = "pharma"
TIER = "veteran"
RUNRATE_Q = 2  # annualize the latest N quarters as the run-rate

conn = psycopg.connect("dbname=fundamental_app", row_factory=dict_row)
ov = load_db_overrides(conn)
sc = get_scorecard_from(ov, CLUSTER, TIER)

with conn.cursor() as cur:
    cur.execute("SELECT MAX(snapshot_date) AS d FROM app.scores")
    SNAP = cur.fetchone()["d"]

# Pharma-veteran pool: stored pillar scores + stored metrics + market cap.
with conn.cursor() as cur:
    cur.execute(
        """
        SELECT s.symbol, s.quality_pct, s.momentum_pct, s.valuation_pct,
               s.composite_pct, m.cluster_metrics, m.market_cap
        FROM app.scores s
        JOIN app.metrics_snapshot m USING (symbol, snapshot_date)
        WHERE s.snapshot_date=%s AND s.cluster_id=%s AND s.maturity_tier=%s
        """,
        (SNAP, CLUSTER, TIER),
    )
    pool = cur.fetchall()

symbols = [r["symbol"] for r in pool]

# Raw quarterly + latest annual for the penalized recompute.
def load_raw(sym):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT net_profit, operating_profit, sales
               FROM app.fundamentals_quarterly WHERE symbol=%s
               ORDER BY period_end DESC LIMIT 4""",
            (sym,),
        )
        q = cur.fetchall()
        cur.execute(
            """SELECT borrowings, cash_and_bank, depreciation
               FROM app.fundamentals_annual WHERE symbol=%s
               ORDER BY period_end DESC LIMIT 1""",
            (sym,),
        )
        a = cur.fetchone() or {}
    return q, a


def f(x):
    return float(x) if x is not None else None


def ttm_and_rr(q, key):
    """Return (ttm_sum, runrate_annualized) for last-4 quarterly rows (desc)."""
    vals = [f(r[key]) for r in q]
    if any(v is None for v in vals) or len(vals) < 4:
        return None, None
    ttm = sum(vals)
    rr = sum(vals[:RUNRATE_Q]) / RUNRATE_Q * 4  # newest N annualized
    return ttm, rr


rows = []
for r in pool:
    cm = r["cluster_metrics"] or {}
    mc = f(r["market_cap"]) or (
        f(cm.get("pe_ttm")) and None
    )
    q, a = load_raw(r["symbol"])

    base = {k: (f(cm.get(k))) for k in
            ("pe_ttm", "ev_ebitda_ttm", "peg", "pb", "fcf_yield", "div_yield", "ev_sales_ttm")}
    pen = dict(base)

    if mc and len(q) == 4:
        np_ttm, np_rr = ttm_and_rr(q, "net_profit")
        op_ttm, op_rr = ttm_and_rr(q, "operating_profit")
        dep = f(a.get("depreciation")) or 0.0
        borr = f(a.get("borrowings")) or 0.0
        cash = f(a.get("cash_and_bank")) or 0.0
        ev = mc + borr - cash

        # pe_ttm penalized
        if np_ttm and np_ttm > 0:
            np_base = min(np_ttm, np_rr) if np_rr is not None else np_ttm
            if np_base > 0:
                pe_pen = mc / np_base
                pen["pe_ttm"] = pe_pen
                # peg scales with pe (same growth denominator)
                if base["peg"] is not None and base["pe_ttm"]:
                    pen["peg"] = base["peg"] * (pe_pen / base["pe_ttm"])
        # ev_ebitda penalized
        if op_ttm and op_ttm > 0:
            op_base = min(op_ttm, op_rr) if op_rr is not None else op_ttm
            eb = op_base + dep
            if eb > 0:
                pen["ev_ebitda_ttm"] = ev / eb

    rows.append({
        "symbol": r["symbol"],
        "q": r["quality_pct"], "m": r["momentum_pct"],
        "v_stored": r["valuation_pct"], "comp_stored": r["composite_pct"],
        "base": base, "pen": pen,
    })


def valuation_pillar(scenario_key):
    """Compute the shrunk valuation pillar percentile for every stock under a scenario."""
    comps = {}
    for fname in sc.valuation:
        fn = FORMULAS.get(fname)
        higher = bool(getattr(fn, "higher_is_better", True)) if fn else True
        vals = [rw[scenario_key].get(fname) for rw in rows]
        pcts = _percentile_rank(vals, higher_is_better=higher)
        comps[fname] = pcts
    n = len(rows)
    out = []
    for i in range(n):
        cp = {fname: comps[fname][i] for fname in sc.valuation}
        raw = _weighted_pillar_score(cp, sc.valuation)
        out.append(_shrink_toward_50(int(round(raw)), n) if raw is not None else None)
    return out


v_base = valuation_pillar("base")
v_pen = valuation_pillar("pen")

pw = sc.pillar_weights
def composite_raw(qp, vp, mp):
    ps = {"q": qp, "v": vp, "m": mp}
    valid = {k: pw[k] for k in ps if ps[k] is not None}
    if not valid:
        return None
    tot = sum(valid.values())
    return sum(ps[k] * (pw[k] / tot) for k in valid)

comp_base_raw = [composite_raw(rows[i]["q"], v_base[i], rows[i]["m"]) for i in range(len(rows))]
comp_pen_raw = [composite_raw(rows[i]["q"], v_pen[i], rows[i]["m"]) for i in range(len(rows))]
n = len(rows)
comp_base_pct = [_shrink_toward_50(p, n) for p in _percentile_rank(comp_base_raw, True)]
comp_pen_pct = [_shrink_toward_50(p, n) for p in _percentile_rank(comp_pen_raw, True)]

# Rank (1 = best) by penalized composite raw.
def ranks(raw):
    order = sorted(range(len(raw)), key=lambda i: (raw[i] is None, -(raw[i] or -1e9)))
    rk = {}
    for pos, i in enumerate(order):
        rk[i] = pos + 1
    return rk
rk_base = ranks(comp_base_raw)
rk_pen = ranks(comp_pen_raw)

# Report: sort by baseline composite raw desc, show the top of the cluster + NATCOPHARM.
idx_sorted = sorted(range(n), key=lambda i: -(comp_base_raw[i] or -1e9))
print(f"snapshot={SNAP}  cluster={CLUSTER}/{TIER}  n={n}  runrate_quarters={RUNRATE_Q}")
print(f"{'symbol':<12}{'val_base':>9}{'val_pen':>8}{'Δval':>6} | {'comp_base':>10}{'comp_pen':>9}{'Δcomp':>7} | {'rk_b':>5}{'rk_p':>5}")
print("-" * 88)
for i in idx_sorted[:12]:
    r = rows[i]
    dv = (v_pen[i] or 0) - (v_base[i] or 0)
    dc = (comp_pen_pct[i] or 0) - (comp_base_pct[i] or 0)
    star = "  <<<" if r["symbol"] == "NATCOPHARM" else ""
    print(f"{r['symbol']:<12}{v_base[i]!s:>9}{v_pen[i]!s:>8}{dv:>6.0f} | "
          f"{comp_base_pct[i]!s:>10}{comp_pen_pct[i]!s:>9}{dc:>7.0f} | "
          f"{rk_base[i]:>5}{rk_pen[i]:>5}{star}")

# Always show NATCOPHARM explicitly if it fell out of top 12.
ni = next(i for i in range(n) if rows[i]["symbol"] == "NATCOPHARM")
print("-" * 88)
print(f"NATCOPHARM: valuation {v_base[ni]}→{v_pen[ni]}, composite_pct {comp_base_pct[ni]}→{comp_pen_pct[ni]}, "
      f"rank {rk_base[ni]}→{rk_pen[ni]} of {n}")
print(f"  pe_ttm {rows[ni]['base']['pe_ttm']:.1f}→{rows[ni]['pen']['pe_ttm']:.1f}, "
      f"ev_ebitda {rows[ni]['base']['ev_ebitda_ttm']:.1f}→{rows[ni]['pen']['ev_ebitda_ttm']:.1f}, "
      f"peg {rows[ni]['base']['peg']:.2f}→{rows[ni]['pen']['peg']:.2f}")
