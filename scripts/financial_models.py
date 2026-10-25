#!/usr/bin/env python3
"""Deterministic Institutional Financial Models.

Layer 1 of the Financial Verdict Engine.
Pure mathematical, zero-hallucination quant formulas running over longitudinal
financial data from app.fundamentals_annual, app.fundamentals_quarterly,
app.metrics_snapshot, and app.cluster_metrics.

Models implemented:
  1. Piotroski F-Score (0-9)
  2. Altman Z''-Score (Emerging Market Solvency & Distress)
  3. Sloan Accrual Ratio (Forensic Earnings & Cash Quality)
  4. Buffett Owner Earnings & Cash Conversion (CFO/EBIT, FCF Yield)
  5. 10-Year Valuation Band Positioning (Percentile within historical cycle)
  6. Industry Sector Playbooks & Rules
"""

from __future__ import annotations

from typing import Any, Optional


# Sector cohort classifications
SECTOR_PLAYBOOKS = {
    "bfsi": {
        "clusters": {
            "bfsi_nbfc", "bfsi_psu_banks", "bfsi_pvt_banks",
            "bfsi_pvt_banks_large", "bfsi_pvt_banks_mid_small",
            "bfsi_sfb", "bfsi_insurance", "bfsi_housing_finance",
        },
        "name": "Banking & Financial Services",
        "primary_metrics": ["roa", "nim", "gnpa_pct", "nnpa_pct", "cost_to_income", "pb"],
        "cash_conversion_applicable": False,
        "altman_applicable": False,  # Altman Z is not calibrated for balance-sheet lenders
    },
    "capital_heavy": {
        "clusters": {
            "capital_goods", "metals_mining", "infrastructure", "cement",
            "power", "realty", "oil_gas", "chemicals", "auto_ancillary",
        },
        "name": "Capital Intensive & Cyclical",
        "primary_metrics": ["roce_latest", "debt_equity", "wc_days", "ev_ebitda"],
        "cash_conversion_applicable": True,
        "altman_applicable": True,
    },
    "consumer": {
        "clusters": {
            "fmcg", "consumer_durables", "retail", "footwear", "textiles",
            "hotels", "restaurants", "paints",
        },
        "name": "FMCG & Consumer Durables",
        "primary_metrics": ["opm_now", "cfo_op_latest", "wc_days", "pe_ttm"],
        "cash_conversion_applicable": True,
        "altman_applicable": True,
    },
    "tech_services": {
        "clusters": {
            "it_services", "it_large", "it_mid", "erd", "telecom_services",
        },
        "name": "IT & Knowledge Services",
        "primary_metrics": ["opm_now", "cfo_pat_3y", "pe_ttm"],
        "cash_conversion_applicable": True,
        "altman_applicable": True,
    },
    "platforms": {
        "clusters": {
            "capital_markets", "exchanges", "amc", "depositories", "internet_platforms",
        },
        "name": "Platform & Capital Market Infrastructure",
        "primary_metrics": ["opm_now", "cfo_pat_3y", "pe_ttm", "roce_3y"],
        "cash_conversion_applicable": True,
        "altman_applicable": True,
    },
}


def get_sector_playbook(cluster_id: Optional[str]) -> dict[str, Any]:
    """Return the sector playbook and rules for a given cluster_id."""
    if not cluster_id:
        return {
            "category": "general",
            "name": "General Industry",
            "cash_conversion_applicable": True,
            "altman_applicable": True,
        }
    for cat, cfg in SECTOR_PLAYBOOKS.items():
        if cluster_id in cfg["clusters"]:
            return {
                "category": cat,
                "name": cfg["name"],
                "cash_conversion_applicable": cfg["cash_conversion_applicable"],
                "altman_applicable": cfg["altman_applicable"],
                "primary_metrics": cfg.get("primary_metrics", []),
            }
    return {
        "category": "general",
        "name": "General Manufacturing & Services",
        "cash_conversion_applicable": True,
        "altman_applicable": True,
    }


def _val(row: Optional[dict], key: str) -> Optional[float]:
    """Extract and cast float safely from filing dictionary."""
    if not row:
        return None
    v = row.get(key)
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


# -------------------------------------------------------------------------
# 1. Piotroski F-Score (0 to 9)
# -------------------------------------------------------------------------

