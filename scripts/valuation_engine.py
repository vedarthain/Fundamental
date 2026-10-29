#!/usr/bin/env python3
"""Institutional Target Price & Multi-Model Valuation Engine.

Implements sector-tailored valuation models:
  1. Justified P/B - ROE Model (Gordon Growth for BFSI / Lenders)
  2. Normalized Mid-Cycle EV/EBITDA Model (For Cyclicals & Capital Heavy)
  3. Forward P/E with PEG & Quality Premium (For Consumer, IT, Retail, Healthcare)
  4. 2-Stage Buffett Owner Earnings DCF (For Cash Monopolies & Platforms)
  5. 10-Year Historical Valuation Band Anchor (Cross-cycle sanity check)

Provides:
  - Base Target Price (12-18 month horizon)
  - Bull Case Target (+15% to +25%)
  - Bear Case Floor (Margin of Safety / Downside Risk)
  - Accumulation Zone (Buy Dips range)
  - Reward-to-Risk Asymmetry Ratio
"""

from __future__ import annotations

import math
from typing import Any, Optional


def _val(row: Optional[dict], key: str) -> Optional[float]:
    if not row or not isinstance(row, dict):
        return None
    v = row.get(key)
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


# -------------------------------------------------------------------------
# Sector Category Mapping for Valuation Framework
# -------------------------------------------------------------------------

BFSI_CLUSTERS = {
    "bfsi_nbfc", "bfsi_psu_banks", "bfsi_pvt_banks",
    "bfsi_pvt_banks_large", "bfsi_pvt_banks_mid_small",
    "bfsi_sfb", "bfsi_insurance", "bfsi_housing_finance",
    "bfsi_gold_microfinance", "bfsi_holding_companies",
}

CYCLICAL_CAP_HEAVY_CLUSTERS = {
    "capital_goods", "cap_goods_electrical", "cap_goods_ems",
    "cap_goods_machinery_equipment", "cap_goods_pipes_building",
    "cap_goods_precision_eng", "cap_goods_pumps_valves",
    "metals_ferrous", "metals_nonferrous_mining", "construction",
    "construction_railways_infra", "cement", "power", "realty",
    "realty_commercial_coworking", "oil_refining", "chemicals_agro",
    "chemicals_dyes_pigments", "chemicals_specialty", "auto_components",
    "auto_oem", "auto_tyres_rubber", "electrical_transformers_grid",
    "electrical_wires_cables", "transport_logistics", "agri_sugar_biofuels",
    "paper_forest", "textiles_spinning_yarn", "textiles_apparel_retail",
}

PLATFORM_MONOPOLY_CLUSTERS = {
    "bfsi_exchange", "bfsi_rta_rating", "bfsi_amc_wealth",
    "bfsi_broker", "bfsi_fintech", "defense_aero",
}

QUALITY_CONSUMER_TECH_CLUSTERS = {
    "retail", "consumer_jewellery", "consumer_appliances",
    "consumer_building_home", "consumer_footwear", "fmcg_diversified",
    "fmcg_packaged_foods", "fmcg_food_agri", "fmcg_beverages",
    "fmcg_personal", "it_services_large", "it_services_midsmall",
    "it_erd_engineering", "it_software_products_saas", "it_hardware",
    "pharma", "pharma_cdmo_apis", "health_services", "medtech",
    "hospitality_hotels", "leisure_hospitality", "telecom",
    "media_entertainment", "education_training_services",
    "packaging_containers", "services_hr_staffing", "services_staffing_facilities",
}


def get_valuation_category(cluster_id: Optional[str]) -> str:
    """Classify cluster into valuation archetype."""
    cid = (cluster_id or "").lower()
    if cid in BFSI_CLUSTERS:
        return "bfsi"
    if cid in CYCLICAL_CAP_HEAVY_CLUSTERS:
        return "cyclical"
    if cid in PLATFORM_MONOPOLY_CLUSTERS:
        return "platform"
    if cid in QUALITY_CONSUMER_TECH_CLUSTERS:
        return "quality_growth"
    return "general"


# -------------------------------------------------------------------------
# Financial Normalization & Derived Quant Inputs
# -------------------------------------------------------------------------

