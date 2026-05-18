"""Formula library — every named metric in docs/scorecards.md as a Python function.

Each formula receives:
  - `annual`: list[dict] of annual rows ordered oldest -> newest (period_end ascending)
  - `quarterly`: list[dict] ordered ascending
  - `meta`: dict with current_price, market_cap_cr, etc.
  - `signals`: dict with latest indicator row (golden.indicators.daily_signals)
  - `nifty_returns`: dict with keys '3m','6m','12m' (Nifty's returns over those windows)

and returns a single numeric value or None if not computable.

`HIGHER_IS_BETTER` flag (set on the function) drives percentile direction.
"""
from __future__ import annotations

import math
from statistics import mean, pstdev
from typing import Any


def _higher(fn):
    fn.higher_is_better = True
    return fn


def _lower(fn):
    fn.higher_is_better = False
    return fn


def _last_n(annual: list[dict], n: int, key: str) -> list[float] | None:
    if len(annual) < n:
        return None
    vals = [r.get(key) for r in annual[-n:]]
    if any(v is None for v in vals):
        return None
    return [float(v) for v in vals]


def _cagr(start: float, end: float, years: int) -> float | None:
    if start is None or end is None or years <= 0:
        return None
    if start <= 0 or end <= 0:
        return None
    return (end / start) ** (1.0 / years) - 1.0


def _ols_slope(values: list[float]) -> float | None:
    """Slope of the line that best fits y=values vs x=0..n-1. None if too few points."""
    n = len(values)
    if n < 3:
        return None
    xs = list(range(n))
    x_mean = sum(xs) / n
    y_mean = sum(values) / n
    num = sum((xs[i] - x_mean) * (values[i] - y_mean) for i in range(n))
    den = sum((xs[i] - x_mean) ** 2 for i in range(n))
    return num / den if den else None


def _cv(values: list[float]) -> float | None:
    """Coefficient of variation. None if mean is zero/very small."""
    if not values:
        return None
    m = mean(values)
    if abs(m) < 1e-9:
        return None
    return pstdev(values) / abs(m)


def _safe_div(num, den):
    if num is None or den is None or den == 0:
        return None
    return num / den


def _ttm_sum(quarterly: list[dict], key: str, n: int = 4) -> float | None:
    if len(quarterly) < n:
        # Annualize from what we have
        if not quarterly:
            return None
        vals = [r.get(key) for r in quarterly]
        if any(v is None for v in vals):
            return None
        return sum(vals) * (n / len(vals))
    vals = [r.get(key) for r in quarterly[-n:]]
    if any(v is None for v in vals):
        return None
    return sum(float(v) for v in vals)


# ---------- PROFITABILITY ----------------------------------------------

@_higher
def roe_3y(annual, quarterly, meta, signals, nifty_returns):
    rows = annual[-3:] if len(annual) >= 3 else None
    if not rows:
        return None
    pairs = [(r.get("net_profit"), (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0))
             for r in rows]
    pairs = [(np_, eq) for np_, eq in pairs if np_ is not None and eq and eq > 0]
    if not pairs:
        return None
    return mean(np_ / eq for np_, eq in pairs)


@_higher
def roe_5y(annual, *_):
    rows = annual[-5:] if len(annual) >= 5 else None
    if not rows:
        return None
    pairs = [(r.get("net_profit"), (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0))
             for r in rows]
    pairs = [(np_, eq) for np_, eq in pairs if np_ is not None and eq and eq > 0]
    return mean(np_ / eq for np_, eq in pairs) if pairs else None


@_higher
def roe_7y(annual, *_):
    rows = annual[-7:] if len(annual) >= 7 else None
    if not rows:
        return None
    pairs = [(r.get("net_profit"), (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0))
             for r in rows]
    pairs = [(np_, eq) for np_, eq in pairs if np_ is not None and eq and eq > 0]
    return mean(np_ / eq for np_, eq in pairs) if pairs else None