def compute_piotroski_f_score(annual_filings: list[dict]) -> dict[str, Any]:
    """Compute the 9-point Piotroski F-Score comparing latest 2 fiscal years.

    Tests:
      Profitability (4 pts):
        1. Net Income > 0 (Current year ROA > 0)
        2. Operating Cash Flow > 0
        3. Change in ROA > 0 (Year-over-year improvement)
        4. Accruals: CFO > Net Income (Quality of earnings test)
      Leverage & Liquidity (3 pts):
        5. Change in Leverage <= 0 (Borrowings / Total Assets did not increase)
        6. Change in Liquidity > 0 (Current ratio improved)
        7. No Share Dilution (Equity share count did not increase)
      Operating Efficiency (2 pts):
        8. Change in Gross/Operating Margin > 0
        9. Change in Asset Turnover > 0 (Sales / Total Assets improved)
    """
    if not annual_filings or len(annual_filings) < 2:
        return {
            "score": None,
            "max_score": 9,
            "category": "insufficient_history",
            "details": "Requires at least 2 full annual filings",
            "breakdown": {},
        }

    t0 = annual_filings[-1]  # Latest year
    t1 = annual_filings[-2]  # Prior year

    tests: dict[str, Optional[bool]] = {}

    # Extract required fields
    np0, np1 = _val(t0, "net_profit"), _val(t1, "net_profit")
    cfo0 = _val(t0, "cash_from_operating")
    ta0, ta1 = _val(t0, "total_assets"), _val(t1, "total_assets")
    borrow0, borrow1 = _val(t0, "borrowings"), _val(t1, "borrowings")
    shares0, shares1 = _val(t0, "no_of_equity_shares"), _val(t1, "no_of_equity_shares")
    sales0, sales1 = _val(t0, "sales"), _val(t1, "sales")
    op0, op1 = _val(t0, "operating_profit"), _val(t1, "operating_profit")

    # Working capital components
    rec0, rec1 = _val(t0, "receivables") or 0.0, _val(t1, "receivables") or 0.0
    inv0, inv1 = _val(t0, "inventory") or 0.0, _val(t1, "inventory") or 0.0
    cash0, cash1 = _val(t0, "cash_and_bank") or 0.0, _val(t1, "cash_and_bank") or 0.0
    liab0, liab1 = _val(t0, "other_liabilities"), _val(t1, "other_liabilities")

    # 1. Positive Net Income
    tests["positive_net_income"] = (np0 > 0) if np0 is not None else None

    # 2. Positive Operating Cash Flow
    tests["positive_cfo"] = (cfo0 > 0) if cfo0 is not None else None

    # 3. Higher ROA YoY
    if np0 is not None and np1 is not None and ta0 and ta1 and ta0 > 0 and ta1 > 0:
        roa0 = np0 / ta0
        roa1 = np1 / ta1
        tests["higher_roa"] = (roa0 > roa1)
    else:
        tests["higher_roa"] = None

    # 4. CFO > Net Income (Accrual Test: Cash exceeds accounting profit)
    if cfo0 is not None and np0 is not None:
        tests["cfo_exceeds_net_income"] = (cfo0 > np0)
    else:
        tests["cfo_exceeds_net_income"] = None

    # 5. Lower or Equal Long-Term Debt / Assets
    if borrow0 is not None and borrow1 is not None and ta0 and ta1 and ta0 > 0 and ta1 > 0:
        lev0 = borrow0 / ta0
        lev1 = borrow1 / ta1
        tests["leverage_improved"] = (lev0 <= lev1 + 0.001)
    else:
        tests["leverage_improved"] = None

    # 6. Liquidity (Current Ratio Proxy)
    ca0 = rec0 + inv0 + cash0
    ca1 = rec1 + inv1 + cash1
    if liab0 and liab1 and liab0 > 0 and liab1 > 0 and ca0 > 0 and ca1 > 0:
        cr0 = ca0 / liab0
        cr1 = ca1 / liab1
        tests["liquidity_improved"] = (cr0 > cr1)
    else:
        tests["liquidity_improved"] = None

    # 7. No Share Dilution
    if shares0 and shares1:
        tests["no_dilution"] = (shares0 <= shares1 * 1.01)  # 1% allowance for ESOPs
    else:
        # Fallback to equity_share_capital
        eq0, eq1 = _val(t0, "equity_share_capital"), _val(t1, "equity_share_capital")
        if eq0 and eq1:
            tests["no_dilution"] = (eq0 <= eq1 * 1.01)
        else:
            tests["no_dilution"] = True

    # 8. Operating / Gross Margin Improvement
    if op0 is not None and op1 is not None and sales0 and sales1 and sales0 > 0 and sales1 > 0:
        margin0 = op0 / sales0
        margin1 = op1 / sales1
        tests["margin_improved"] = (margin0 > margin1)
    else:
        tests["margin_improved"] = None

    # 9. Asset Turnover Improvement
    if sales0 and sales1 and ta0 and ta1 and ta0 > 0 and ta1 > 0:
        turn0 = sales0 / ta0
        turn1 = sales1 / ta1
        tests["asset_turnover_improved"] = (turn0 > turn1)
    else:
        tests["asset_turnover_improved"] = None

    # Calculate final score
    valid_tests = {k: v for k, v in tests.items() if v is not None}
    score = sum(1 for v in valid_tests.values() if v is True)

    if score >= 7:
        grade = "Strong Compounder (7-9)"
    elif score >= 5:
        grade = "Average / Sound (5-6)"
    else:
        grade = "Weak / Deteriorating (0-4)"

    return {
        "score": score,
        "max_score": len(valid_tests),
        "grade": grade,
        "tests": tests,
        "summary": f"{score}/{len(valid_tests)} ({grade})"
    }


# -------------------------------------------------------------------------
# 2. Altman Z''-Score (Emerging Market Solvency Model)
# -------------------------------------------------------------------------