def extract_quant_inputs(pack: dict[str, Any]) -> dict[str, Any]:
    """Derive foundational metrics directly from statements if missing in metrics."""
    metrics = dict(pack.get("metrics") or {})
    cm = metrics.get("cluster_metrics") or {}
    annual = pack.get("annual") or (pack.get("financials") or {}).get("annual") or []
    quarterly = pack.get("quarterly") or (pack.get("financials") or {}).get("quarterly") or []

    current_price = _val(metrics, "current_price") or _val(pack.get("identity"), "current_price") or 0.0
    mcap = _val(metrics, "market_cap") or _val(cm, "market_cap") or 0.0

    # Shares count in Crores
    shares_cr = None
    if mcap > 0 and current_price > 0:
        shares_cr = mcap / current_price
    elif annual:
        latest = annual[0]
        s = _val(latest, "no_of_equity_shares")
        if s and s > 0:
            shares_cr = s

    # TTM Profit & Sales from Quarterly
    ttm_pat = 0.0
    ttm_sales = 0.0
    ttm_op = 0.0
    if len(quarterly) >= 4:
        for q in quarterly[:4]:
            ttm_pat += _val(q, "net_profit") or 0.0
            ttm_sales += _val(q, "sales") or 0.0
            ttm_op += _val(q, "operating_profit") or 0.0
    elif annual:
        latest = annual[0]
        ttm_pat = _val(latest, "net_profit") or 0.0
        ttm_sales = _val(latest, "sales") or 0.0
        ttm_op = _val(latest, "operating_profit") or 0.0

    # EPS & P/E
    eps_ttm = _val(metrics, "eps")
    if (eps_ttm is None or eps_ttm <= 0) and shares_cr and shares_cr > 0 and ttm_pat > 0:
        eps_ttm = round(ttm_pat / shares_cr, 2)

    pe_ttm = _val(metrics, "pe_ttm") or _val(cm, "pe_ttm")
    if (pe_ttm is None or pe_ttm <= 0) and current_price > 0 and eps_ttm and eps_ttm > 0:
        pe_ttm = round(current_price / eps_ttm, 2)

    # Net Worth & Book Value
    net_worth = 0.0
    if annual:
        latest = annual[0]
        eq = _val(latest, "equity_share_capital") or 0.0
        res = _val(latest, "reserves") or 0.0
        net_worth = eq + res

    bvps = _val(metrics, "bvps")
    if (bvps is None or bvps <= 0) and shares_cr and shares_cr > 0 and net_worth > 0:
        bvps = round(net_worth / shares_cr, 2)

    pb = _val(metrics, "pb") or _val(cm, "pb")
    if (pb is None or pb <= 0) and current_price > 0 and bvps and bvps > 0:
        pb = round(current_price / bvps, 2)

    roe = _val(metrics, "roe_3y") or _val(cm, "roe_3y")
    if (roe is None or roe <= 0) and ttm_pat > 0 and net_worth > 0:
        roe = round((ttm_pat / net_worth) * 100.0, 1)

    return {
        "current_price": current_price,
        "market_cap": mcap,
        "shares_cr": shares_cr,
        "ttm_pat": ttm_pat,
        "ttm_sales": ttm_sales,
        "ttm_op": ttm_op,
        "eps_ttm": eps_ttm,
        "pe_ttm": pe_ttm,
        "net_worth": net_worth,
        "bvps": bvps,
        "pb": pb,
        "roe": roe,
        "metrics": metrics,
        "annual": annual,
        "quarterly": quarterly,
    }


# -------------------------------------------------------------------------
# Model 1: Justified P/B - ROE (Gordon Growth for Financials)
# -------------------------------------------------------------------------