@_higher
def roe_latest(annual, *_):
    if not annual:
        return None
    r = annual[-1]
    eq = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
    return _safe_div(r.get("net_profit"), eq) if eq > 0 else None


@_higher
def roa_3y(annual, *_):
    rows = annual[-3:]
    if len(rows) < 3:
        return None
    pairs = [(r.get("net_profit"), r.get("total_assets")) for r in rows]
    pairs = [(np_, ta) for np_, ta in pairs if np_ is not None and ta and ta > 0]
    return mean(np_ / ta for np_, ta in pairs) if len(pairs) >= 2 else None


@_higher
def roce_3y(annual, *_):
    rows = annual[-3:]
    if len(rows) < 3:
        return None
    out = []
    for r in rows:
        eq = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
        cap = eq + (r.get("borrowings") or 0)
        if cap <= 0:
            continue
        ebit = (r.get("profit_before_tax") or 0) + (r.get("interest") or 0)
        out.append(ebit / cap)
    return mean(out) if len(out) >= 2 else None


@_higher
def roce_5y(annual, *_):
    rows = annual[-5:]
    if len(rows) < 5:
        return None
    out = []
    for r in rows:
        eq = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
        cap = eq + (r.get("borrowings") or 0)
        if cap <= 0:
            continue
        ebit = (r.get("profit_before_tax") or 0) + (r.get("interest") or 0)
        out.append(ebit / cap)
    return mean(out) if len(out) >= 3 else None


@_higher
def roce_7y(annual, *_):
    rows = annual[-7:]
    if len(rows) < 7:
        return None
    out = []
    for r in rows:
        eq = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
        cap = eq + (r.get("borrowings") or 0)
        if cap <= 0:
            continue
        ebit = (r.get("profit_before_tax") or 0) + (r.get("interest") or 0)
        out.append(ebit / cap)
    return mean(out) if len(out) >= 5 else None


@_higher
def roce_latest(annual, *_):
    if not annual:
        return None
    r = annual[-1]
    eq = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
    cap = eq + (r.get("borrowings") or 0)
    if cap <= 0:
        return None
    ebit = (r.get("profit_before_tax") or 0) + (r.get("interest") or 0)
    return ebit / cap


# ---------- MARGIN ------------------------------------------------------

@_higher
def op_margin_3y(annual, *_):
    rows = annual[-3:]
    pairs = [(r.get("operating_profit"), r.get("sales")) for r in rows]
    pairs = [(op, s) for op, s in pairs if op is not None and s and s > 0]
    return mean(op / s for op, s in pairs) if len(pairs) >= 2 else None


@_higher
def op_margin_5y(annual, *_):
    rows = annual[-5:]
    if len(rows) < 5:
        return None
    pairs = [(r.get("operating_profit"), r.get("sales")) for r in rows]
    pairs = [(op, s) for op, s in pairs if op is not None and s and s > 0]
    return mean(op / s for op, s in pairs) if len(pairs) >= 3 else None


@_higher
def op_margin_7y(annual, *_):
    rows = annual[-7:]
    if len(rows) < 7:
        return None
    pairs = [(r.get("operating_profit"), r.get("sales")) for r in rows]
    pairs = [(op, s) for op, s in pairs if op is not None and s and s > 0]
    return mean(op / s for op, s in pairs) if len(pairs) >= 5 else None


@_higher
def op_margin_latest(annual, *_):
    if not annual:
        return None
    r = annual[-1]
    return _safe_div(r.get("operating_profit"), r.get("sales"))


@_higher
def op_margin_trend(annual, *_):
    """OLS slope of yearly OPM over last 5 years (or fewer if mid tier)."""
    rows = annual[-5:]
    series = []
    for r in rows:
        s = r.get("sales")
        op = r.get("operating_profit")
        if s and s > 0 and op is not None:
            series.append(op / s)
    return _ols_slope(series)


@_higher
def op_margin_trend_3y(annual, *_):
    rows = annual[-3:]
    series = []
    for r in rows:
        s = r.get("sales")
        op = r.get("operating_profit")
        if s and s > 0 and op is not None:
            series.append(op / s)
    return _ols_slope(series)