def compute_altman_z_score(annual_filings: list[dict], cluster_id: Optional[str] = None) -> dict[str, Any]:
    """Compute Altman Z''-Score for Emerging Markets (Non-Financial companies).

    Formula:
      Z'' = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4
      X1 = Working Capital / Total Assets
      X2 = Retained Earnings / Total Assets
      X3 = Operating Profit (EBIT) / Total Assets
      X4 = Book Value of Equity / Total Liabilities

    Zones:
      Z'' > 2.60: Safe Zone (negligible bankruptcy risk)
      1.10 <= Z'' <= 2.60: Grey Zone (moderate financial distress / watch)
      Z'' < 1.10: Distress Zone (high bankruptcy / solvency risk)
    """
    playbook = get_sector_playbook(cluster_id)
    if not playbook["altman_applicable"]:
        return {
            "z_score": None,
            "zone": "Not Applicable",
            "summary": "Altman Z''-Score is not applicable for banking & finance companies",
            "applicable": False,
        }

    if not annual_filings:
        return {
            "z_score": None,
            "zone": "Insufficient Data",
            "summary": "No annual balance sheet filings available",
            "applicable": True,
        }

    latest = annual_filings[-1]
    ta = _val(latest, "total_assets")
    if not ta or ta <= 0:
        return {
            "z_score": None,
            "zone": "Insufficient Data",
            "summary": "Total assets missing or zero",
            "applicable": True,
        }

    # Components
    rec = _val(latest, "receivables") or 0.0
    inv = _val(latest, "inventory") or 0.0
    cash = _val(latest, "cash_and_bank") or 0.0
    liab = _val(latest, "other_liabilities") or 0.0
    borrow = _val(latest, "borrowings") or 0.0
    reserves = _val(latest, "reserves") or 0.0
    equity = _val(latest, "equity_share_capital") or 0.0
    ebit = _val(latest, "operating_profit") or 0.0

    current_assets = rec + inv + cash
    working_capital = current_assets - liab
    book_value_equity = equity + reserves
    total_liabilities = borrow + liab

    x1 = working_capital / ta
    x2 = reserves / ta
    x3 = ebit / ta
    x4 = (book_value_equity / total_liabilities) if total_liabilities > 0 else 5.0

    z_score = round(6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4, 2)

    if z_score > 2.60:
        zone = "Safe Zone"
        desc = "Negligible bankruptcy/solvency risk"
    elif z_score >= 1.10:
        zone = "Grey Zone"
        desc = "Moderate financial buffer; monitor debt maturity"
    else:
        zone = "Distress Zone"
        desc = "High solvency risk / weak capital structure"

    return {
        "z_score": z_score,
        "zone": zone,
        "description": desc,
        "applicable": True,
        "components": {
            "wc_to_assets": round(x1, 3),
            "retained_earnings_to_assets": round(x2, 3),
            "ebit_to_assets": round(x3, 3),
            "equity_to_liabilities": round(x4, 3),
        },
        "summary": f"{z_score} ({zone} — {desc})",
    }


# -------------------------------------------------------------------------
# 3. Sloan Accrual Ratio (Forensic Earnings Quality)
# -------------------------------------------------------------------------

def compute_sloan_accrual_ratio(annual_filings: list[dict], cluster_id: Optional[str] = None) -> dict[str, Any]:
    """Compute Sloan Accrual Ratio to detect artificial paper profits vs cash.

    Formula:
      Accrual Ratio = (Operating Profit - Cash Flow from Operations) / Total Assets

    Interpretation:
      Ratio < -0.05: Conservative accounting; cash generation substantially outpaces reported earnings.
      -0.05 <= Ratio <= +0.05: Balanced earnings quality; profits reflect collected cash.
      Ratio > +0.05: High Accruals warning; profits inflated by uncollected receivables/accruals.
    """
    playbook = get_sector_playbook(cluster_id)
    if not playbook["cash_conversion_applicable"]:
        return {
            "accrual_ratio": None,
            "status": "Not Applicable",
            "summary": "Accrual test not applicable to banking & balance-sheet lenders",
            "applicable": False,
        }

    if not annual_filings:
        return {
            "accrual_ratio": None,
            "status": "Insufficient Data",
            "summary": "No annual filings",
            "applicable": True,
        }

    latest = annual_filings[-1]
    ebit = _val(latest, "operating_profit")
    cfo = _val(latest, "cash_from_operating")
    ta = _val(latest, "total_assets")

    if ebit is None or cfo is None or not ta or ta <= 0:
        return {
            "accrual_ratio": None,
            "status": "Incomplete Data",
            "summary": "Missing operating profit, CFO, or total assets",
            "applicable": True,
        }

    accrual_ratio = round((ebit - cfo) / ta, 4)

    if accrual_ratio < -0.05:
        status = "High Cash Integrity (Conservative)"
        flag = "Good: Operating cash flow significantly exceeds reported earnings."
    elif accrual_ratio <= 0.05:
        status = "Normal / Balanced"
        flag = "Normal: Reported earnings match cash collections."
    else:
        status = "High Accruals Warning"
        flag = f"Warning: Accruals ratio of {accrual_ratio:+.1%} indicates profits are tied up in receivables or uncollected assets."

    return {
        "accrual_ratio": accrual_ratio,
        "status": status,
        "flag": flag,
        "applicable": True,
        "summary": f"{accrual_ratio:+.2f} ({status})"
    }