def compute_justified_pb_target(pack: dict[str, Any], qi: dict[str, Any]) -> Optional[dict[str, Any]]:
    """CFA / Damodaran Gordon Growth model for financial institutions.
    
    Target P/B = (ROE - g) / (Ke - g)
    Target Price = Target P/B * Forward BVPS
    """
    current_price = qi["current_price"]
    bvps = qi["bvps"]
    roe = qi["roe"]

    if not current_price or current_price <= 0 or not bvps or bvps <= 0:
        return None

    roe_val = roe if roe is not None else 12.0
    sust_roe = max(0.04, min(0.24, roe_val / 100.0))

    cost_of_equity = 0.135  # 13.5% Ke
    terminal_growth = 0.065  # 6.5% long-term nominal growth

    target_pb = max(0.6, min(5.0, (sust_roe - terminal_growth) / max(0.015, (cost_of_equity - terminal_growth))))

    retention_rate = 0.80
    forward_bvps = bvps * (1.0 + sust_roe * retention_rate)
    target_price = round(target_pb * forward_bvps, 2)

    return {
        "model_name": "Justified P/B - ROE (Gordon Growth)",
        "target_price": target_price,
        "target_pb": round(target_pb, 2),
        "forward_bvps": round(forward_bvps, 2),
        "sustainable_roe_pct": round(sust_roe * 100.0, 1),
    }


# -------------------------------------------------------------------------
# Model 2: Normalized Mid-Cycle EV/EBITDA Model (For Cyclicals)
# -------------------------------------------------------------------------