@_higher
def op_margin_trend_7y(annual, *_):
    rows = annual[-7:]
    series = []
    for r in rows:
        s = r.get("sales")
        op = r.get("operating_profit")
        if s and s > 0 and op is not None:
            series.append(op / s)
    return _ols_slope(series)


@_higher
def gross_margin_3y(annual, *_):
    """(Sales - RM Cost) / Sales averaged. RM cost not in our parsed schema yet → None for v1."""
    # Placeholder — requires extending parser to capture raw_material_cost row.
    return None


@_higher
def gross_margin_5y(annual, *_):
    return None


@_higher
def gross_margin_latest(annual, *_):
    return None


@_higher
def gross_margin_trend(annual, *_):
    return None


@_higher
def ebitda_margin_3y(annual, *_):
    rows = annual[-3:]
    pairs = []
    for r in rows:
        s = r.get("sales")
        if not s or s <= 0:
            continue
        ebitda = (r.get("operating_profit") or 0) + (r.get("depreciation") or 0)
        pairs.append(ebitda / s)
    return mean(pairs) if len(pairs) >= 2 else None


# ---------- GROWTH ------------------------------------------------------

def _cagr_from_window(annual, key, years):
    """`years` = number of YEARS of annual data we need.
    CAGR is computed over (years - 1) periods (Indian financial-data convention,
    matching Screener: '10-year CAGR' = first to last of 10 annual data points).
    """
    if len(annual) < years:
        return None
    span = years - 1
    if span <= 0:
        return None
    start = annual[-years].get(key)
    end = annual[-1].get(key)
    return _cagr(start, end, span)


@_higher
def rev_cagr_3y(annual, *_):
    return _cagr_from_window(annual, "sales", 3)


@_higher
def rev_cagr_5y(annual, *_):
    return _cagr_from_window(annual, "sales", 5)


@_higher
def rev_cagr_7y(annual, *_):
    return _cagr_from_window(annual, "sales", 7)


@_higher
def rev_cagr_10y(annual, *_):
    return _cagr_from_window(annual, "sales", 10)


@_higher
def np_cagr_3y(annual, *_):
    return _cagr_from_window(annual, "net_profit", 3)


@_higher
def np_cagr_5y(annual, *_):
    return _cagr_from_window(annual, "net_profit", 5)


@_higher
def np_cagr_7y(annual, *_):
    return _cagr_from_window(annual, "net_profit", 7)


@_higher
def np_cagr_10y(annual, *_):
    return _cagr_from_window(annual, "net_profit", 10)


@_higher
def rev_yoy_latest(annual, *_):
    if len(annual) < 2:
        return None
    a, b = annual[-2].get("sales"), annual[-1].get("sales")
    if a is None or b is None or abs(a) < 1e-6:
        return None
    return (b - a) / abs(a)


@_higher
def np_yoy_latest(annual, *_):
    if len(annual) < 2:
        return None
    a, b = annual[-2].get("net_profit"), annual[-1].get("net_profit")
    if a is None or b is None or abs(a) < 1e-6:
        return None
    return (b - a) / abs(a)


# ---------- CONSISTENCY ------------------------------------------------

def _np_consistency(annual: list[dict], window: int) -> float | None:
    rows = annual[-window:]
    if len(rows) < window:
        return None
    nps = [r.get("net_profit") for r in rows]
    if any(v is None for v in nps):
        return None
    pos = sum(1 for v in nps if v > 0) / window
    cv = _cv(nps)
    cv_term = 1 / (1 + cv) if cv is not None else 0.5
    return pos + cv_term


@_higher
def np_consistency_3y(annual, *_):
    return _np_consistency(annual, 3)


@_higher
def np_consistency_5y(annual, *_):
    return _np_consistency(annual, 5)


@_higher
def np_consistency_7y(annual, *_):
    return _np_consistency(annual, 7)