# -------------------------------------------------------------------------
# 4. Buffett Owner Earnings & Cash Conversion
# -------------------------------------------------------------------------

def compute_cash_conversion(annual_filings: list[dict], market_cap_cr: Optional[float] = None, cluster_id: Optional[str] = None) -> dict[str, Any]:
    """Compute 3-Year & Latest Cash Conversion, Capex Drag, and Free Cash Flow Yield."""
    playbook = get_sector_playbook(cluster_id)
    if not playbook["cash_conversion_applicable"]:
        return {
            "applicable": False,
            "summary": "Cash conversion metrics not applicable to lenders",
        }

    if not annual_filings:
        return {"applicable": True, "summary": "No annual filings available"}

    valid_years = [
        r for r in annual_filings
        if _val(r, "cash_from_operating") is not None
        and _val(r, "operating_profit") not in (None, 0)
        and _val(r, "operating_profit") > 0
    ]

    if not valid_years:
        return {"applicable": True, "summary": "No positive operating profit periods to evaluate"}

    latest = valid_years[-1]
    cfo_latest = _val(latest, "cash_from_operating")
    ebit_latest = _val(latest, "operating_profit")
    conv_latest = round(cfo_latest / ebit_latest, 2)

    # 3-year average conversion
    last_3 = valid_years[-3:]
    sum_cfo = sum(_val(r, "cash_from_operating") for r in last_3)
    sum_ebit = sum(_val(r, "operating_profit") for r in last_3)
    conv_3y = round(sum_cfo / sum_ebit, 2) if sum_ebit > 0 else None

    # Free cash flow: CFO - Investing Capex (approx using net_block delta + cwip delta or CFI)
    # If CFI is negative, capex is roughly abs(CFI)
    cfi_latest = _val(latest, "cash_from_investing") or 0.0
    fcf_latest = cfo_latest + cfi_latest if cfi_latest < 0 else cfo_latest

    fcf_yield_pct = None
    if market_cap_cr and market_cap_cr > 0:
        fcf_yield_pct = round((fcf_latest / market_cap_cr) * 100.0, 2)

    # Assessment
    if conv_latest >= 0.75:
        conv_rating = "Excellent (>75%)"
    elif conv_latest >= 0.50:
        conv_rating = "Moderate (50-75%)"
    elif conv_latest >= 0.0:
        conv_rating = "Poor (<50%)"
    else:
        conv_rating = "Negative Cash Flow"

    return {
        "applicable": True,
        "conversion_latest": conv_latest,
        "conversion_3y": conv_3y,
        "conversion_rating": conv_rating,
        "fcf_latest_cr": round(fcf_latest, 1),
        "fcf_yield_pct": fcf_yield_pct,
        "summary": f"Latest CFO/EBIT: {conv_latest:.2f}x ({conv_rating}), 3Y Avg: {conv_3y:.2f}x" + (f", FCF Yield: {fcf_yield_pct:.1f}%" if fcf_yield_pct else ""),
    }


# -------------------------------------------------------------------------
# 5. Valuation Band Position (Percentile in 10-Year History)
# -------------------------------------------------------------------------

def compute_valuation_band_position(pe_band: Optional[dict], current_pe: Optional[float] = None) -> dict[str, Any]:
    """Calculate where current P/E sits within its 10-year historical band."""
    if not pe_band:
        return {
            "position": "Unknown",
            "percentile_in_range": None,
            "summary": "No historical P/E band available",
        }

    pe_ttm = _val(pe_band, "pe_ttm") or current_pe
    p_min = _val(pe_band, "min") or _val(pe_band, "lo")
    p_max = _val(pe_band, "max") or _val(pe_band, "hi")
    p_med = _val(pe_band, "median") or _val(pe_band, "avg")
    p10 = _val(pe_band, "p10")
    p90 = _val(pe_band, "p90")

    if pe_ttm is None or p_min is None or p_max is None or p_max <= p_min:
        return {
            "position": "Unknown",
            "percentile_in_range": None,
            "summary": f"Current PE: {pe_ttm}x (Band bounds missing)",
        }

    # Percentile in [min, max]
    pct = round(((pe_ttm - p_min) / (p_max - p_min)) * 100.0, 1)

    if pe_ttm > p_max:
        position = "Above 10Y Maximum (Extremely Expensive)"
    elif pe_ttm >= (p90 or p_max):
        position = "Top 10% Decile (High Valuation Risk)"
    elif pe_ttm <= (p10 or p_min):
        position = "Bottom 10% Decile (Deep Value / Cyclical Low)"
    elif p_med and pe_ttm <= p_med:
        position = "Lower Half of 10Y Band (Favorable Valuation)"
    else:
        position = "Upper Half of 10Y Band (Fair to Premium)"

    return {
        "pe_ttm": pe_ttm,
        "min": p_min,
        "median": p_med,
        "max": p_max,
        "percentile_in_range": pct,
        "position": position,
        "summary": f"{pe_ttm:.1f}x sits at {position} (10Y Range: {p_min:.1f}x to {p_max:.1f}x, Median: {p_med:.1f}x)",
    }