def compute_ev_ebitda_target(pack: dict[str, Any], qi: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Mid-cycle EV/EBITDA valuation adjusting for debt and normalized margins."""
    current_price = qi["current_price"]
    shares_cr = qi["shares_cr"]
    annual = qi["annual"]
    ttm_sales = qi["ttm_sales"]
    metrics = qi["metrics"]
    cm = metrics.get("cluster_metrics") or {}

    if not current_price or current_price <= 0 or not shares_cr or shares_cr <= 0:
        return None

    # Historical 5-year median operating margin
    opms = []
    if annual:
        for r in annual:
            s = _val(r, "sales")
            op = _val(r, "operating_profit")
            if s and op and s > 0:
                opms.append(op / s)
    norm_opm = (sum(opms) / len(opms)) if opms else (_val(metrics, "opm_now") or 15.0) / 100.0

    if ttm_sales <= 0 and annual:
        ttm_sales = _val(annual[0], "sales") or 0.0

    if ttm_sales <= 0:
        return None

    norm_ebitda = ttm_sales * norm_opm
    if norm_ebitda <= 0:
        return None

    curr_ev_ebitda = _val(metrics, "ev_ebitda_ttm") or _val(cm, "ev_ebitda_ttm") or 10.0
    target_multiple = max(6.0, min(22.0, curr_ev_ebitda * 1.05))

    target_ev = norm_ebitda * target_multiple

    net_debt = 0.0
    if annual:
        latest = annual[0]
        borr = _val(latest, "borrowings") or 0.0
        cash = _val(latest, "cash_and_bank") or 0.0
        net_debt = borr - cash
    else:
        nd_ebitda = _val(metrics, "net_debt_ebitda") or 0.0
        net_debt = nd_ebitda * norm_ebitda

    target_mcap = max(target_ev * 0.3, target_ev - net_debt)
    target_price = round(target_mcap / shares_cr, 2)

    return {
        "model_name": "Normalized Mid-Cycle EV/EBITDA",
        "target_price": target_price,
        "target_multiple": round(target_multiple, 1),
        "normalized_ebitda_cr": round(norm_ebitda, 1),
        "net_debt_cr": round(net_debt, 1),
    }


# -------------------------------------------------------------------------
# Model 3: Forward P/E with Quality PEG Premium
# -------------------------------------------------------------------------

def compute_forward_pe_quality_target(pack: dict[str, Any], qi: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Forward P/E with growth projection and quality capital allocation adjustments."""
    current_price = qi["current_price"]
    eps_ttm = qi["eps_ttm"]
    pe_ttm = qi["pe_ttm"]
    metrics = qi["metrics"]
    cm = metrics.get("cluster_metrics") or {}

    if not current_price or current_price <= 0 or not eps_ttm or eps_ttm <= 0:
        return None

    np_cagr = (
        _val(metrics, "np_cagr_5y")
        or _val(cm, "np_cagr_5y")
        or _val(metrics, "rev_cagr_5y")
        or _val(cm, "rev_cagr_5y")
        or 0.12
    )
    growth_rate = np_cagr if abs(np_cagr) <= 1.0 else np_cagr / 100.0
    growth_rate = max(0.02, min(0.25, growth_rate))

    forward_eps = eps_ttm * (1.0 + growth_rate)

    pe_band = pack.get("pe_band") or {}
    hist_median_pe = _val(pe_band, "median") or _val(pe_band, "avg") or pe_ttm or 25.0

    roce = _val(metrics, "roce_3y") or _val(cm, "roce_3y") or 16.0
    cfo_pat = _val(metrics, "cfo_pat_3y") or _val(cm, "cfo_pat_3y") or 1.0

    multiplier = 1.0
    if roce >= 25.0 and cfo_pat >= 0.8:
        multiplier += 0.15
    elif roce >= 18.0:
        multiplier += 0.08
    elif roce < 12.0 or cfo_pat < 0.6:
        multiplier -= 0.15

    target_pe = max(8.0, min(65.0, hist_median_pe * multiplier))
    target_price = round(forward_eps * target_pe, 2)

    return {
        "model_name": "Forward P/E with Quality Premium",
        "target_price": target_price,
        "target_pe": round(target_pe, 1),
        "forward_eps": round(forward_eps, 2),
        "projected_growth_pct": round(growth_rate * 100.0, 1),
        "quality_multiplier": round(multiplier, 2),
    }


# -------------------------------------------------------------------------
# Model 4: 2-Stage Buffett Owner Earnings DCF
# -------------------------------------------------------------------------

def compute_owner_earnings_dcf_target(pack: dict[str, Any], qi: dict[str, Any]) -> Optional[dict[str, Any]]:
    """2-Stage Discounted Cash Flow over true Owner Earnings (CFO - Maint Capex)."""
    current_price = qi["current_price"]
    shares_cr = qi["shares_cr"]
    annual = qi["annual"]
    ttm_pat = qi["ttm_pat"]

    if not current_price or current_price <= 0 or not shares_cr or shares_cr <= 0:
        return None

    owner_earnings = 0.0
    if annual:
        cfos = [_val(r, "cash_from_operating") for r in annual if _val(r, "cash_from_operating") is not None]
        if cfos and cfos[0] > 0:
            owner_earnings = cfos[0] * 0.70

    if owner_earnings <= 0 and ttm_pat > 0:
        owner_earnings = ttm_pat * 0.75

    if owner_earnings <= 0:
        return None

    wacc = 0.115  # 11.5% WACC
    g1 = 0.12  # Stage 1 (Years 1-5): 12% growth
    g2 = 0.055  # Stage 2 Terminal: 5.5% perpetual growth

    pv_stage1 = 0.0
    oe = owner_earnings
    for t in range(1, 6):
        oe *= (1.0 + g1)
        pv_stage1 += oe / ((1.0 + wacc) ** t)

    terminal_value = (oe * (1.0 + g2)) / (wacc - g2)
    pv_terminal = terminal_value / ((1.0 + wacc) ** 5)

    ev = pv_stage1 + pv_terminal

    cash = 0.0
    borr = 0.0
    if annual:
        latest = annual[0]
        cash = _val(latest, "cash_and_bank") or 0.0
        borr = _val(latest, "borrowings") or 0.0

    equity_val = max(ev * 0.4, ev + cash - borr)
    target_price = round(equity_val / shares_cr, 2)

    return {
        "model_name": "2-Stage Owner Earnings DCF",
        "target_price": target_price,
        "owner_earnings_cr": round(owner_earnings, 1),
        "pv_stage1_cr": round(pv_stage1, 1),
        "pv_terminal_cr": round(pv_terminal, 1),
        "wacc_pct": 11.5,
    }


# -------------------------------------------------------------------------
# Model 5: 10-Year Historical Valuation Band Anchor
# -------------------------------------------------------------------------

def compute_historical_band_target(pack: dict[str, Any], qi: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Sanity-check anchor based on 10-year historical valuation cycles."""
    current_price = qi["current_price"]
    eps_ttm = qi["eps_ttm"]
    pe_ttm = qi["pe_ttm"]
    pe_band = pack.get("pe_band") or {}

    if not current_price or current_price <= 0 or not eps_ttm or eps_ttm <= 0:
        return None

    p_med = _val(pe_band, "median") or _val(pe_band, "avg") or pe_ttm or 25.0
    p10 = _val(pe_band, "p10") or _val(pe_band, "min") or (p_med * 0.70)
    p90 = _val(pe_band, "p90") or _val(pe_band, "max") or (p_med * 1.35)

    target_price = round(eps_ttm * p_med, 2)
    floor_price = round(eps_ttm * p10, 2)
    ceiling_price = round(eps_ttm * p90, 2)

    return {
        "model_name": "10-Year Historical Cycle Anchor",
        "target_price": target_price,
        "median_pe": round(p_med, 1),
        "floor_price": floor_price,
        "ceiling_price": ceiling_price,
    }


# -------------------------------------------------------------------------
# Master Triangulation Engine
# -------------------------------------------------------------------------

def calculate_stock_valuation(pack: dict[str, Any]) -> dict[str, Any]:
    """Run all relevant models, apply sector weights, and generate actionable price targets."""
    cluster_id = (pack.get("identity") or {}).get("cluster_id")
    category = get_valuation_category(cluster_id)
    qi = extract_quant_inputs(pack)
    current_price = qi["current_price"] or 100.0

    # 1. Run individual valuation models
    m_pb = compute_justified_pb_target(pack, qi)
    m_ev = compute_ev_ebitda_target(pack, qi)
    m_pe = compute_forward_pe_quality_target(pack, qi)
    m_dcf = compute_owner_earnings_dcf_target(pack, qi)
    m_hist = compute_historical_band_target(pack, qi)

    # 2. Determine weights by sector archetype
    weights: list[tuple[Optional[dict[str, Any]], float, str]] = []

    if category == "bfsi":
        weights = [
            (m_pb, 0.50, "Justified P/B-ROE"),
            (m_hist, 0.30, "10Y P/B Cycle"),
            (m_pe, 0.20, "Forward Multiple"),
        ]
    elif category == "cyclical":
        weights = [
            (m_ev, 0.55, "Normalized EV/EBITDA"),
            (m_hist, 0.30, "10Y Cycle Band"),
            (m_pe, 0.15, "Forward P/E"),
        ]
    elif category == "platform":
        weights = [
            (m_dcf, 0.50, "Owner Earnings DCF"),
            (m_pe, 0.30, "Forward P/E"),
            (m_hist, 0.20, "10Y Median Anchor"),
        ]
    else:  # quality_growth & general
        weights = [
            (m_pe, 0.50, "Forward Quality P/E"),
            (m_dcf, 0.30, "Owner DCF"),
            (m_hist, 0.20, "10Y Hist Band"),
        ]

    active_models = [(m, w, name) for (m, w, name) in weights if m and m.get("target_price") and m["target_price"] > 0]

    if not active_models:
        base_target = round(current_price * 1.15, 2)
        bull_target = round(current_price * 1.30, 2)
        bear_floor = round(current_price * 0.85, 2)
        buy_below = round(current_price * 0.95, 2)
        method = "Heuristic Baseline (+15% Fair Value)"
    else:
        tot_w = sum(w for (_, w, _) in active_models)
        weighted_sum = sum(m["target_price"] * (w / tot_w) for (m, w, _) in active_models)
        base_target = round(weighted_sum, 2)

        method_parts = [f"{int(round((w / tot_w) * 100))}% {name}" for (_, w, name) in active_models]
        method = " + ".join(method_parts)

        bull_target = round(base_target * 1.20, 2)

        hist_floor = m_hist.get("floor_price") if m_hist else None
        if hist_floor and 0 < hist_floor < current_price:
            bear_floor = round(hist_floor, 2)
        else:
            bear_floor = round(min(base_target * 0.75, current_price * 0.85), 2)

        buy_below = round(min(current_price * 0.98, (bear_floor + current_price) / 2.0 * 1.05), 2)

    upside_pct = round(((base_target - current_price) / current_price) * 100.0, 1)
    downside_risk = max(1.0, current_price - bear_floor)
    upside_reward = max(0.0, base_target - current_price)
    rr_ratio = round(upside_reward / downside_risk, 1) if downside_risk > 0 else 1.0

    return {
        "target_price": base_target,
        "bull_target": bull_target,
        "bear_floor": bear_floor,
        "buy_below": buy_below,
        "upside_pct": upside_pct,
        "reward_risk_ratio": rr_ratio,
        "valuation_method": method,
        "category": category,
        "models_evaluated": {
            "justified_pb": m_pb,
            "ev_ebitda": m_ev,
            "forward_pe": m_pe,
            "owner_dcf": m_dcf,
            "historical_band": m_hist,
        },
    }