@_higher
def np_consistency_10y(annual, *_):
    return _np_consistency(annual, 10)


@_higher
def roe_avg_above_threshold_5y(annual, *_):
    """Share of last 5y where ROE > 15%."""
    rows = annual[-5:]
    if len(rows) < 5:
        return None
    out = 0
    for r in rows:
        eq = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
        if eq <= 0:
            continue
        np_ = r.get("net_profit")
        if np_ is None:
            continue
        if (np_ / eq) > 0.15:
            out += 1
    return out / 5


@_higher
def roe_avg_above_threshold_7y(annual, *_):
    """Share of last 7y where ROE > 15%."""
    rows = annual[-7:]
    if len(rows) < 7:
        return None
    out = 0
    for r in rows:
        eq = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
        if eq <= 0:
            continue
        np_ = r.get("net_profit")
        if np_ is None:
            continue
        if (np_ / eq) > 0.15:
            out += 1
    return out / 7


@_higher
def roe_avg_above_threshold_10y(annual, *_):
    rows = annual[-10:]
    if len(rows) < 10:
        return None
    out = 0
    for r in rows:
        eq = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
        if eq <= 0:
            continue
        np_ = r.get("net_profit")
        if np_ is None:
            continue
        if (np_ / eq) > 0.15:
            out += 1
    return out / 10


def _np_growth_above_inflation(annual: list[dict], window: int) -> float | None:
    """Share of YoY periods in last `window` years where NP grew > 6%."""
    rows = annual[-window:]
    if len(rows) < window:
        return None
    growths = []
    for i in range(1, len(rows)):
        a, b = rows[i - 1].get("net_profit"), rows[i].get("net_profit")
        if a is None or b is None or abs(a) < 1e-6:
            continue
        growths.append((b - a) / abs(a))
    # Need at least window-3 valid YoY comparisons to avoid noise
    min_valid = max(2, window - 3)
    if len(growths) < min_valid:
        return None
    return sum(1 for g in growths if g > 0.06) / len(growths)


@_higher
def np_growth_above_inflation_5y(annual, *_):
    return _np_growth_above_inflation(annual, 5)


@_higher
def np_growth_above_inflation_7y(annual, *_):
    return _np_growth_above_inflation(annual, 7)


@_higher
def np_growth_above_inflation_10y(annual, *_):
    return _np_growth_above_inflation(annual, 10)


# ---------- BOOK VALUE ----------------------------------------------------

@_higher
def book_value_cagr_5y(annual, *_):
    return _cagr_from_window_book(annual, 5)


@_higher
def book_value_cagr_7y(annual, *_):
    return _cagr_from_window_book(annual, 7)


@_higher
def book_value_cagr_10y(annual, *_):
    return _cagr_from_window_book(annual, 10)


@_higher
def book_value_cagr_3y(annual, *_):
    return _cagr_from_window_book(annual, 3)


def _cagr_from_window_book(annual, years):
    if len(annual) < years:
        return None
    span = years - 1
    if span <= 0:
        return None
    s = annual[-years]
    e = annual[-1]
    bv0 = (s.get("equity_share_capital") or 0) + (s.get("reserves") or 0)
    bv1 = (e.get("equity_share_capital") or 0) + (e.get("reserves") or 0)
    return _cagr(bv0, bv1, span)


# ---------- LOAN BOOK (lender proxy) -----------------------------------

@_higher
def loan_book_cagr_3y(annual, *_):
    """Banks: total assets is a better proxy than 'other_assets'.
    Uses 4 data points = 3-year compound period."""
    if len(annual) < 4:
        return None
    s = annual[-4].get("total_assets")
    e = annual[-1].get("total_assets")
    return _cagr(s, e, 3)


# ---------- LEVERAGE & COVERAGE ---------------------------------------

@_lower
def debt_equity(annual, *_):
    """Latest year d/e."""
    if not annual:
        return None
    r = annual[-1]
    eq = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
    if eq <= 0:
        return None
    return _safe_div(r.get("borrowings"), eq)