# -------------------------------------------------------------------------
# 6. Technical Structure & Delivery Volume (OHLC / Trend Filter)
# -------------------------------------------------------------------------

def compute_technical_structure(pack: dict[str, Any]) -> dict[str, Any]:
    """Evaluate price action, 200-day EMA trend, EMA stack, and delivery accumulation."""
    tech = pack.get("technicals") or {}
    deliv = pack.get("delivery") or {}

    pct_above_200 = _val(tech, "pct_above_200ema_252d")
    ema_bull = tech.get("ema_stack_bull")
    ret_12m = _val(tech, "ret_12m_rel")

    deliv_rows = deliv.get("rows") or []
    avg_deliv_pct = None
    if deliv_rows:
        pcts = [_val(r, "delivery_pct") for r in deliv_rows if _val(r, "delivery_pct") is not None]
        if pcts:
            # If stored as 0..1 fraction or 0..100 percentage
            mean_val = sum(pcts) / len(pcts)
            avg_deliv_pct = round(mean_val * 100.0, 1) if mean_val <= 1.0 else round(mean_val, 1)

    # Trend evaluation
    if pct_above_200 is not None:
        if pct_above_200 >= 0.70 and ema_bull:
            trend = "Strong Bullish (Above 200-EMA with Bullish Stack)"
            timing = "Strong upward momentum; favor buying on minor dips."
        elif pct_above_200 >= 0.40:
            trend = "Consolidating / Rangebound"
            timing = "Base formation; accumulate near major support."
        else:
            trend = "Corrective / Downtrend (Losing 200-EMA)"
            timing = "Persistent downtrend; wait for base formation before entry."
    else:
        trend = "Limited Price History"
        timing = "Insufficient bars for 200-day EMA."

    deliv_summary = f"{avg_deliv_pct}% delivery" if avg_deliv_pct is not None else "Delivery data pending"

    return {
        "trend": trend,
        "ema_bullish_stack": ema_bull,
        "pct_above_200ema": round(pct_above_200 * 100.0, 1) if pct_above_200 is not None else None,
        "avg_delivery_pct": avg_deliv_pct,
        "timing_advice": timing,
        "summary": f"{trend} ({deliv_summary}, {timing})",
    }


# -------------------------------------------------------------------------
# 7. Beneish M-Score (Earnings Manipulation Detection)
# -------------------------------------------------------------------------

def compute_beneish_m_score(annual_filings: list[dict[str, Any]], cluster_id: Optional[str] = None) -> dict[str, Any]:
    """Compute Beneish M-Score (8-variable forensic manipulation model).

    Formula:
    M = -4.84 + 0.920*DSRI + 0.528*GMI + 0.404*AQI + 0.892*SGI + 0.115*DEPI - 0.172*SGAI + 4.037*TATA + 0.0327*LVGI

    Threshold:
    M > -1.78 suggests high probability of earnings manipulation.
    M <= -1.78 indicates clean / non-manipulator.
    """
    if cluster_id in ("banks", "nbfc", "psu_banks", "housing_finance"):
        return {"applicable": False, "reason": "Not applicable to BFSI/Lenders", "summary": "BFSI N/A"}

    if len(annual_filings) < 2:
        return {"applicable": False, "reason": "Requires at least 2 consecutive annual filings", "summary": "Insufficient filings"}

    filings = sorted(annual_filings, key=lambda x: str(x.get("period_end", "")))
    prior = filings[-2]
    curr = filings[-1]

    # 1. DSRI: Days Sales in Receivables Index = (Receivables_t / Sales_t) / (Receivables_t-1 / Sales_t-1)
    rec_t, s_t = _val(curr, "receivables"), _val(curr, "sales")
    rec_prev, s_prev = _val(prior, "receivables"), _val(prior, "sales")
    if s_t and s_prev and s_t > 0 and s_prev > 0 and rec_t is not None and rec_prev is not None:
        rec_ratio_t = rec_t / s_t
        rec_ratio_prev = rec_prev / s_prev
        dsri = (rec_ratio_t / rec_ratio_prev) if rec_ratio_prev > 0 else 1.0
    else:
        dsri = 1.0

    # 2. GMI: Gross Margin Index = GrossMargin_t-1 / GrossMargin_t
    op_t, op_prev = _val(curr, "operating_profit"), _val(prior, "operating_profit")
    if s_t and s_prev and s_t > 0 and s_prev > 0 and op_t is not None and op_prev is not None:
        gm_t = op_t / s_t
        gm_prev = op_prev / s_prev
        gmi = (gm_prev / gm_t) if gm_t > 0 else (1.5 if gm_prev > gm_t else 1.0)
    else:
        gmi = 1.0

    # 3. AQI: Asset Quality Index = (1 - (NetBlock + Investments + Receivables + Cash) / TotalAssets)
    ta_t, ta_prev = _val(curr, "total_assets"), _val(prior, "total_assets")
    oa_t = _val(curr, "other_assets") or 0.0
    oa_prev = _val(prior, "other_assets") or 0.0
    if ta_t and ta_prev and ta_t > 0 and ta_prev > 0:
        aq_t = oa_t / ta_t
        aq_prev = oa_prev / ta_prev
        aqi = (aq_t / aq_prev) if aq_prev > 0 else 1.0
    else:
        aqi = 1.0

    # 4. SGI: Sales Growth Index = Sales_t / Sales_t-1
    sgi = (s_t / s_prev) if (s_t and s_prev and s_prev > 0) else 1.0

    # 5. DEPI: Depreciation Index = DeprRate_t-1 / DeprRate_t
    dep_t, dep_prev = _val(curr, "depreciation") or 0.0, _val(prior, "depreciation") or 0.0
    nb_t, nb_prev = _val(curr, "net_block") or 0.0, _val(prior, "net_block") or 0.0
    rate_t = dep_t / (nb_t + dep_t) if (nb_t + dep_t) > 0 else 0.1
    rate_prev = dep_prev / (nb_prev + dep_prev) if (nb_prev + dep_prev) > 0 else 0.1
    depi = (rate_prev / rate_t) if rate_t > 0 else 1.0

    # 6. SGAI: SG&A Expense Index
    exp_t, exp_prev = _val(curr, "expenses") or 0.0, _val(prior, "expenses") or 0.0
    sgai = ((exp_t / s_t) / (exp_prev / s_prev)) if (s_t and s_prev and exp_prev and s_t > 0 and s_prev > 0 and exp_prev > 0) else 1.0

    # 7. LVGI: Leverage Index = (Borrowings_t / TotalAssets_t) / (Borrowings_t-1 / TotalAssets_t-1)
    d_t, d_prev = _val(curr, "borrowings") or 0.0, _val(prior, "borrowings") or 0.0
    lev_t = d_t / ta_t if (ta_t and ta_t > 0) else 0.0
    lev_prev = d_prev / ta_prev if (ta_prev and ta_prev > 0) else 0.0
    if lev_prev > 0:
        lvgi = lev_t / lev_prev
    elif lev_t > 0:
        lvgi = 1.2
    else:
        lvgi = 1.0

    # 8. TATA: Total Accruals to Total Assets = (Net Profit - CFO) / Total Assets
    np_t = _val(curr, "net_profit") or 0.0
    cfo_t = _val(curr, "cash_from_operating") or 0.0
    tata = (np_t - cfo_t) / ta_t if (ta_t and ta_t > 0) else 0.0

    # Clamp outlier ratios
    dsri = max(0.2, min(dsri, 5.0))
    gmi = max(0.2, min(gmi, 5.0))
    aqi = max(0.2, min(aqi, 5.0))
    sgi = max(0.2, min(sgi, 5.0))
    depi = max(0.2, min(depi, 5.0))
    sgai = max(0.2, min(sgai, 5.0))
    lvgi = max(0.2, min(lvgi, 5.0))
    tata = max(-2.0, min(tata, 2.0))

    m_score = (
        -4.84
        + 0.920 * dsri
        + 0.528 * gmi
        + 0.404 * aqi
        + 0.892 * sgi
        + 0.115 * depi
        - 0.172 * sgai
        + 4.037 * tata
        + 0.0327 * lvgi
    )

    is_manipulator = m_score > -1.78
    classification = "High Manipulation Risk (Red Flag)" if is_manipulator else "Clean / Low Manipulation Risk"

    return {
        "applicable": True,
        "m_score": round(m_score, 2),
        "is_manipulator": is_manipulator,
        "classification": classification,
        "indices": {
            "DSRI": round(dsri, 2),
            "GMI": round(gmi, 2),
            "AQI": round(aqi, 2),
            "SGI": round(sgi, 2),
            "DEPI": round(depi, 2),
            "SGAI": round(sgai, 2),
            "LVGI": round(lvgi, 2),
            "TATA": round(tata, 3),
        },
        "summary": f"{m_score:.2f} ({classification})",
    }


# -------------------------------------------------------------------------
# 8. DuPont 5-Stage ROE Decomposition
# -------------------------------------------------------------------------