@_lower
def net_debt_ebitda(annual, quarterly, meta, signals, nifty_returns):
    if not annual:
        return None
    r = annual[-1]
    ebitda_ttm = _ttm_sum(quarterly, "operating_profit")  # use op_profit; no quarterly dep
    if ebitda_ttm is None:
        ebitda = (r.get("operating_profit") or 0) + (r.get("depreciation") or 0)
        ebitda_ttm = ebitda
    if ebitda_ttm <= 0:
        return None
    nd = (r.get("borrowings") or 0) - (r.get("cash_and_bank") or 0)
    return nd / ebitda_ttm


@_higher
def equity_to_assets(annual, *_):
    rows = annual[-3:]
    pairs = []
    for r in rows:
        ta = r.get("total_assets")
        if not ta or ta <= 0:
            continue
        eq = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
        pairs.append(eq / ta)
    return mean(pairs) if pairs else None


@_higher
def interest_coverage(annual, *_):
    if not annual:
        return None
    r = annual[-1]
    intr = r.get("interest")
    if not intr or intr <= 0:
        return None
    val = ((r.get("profit_before_tax") or 0) + intr) / intr
    return min(val, 50)


# ---------- CASH FLOW QUALITY -----------------------------------------

@_higher
def cfo_pat_3y(annual, *_):
    rows = annual[-3:]
    out = []
    for r in rows:
        np_ = r.get("net_profit")
        cfo = r.get("cash_from_operating")
        if np_ is None or cfo is None or np_ <= 0:
            continue
        out.append(max(0, min(cfo / np_, 3)))
    return mean(out) if len(out) >= 2 else None


@_higher
def cfo_pat_latest(annual, *_):
    if not annual:
        return None
    r = annual[-1]
    np_ = r.get("net_profit")
    cfo = r.get("cash_from_operating")
    if np_ is None or cfo is None or np_ <= 0:
        return None
    return max(0, min(cfo / np_, 3))


@_higher
def cfo_ebitda_3y(annual, *_):
    rows = annual[-3:]
    out = []
    for r in rows:
        cfo = r.get("cash_from_operating")
        ebitda = (r.get("operating_profit") or 0) + (r.get("depreciation") or 0)
        if cfo is None or ebitda <= 0:
            continue
        out.append(max(0, min(cfo / ebitda, 2)))
    return mean(out) if len(out) >= 2 else None


@_higher
def cfo_sales_3y(annual, *_):
    rows = annual[-3:]
    out = []
    for r in rows:
        s = r.get("sales")
        cfo = r.get("cash_from_operating")
        if s is None or s <= 0 or cfo is None:
            continue
        out.append(cfo / s)
    return mean(out) if len(out) >= 2 else None


# ---------- WORKING CAPITAL -------------------------------------------

@_lower
def wc_days(annual, *_):
    if not annual:
        return None
    r = annual[-1]
    s = r.get("sales")
    if not s or s <= 0:
        return None
    wc = (r.get("receivables") or 0) + (r.get("inventory") or 0) - (r.get("other_liabilities") or 0)
    return wc * 365 / s


@_lower
def dso(annual, *_):
    if not annual:
        return None
    r = annual[-1]
    s = r.get("sales")
    if not s or s <= 0:
        return None
    return (r.get("receivables") or 0) * 365 / s


@_lower
def inv_days(annual, *_):
    if not annual:
        return None
    r = annual[-1]
    s = r.get("sales")
    if not s or s <= 0:
        return None
    return (r.get("inventory") or 0) * 365 / s


# ---------- ASSETS / CAPEX --------------------------------------------

@_higher
def asset_turnover(annual, *_):
    if not annual:
        return None
    r = annual[-1]
    return _safe_div(r.get("sales"), r.get("total_assets"))