def compute_dupont_5_stage(annual_filings: list[dict[str, Any]], cluster_id: Optional[str] = None) -> dict[str, Any]:
    """Compute DuPont 5-Stage ROE Decomposition.

    ROE = (Net Profit / PBT) * (PBT / EBIT) * (EBIT / Sales) * (Sales / Total Assets) * (Total Assets / Equity)
        = Tax Burden * Interest Burden * Operating Margin * Asset Turnover * Leverage
    """
    if cluster_id in ("banks", "nbfc", "psu_banks", "housing_finance"):
        return {"applicable": False, "reason": "Not applicable to BFSI (Lenders)", "summary": "BFSI N/A"}

    if not annual_filings:
        return {"applicable": False, "reason": "No annual filings", "summary": "No data"}

    filings = sorted(annual_filings, key=lambda x: str(x.get("period_end", "")))
    latest = filings[-1]

    np_val = _val(latest, "net_profit")
    pbt_val = _val(latest, "profit_before_tax")
    interest_val = _val(latest, "interest") or 0.0
    s_val = _val(latest, "sales")
    ta_val = _val(latest, "total_assets")
    res_val = _val(latest, "reserves") or 0.0
    cap_val = _val(latest, "equity_share_capital") or 0.0
    equity_val = cap_val + res_val

    if not (np_val and pbt_val and s_val and ta_val and equity_val and s_val > 0 and ta_val > 0 and equity_val > 0):
        return {"applicable": False, "reason": "Incomplete financial line items", "summary": "Incomplete items"}

    ebit_val = pbt_val + interest_val
    tax_burden = np_val / pbt_val if pbt_val > 0 else 1.0
    interest_burden = pbt_val / ebit_val if ebit_val > 0 else 1.0
    operating_margin = ebit_val / s_val
    asset_turnover = s_val / ta_val
    financial_leverage = ta_val / equity_val

    roe = (np_val / equity_val) * 100.0

    drivers = []
    if operating_margin >= 0.20:
        drivers.append("High Operating Margin")
    if asset_turnover >= 1.5:
        drivers.append("High Asset Sweat")
    if financial_leverage >= 3.0:
        drivers.append("High Debt Leverage")
    elif financial_leverage <= 1.5:
        drivers.append("Conservative Balance Sheet")

    primary_driver = ", ".join(drivers) if drivers else "Balanced Operations"

    return {
        "applicable": True,
        "roe_pct": round(roe, 1),
        "tax_burden": round(tax_burden, 2),
        "interest_burden": round(interest_burden, 2),
        "ebit_margin_pct": round(operating_margin * 100.0, 1),
        "asset_turnover": round(asset_turnover, 2),
        "financial_leverage": round(financial_leverage, 2),
        "primary_driver": primary_driver,
        "summary": f"ROE {roe:.1f}% (Margin: {operating_margin*100.0:.1f}%, Asset Turn: {asset_turnover:.2f}x, Leverage: {financial_leverage:.2f}x — Driven by {primary_driver})",
    }


# -------------------------------------------------------------------------
# 9. Peter Lynch Growth Model & PEG
# -------------------------------------------------------------------------

def compute_peter_lynch_model(metrics: dict[str, Any], annual_filings: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute Peter Lynch Growth Classification & PEG Valuation."""
    cm = metrics.get("cluster_metrics") or {}
    pe_ttm = _val(metrics, "pe_ttm") or _val(cm, "pe_ttm")

    # Check metrics keys
    np_cagr = (
        _val(metrics, "np_cagr_5y")
        or _val(cm, "np_cagr_5y")
        or _val(metrics, "net_profit_cagr_5y")
        or _val(metrics, "rev_cagr_5y")
        or _val(cm, "rev_cagr_5y")
        or _val(metrics, "sales_cagr_5y")
    )
    growth_rate = None
    if np_cagr is not None:
        growth_rate = np_cagr * 100.0 if abs(np_cagr) <= 2.5 else np_cagr

    # If not in metrics, compute 3-year Sales CAGR from annual filings
    if growth_rate is None and len(annual_filings) >= 3:
        filings = sorted(annual_filings, key=lambda x: str(x.get("period_end", "")))
        s_curr = _val(filings[-1], "sales")
        s_base = _val(filings[-3], "sales")
        if s_curr and s_base and s_curr > 0 and s_base > 0:
            cagr = ((s_curr / s_base) ** (1.0 / 2.0) - 1.0) * 100.0
            growth_rate = round(cagr, 1)

    pat_history = [_val(r, "net_profit") for r in annual_filings if _val(r, "net_profit") is not None]
    has_loss = any(p <= 0 for p in pat_history) if pat_history else False

    if has_loss and len(pat_history) >= 3:
        category = "Cyclical (Earnings Volatility)"
    elif growth_rate is not None:
        if growth_rate >= 20.0:
            category = "Fast Grower (>20% CAGR)"
        elif growth_rate >= 10.0:
            category = "Stalwart (10-20% CAGR)"
        elif growth_rate > 0:
            category = "Slow Grower (<10% CAGR)"
        else:
            category = "Declining Growth"
    else:
        category = "Mature Company"

    peg_ratio = None
    peg_evaluation = "N/A"
    if pe_ttm and growth_rate and growth_rate > 0:
        peg_ratio = round(pe_ttm / growth_rate, 2)
        if peg_ratio <= 1.0:
            peg_evaluation = "Undervalued / Attractive (PEG <= 1.0)"
        elif peg_ratio <= 1.5:
            peg_evaluation = "Fairly Valued (PEG 1.0 - 1.5)"
        elif peg_ratio <= 2.5:
            peg_evaluation = "Growth Priced In (PEG 1.5 - 2.5)"
        else:
            peg_evaluation = "Expensive / Stretched PEG (> 2.5)"

    return {
        "category": category,
        "growth_rate_pct": round(growth_rate, 1) if growth_rate is not None else None,
        "pe_ttm": pe_ttm,
        "peg_ratio": peg_ratio,
        "peg_evaluation": peg_evaluation,
        "summary": f"{category} (PEG: {peg_ratio if peg_ratio else 'N/A'}, {peg_evaluation})",
    }


# -------------------------------------------------------------------------
# Unified Institutional Analysis
# -------------------------------------------------------------------------

def evaluate_institutional_models(pack: dict[str, Any]) -> dict[str, Any]:
    """Run all institutional models on a symbol evidence pack."""
    annual = pack.get("annual") or (pack.get("financials") or {}).get("annual") or []
    quarterly = pack.get("quarterly") or (pack.get("financials") or {}).get("quarterly") or []
    cluster_id = (pack.get("identity") or {}).get("cluster_id")
    pe_band = pack.get("pe_band")
    metrics = pack.get("metrics") or {}
    cm = metrics.get("cluster_metrics") or {}
    pe_curr = _val(metrics, "pe_ttm") or _val(cm, "pe_ttm")
    mcap = _val(metrics, "market_cap")

    playbook = get_sector_playbook(cluster_id)
    piotroski = compute_piotroski_f_score(annual)
    altman = compute_altman_z_score(annual, cluster_id)
    sloan = compute_sloan_accrual_ratio(annual, cluster_id)
    conversion = compute_cash_conversion(annual, mcap, cluster_id)
    val_band = compute_valuation_band_position(pe_band, pe_curr)
    technicals = compute_technical_structure(pack)
    beneish = compute_beneish_m_score(annual, cluster_id)
    dupont = compute_dupont_5_stage(annual, cluster_id)
    lynch = compute_peter_lynch_model(metrics, annual)

    # Build validated parameter bullets
    params_validated = []
    if piotroski["score"] is not None:
        params_validated.append(f"Piotroski F-Score: {piotroski['summary']}")
    if altman["applicable"] and altman["z_score"] is not None:
        params_validated.append(f"Altman Z''-Score: {altman['summary']}")
    if sloan["applicable"] and sloan["accrual_ratio"] is not None:
        params_validated.append(f"Sloan Accrual: {sloan['summary']}")
    if beneish["applicable"] and beneish.get("m_score") is not None:
        params_validated.append(f"Beneish M-Score: {beneish['summary']}")
    if dupont["applicable"] and dupont.get("roe_pct") is not None:
        params_validated.append(f"DuPont ROE: {dupont['summary']}")
    if lynch.get("category"):
        params_validated.append(f"Peter Lynch: {lynch['summary']}")
    if conversion["applicable"] and conversion.get("conversion_latest") is not None:
        params_validated.append(f"Cash Conversion: {conversion['summary']}")
    if val_band.get("percentile_in_range") is not None or val_band.get("pe_ttm") is not None:
        params_validated.append(f"10Y P/E Band: {val_band['summary']}")
    if technicals.get("trend"):
        params_validated.append(f"Technical Trend: {technicals['summary']}")

    return {
        "sector_playbook": playbook,
        "piotroski": piotroski,
        "altman_z": altman,
        "sloan_accruals": sloan,
        "beneish_m": beneish,
        "dupont_5": dupont,
        "peter_lynch": lynch,
        "cash_conversion": conversion,
        "valuation_band": val_band,
        "technicals": technicals,
        "validated_parameters_text": " | ".join(params_validated),
    }


if __name__ == "__main__":
    import json
    # Quick sanity check with synthetic data
    sample_annual = [
        {
            "period_end": "2024-03-31",
            "sales": 1000.0,
            "operating_profit": 200.0,
            "net_profit": 150.0,
            "total_assets": 1200.0,
            "borrowings": 100.0,
            "no_of_equity_shares": 10.0,
            "cash_from_operating": 180.0,
            "receivables": 150.0,
            "inventory": 100.0,
            "cash_and_bank": 80.0,
            "other_liabilities": 120.0,
            "reserves": 800.0,
            "equity_share_capital": 50.0,
        },
        {
            "period_end": "2025-03-31",
            "sales": 1250.0,
            "operating_profit": 270.0,
            "net_profit": 210.0,
            "total_assets": 1400.0,
            "borrowings": 90.0,
            "no_of_equity_shares": 10.0,
            "cash_from_operating": 250.0,
            "receivables": 160.0,
            "inventory": 110.0,
            "cash_and_bank": 120.0,
            "other_liabilities": 130.0,
            "reserves": 950.0,
            "equity_share_capital": 50.0,
        },
    ]
    sample_pack = {
        "identity": {"cluster_id": "capital_goods"},
        "financials": {"annual": sample_annual, "quarterly": []},
        "pe_band": {"pe_ttm": 22.5, "min": 12.0, "median": 20.0, "max": 35.0, "p10": 14.0, "p90": 30.0},
        "metrics": {"market_cap": 5000.0},
    }
    res = evaluate_institutional_models(sample_pack)
    print(json.dumps(res, indent=2))