@_lower
def capex_intensity_3y(annual, *_):
    if len(annual) < 4:
        return None
    out = []
    for i in range(len(annual) - 3, len(annual)):
        prev, cur = annual[i - 1], annual[i]
        s = cur.get("sales")
        if not s or s <= 0:
            continue
        d_nb = (cur.get("net_block") or 0) - (prev.get("net_block") or 0)
        d_cwip = (cur.get("cwip") or 0) - (prev.get("cwip") or 0)
        out.append((d_nb + d_cwip) / s)
    return mean(out) if len(out) >= 2 else None


# ---------- VALUATION (need market_cap from meta) --------------------

@_lower
def pe_ttm(annual, quarterly, meta, signals, nifty_returns):
    mc = meta.get("market_cap_cr")
    np_ttm = _ttm_sum(quarterly, "net_profit")
    if mc is None or np_ttm is None or np_ttm <= 0:
        return None
    return mc / np_ttm


@_lower
def pb(annual, quarterly, meta, signals, nifty_returns):
    mc = meta.get("market_cap_cr")
    if mc is None or not annual:
        return None
    r = annual[-1]
    bv = (r.get("equity_share_capital") or 0) + (r.get("reserves") or 0)
    if bv <= 0:
        return None
    return mc / bv


@_lower
def ev_ebitda_ttm(annual, quarterly, meta, signals, nifty_returns):
    mc = meta.get("market_cap_cr")
    if mc is None or not annual:
        return None
    r = annual[-1]
    borr = r.get("borrowings") or 0
    cash = r.get("cash_and_bank") or 0
    op_ttm = _ttm_sum(quarterly, "operating_profit")
    # Approx EBITDA: add back annual-rate dep based on latest year to op_ttm
    if op_ttm is None or op_ttm <= 0:
        return None
    dep = r.get("depreciation") or 0
    ebitda_ttm = op_ttm + dep  # depreciation roughly steady year-over-year
    if ebitda_ttm <= 0:
        return None
    ev = mc + borr - cash
    return ev / ebitda_ttm


@_lower
def peg(annual, quarterly, meta, signals, nifty_returns):
    p = pe_ttm(annual, quarterly, meta, signals, nifty_returns)
    g = np_cagr_5y(annual)  # use 5y CAGR
    if p is None or g is None or g <= 0:
        return None
    return p / (g * 100)


@_higher
def fcf_yield(annual, quarterly, meta, signals, nifty_returns):
    mc = meta.get("market_cap_cr")
    if mc is None or len(annual) < 4:
        return None
    cfos = [r.get("cash_from_operating") for r in annual[-3:]]
    if any(v is None for v in cfos):
        return None
    cfo_3y_avg = mean(cfos)
    # capex 3y avg
    capex = []
    for i in range(len(annual) - 3, len(annual)):
        prev, cur = annual[i - 1], annual[i]
        d_nb = (cur.get("net_block") or 0) - (prev.get("net_block") or 0)
        d_cwip = (cur.get("cwip") or 0) - (prev.get("cwip") or 0)
        capex.append(d_nb + d_cwip)
    capex_avg = mean(capex) if capex else 0
    fcf = cfo_3y_avg - capex_avg
    return fcf / mc


@_higher
def div_yield(annual, quarterly, meta, signals, nifty_returns):
    mc = meta.get("market_cap_cr")
    if mc is None or not annual:
        return None
    div = annual[-1].get("dividend_amount")
    if div is None:
        return None
    return div / mc


@_higher
def earnings_yield_trend(annual, quarterly, meta, signals, nifty_returns):
    """OLS slope of yearly earnings yield over last 5 years."""
    rows = annual[-5:]
    if len(rows) < 5:
        return None
    yields = []
    for r in rows:
        np_ = r.get("net_profit")
        price = r.get("annual_close_price")
        shares = r.get("no_of_equity_shares")
        if np_ is None or price is None or shares is None or shares <= 0:
            continue
        # mc proxy = price × shares (shares reported in absolute count, price in INR)
        # We want a unit-less ratio.
        eps = np_ * 1e7 / shares  # net profit in cr → INR; divided by shares
        ey = eps / price
        yields.append(ey)
    return _ols_slope(yields) if len(yields) >= 4 else None


# ---------- VALUATION FALLBACKS (loss-makers) -------------------------

@_lower
def ev_sales_ttm(annual, quarterly, meta, signals, nifty_returns):
    mc = meta.get("market_cap_cr")
    if mc is None or not annual:
        return None
    r = annual[-1]
    borr = r.get("borrowings") or 0
    cash = r.get("cash_and_bank") or 0
    sales_ttm = _ttm_sum(quarterly, "sales")
    if sales_ttm is None or sales_ttm <= 0:
        return None
    return (mc + borr - cash) / sales_ttm


@_lower
def p_aum(annual, quarterly, meta, signals, nifty_returns):
    """Mc / Other Assets — NBFC AUM proxy."""
    mc = meta.get("market_cap_cr")
    if mc is None or not annual:
        return None
    oa = annual[-1].get("other_assets")
    if oa is None or oa <= 0:
        return None
    return mc / oa


@_lower
def p_premium(annual, quarterly, meta, signals, nifty_returns):
    """Insurance: mc / TTM premium = mc / TTM sales."""
    mc = meta.get("market_cap_cr")
    sales_ttm = _ttm_sum(quarterly, "sales")
    if mc is None or sales_ttm is None or sales_ttm <= 0:
        return None
    return mc / sales_ttm


# ---------- MOMENTUM (price + earnings) -------------------------------

@_higher
def ret_3m_rel(annual, quarterly, meta, signals, nifty_returns):
    r = meta.get("ret_3m")
    n = nifty_returns.get("3m") if nifty_returns else None
    return None if r is None or n is None else r - n


@_higher
def ret_6m_rel(annual, quarterly, meta, signals, nifty_returns):
    r = meta.get("ret_6m")
    n = nifty_returns.get("6m") if nifty_returns else None
    return None if r is None or n is None else r - n


@_higher
def ret_12m_rel(annual, quarterly, meta, signals, nifty_returns):
    r = meta.get("ret_12m")
    n = nifty_returns.get("12m") if nifty_returns else None
    return None if r is None or n is None else r - n


@_higher
def pct_above_200ema_252d(annual, quarterly, meta, signals, nifty_returns):
    return meta.get("pct_above_200ema_252d")


@_higher
def ema_stack_bull(annual, quarterly, meta, signals, nifty_returns):
    if not signals:
        return None
    v = signals.get("ema_stack")
    return 1.0 if v else 0.0


@_higher
def tech_net_score_scaled(annual, quarterly, meta, signals, nifty_returns):
    if not signals:
        return None
    return signals.get("net_score")


@_higher
def sales_yoy_q(annual, quarterly, meta, signals, nifty_returns):
    """Latest quarter sales vs same quarter previous year (need 5 quarters)."""
    if len(quarterly) < 5:
        return None
    cur = quarterly[-1].get("sales")
    yoy = quarterly[-5].get("sales")
    if cur is None or yoy is None or abs(yoy) < 1e-6:
        return None
    return (cur - yoy) / abs(yoy)


@_higher
def np_yoy_q(annual, quarterly, meta, signals, nifty_returns):
    if len(quarterly) < 5:
        return None
    cur = quarterly[-1].get("net_profit")
    yoy = quarterly[-5].get("net_profit")
    if cur is None or yoy is None or abs(yoy) < 1e-6:
        return None
    return (cur - yoy) / abs(yoy)


# ---------- REGISTRY ---------------------------------------------------

# Build a registry by name for the scorecards module to look up.
import sys as _sys

_module = _sys.modules[__name__]
REGISTRY: dict[str, Any] = {
    name: getattr(_module, name)
    for name in dir(_module)
    if not name.startswith("_")
       and callable(getattr(_module, name))
       and hasattr(getattr(_module, name), "higher_is_better")
}


def get(name: str):
    if name not in REGISTRY:
        raise KeyError(f"Unknown formula: {name}")
    return REGISTRY[name]
