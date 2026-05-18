"""Per-cluster scorecards (Mature tier base) + tier-variant generator.

Single source of truth for the 41 cluster scorecards from docs/scorecards.md.
Mature scorecards are written explicitly. Veteran/Mid/New variants are derived programmatically
using the substitution rules documented in the Tier-variant generation rules section.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Optional

# -------------------------------------------------------------------------
# Universal momentum scorecard (used unless cluster overrides)
# -------------------------------------------------------------------------
UNIVERSAL_MOMENTUM: dict[str, float] = {
    "ret_12m_rel":           20.0,
    "ret_6m_rel":            15.0,
    "ret_3m_rel":            10.0,
    "pct_above_200ema_252d": 10.0,
    "ema_stack_bull":         5.0,
    "tech_net_score_scaled":  5.0,
    "sales_yoy_q":           17.5,
    "np_yoy_q":              17.5,
}


@dataclass
class Scorecard:
    """A scorecard for one (cluster, tier) combination."""
    pillar_weights: dict[str, float]                    # {"q": 50, "v": 30, "m": 20}
    quality: dict[str, float]                            # {formula_id: weight}
    valuation: dict[str, float]
    momentum: dict[str, float]
    loss_maker_val_fallback: list[tuple[str, float]] = field(default_factory=list)
    """When pe_ttm is null, replace it with these (formula_id, share_of_pe_weight) entries.
       e.g. [('ev_sales_ttm', 1.0)] uses ev_sales_ttm at full pe weight.
       e.g. [('ev_sales_ttm', 0.6), ('pb', 0.4)] splits 60/40."""


# -------------------------------------------------------------------------
# Mature scorecards per cluster
# -------------------------------------------------------------------------

def _val_fallback_ev_sales() -> list[tuple[str, float]]:
    return [("ev_sales_ttm", 1.0)]


def _val_fallback_industrials() -> list[tuple[str, float]]:
    """60/40 EV/Sales + P/B for tangible-asset industrials."""
    return [("ev_sales_ttm", 0.6), ("pb", 0.4)]


# Lender base (banks/NBFCs) — most components shared.
# ROE and NP CAGR are now graduated across 3y/5y/7y so a long, steady ROE record
# is rewarded distinctly from a recent jump off a low base. (Previously roe_3y
# absorbed 100% of the ROE weight, which over-rewarded inflection stories like
# small-finance banks recovering from cycle lows. Same logic for NP CAGR.)
def _lender_quality(roa, roe, bvc, lbg, npc, nps, e2a):
    return {
        "roa_3y": roa,
        "roe_3y": roe * 0.5,   # recent
        "roe_5y": roe * 0.3,   # medium
        "roe_7y": roe * 0.2,   # long (vet sub for the longest window via make_veteran)
        "book_value_cagr_5y": bvc,    # vet sub → 10y
        "loan_book_cagr_3y": lbg,
        "np_cagr_5y": npc * 0.6,
        "np_cagr_7y": npc * 0.4,
        "np_consistency_5y": nps,     # vet sub → 10y
        "equity_to_assets": e2a,
    }


def _bank_momentum() -> dict[str, float]:
    """Banks: NII = sales (slow); NP YoY upweighted; preserves sum=100."""
    m = dict(UNIVERSAL_MOMENTUM)
    m["sales_yoy_q"] = 10.0
    m["np_yoy_q"] = 25.0  # sum becomes 100
    return m


SCORECARDS_MATURE: dict[str, Scorecard] = {

    # ===== A. LENDERS ========================================================
    "bfsi_pvt_banks": Scorecard(
        pillar_weights={"q": 50, "v": 30, "m": 20},
        quality=_lender_quality(roa=25, roe=18, bvc=18, lbg=14, npc=12, nps=8, e2a=5),
        valuation={"pb": 50, "pe_ttm": 25, "earnings_yield_trend": 15, "div_yield": 10},
        momentum=_bank_momentum(),
        loss_maker_val_fallback=[("pb", 1.0)],
    ),
    "bfsi_psu_banks": Scorecard(
        pillar_weights={"q": 50, "v": 30, "m": 20},
        quality=_lender_quality(roa=30, roe=15, bvc=15, lbg=14, npc=12, nps=8, e2a=6),
        valuation={"pb": 45, "pe_ttm": 25, "earnings_yield_trend": 10, "div_yield": 20},
        momentum=_bank_momentum(),
        loss_maker_val_fallback=[("pb", 1.0)],
    ),
    "bfsi_nbfc": Scorecard(
        pillar_weights={"q": 50, "v": 25, "m": 25},
        quality=_lender_quality(roa=22, roe=18, bvc=14, lbg=18, npc=12, nps=8, e2a=8),
        valuation={"pb": 45, "pe_ttm": 30, "earnings_yield_trend": 15, "div_yield": 10},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=[("p_aum", 1.0)],
    ),
    "bfsi_insurance": Scorecard(
        pillar_weights={"q": 55, "v": 25, "m": 20},
        quality={
            "roe_3y": 25, "book_value_cagr_5y": 25, "np_cagr_5y": 20,
            "rev_cagr_5y": 15, "np_consistency_5y": 10, "equity_to_assets": 5,
        },
        valuation={"pb": 60, "pe_ttm": 25, "div_yield": 15},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=[("p_premium", 1.0)],
    ),
    # ----- Capital Markets split (was bfsi_capmarkets) ----------------------
    # AMC/wealth: AUM-fee compounders. Heavy on quality; valuation leans on P/E
    # since these are highly cash-generative and don't trade on book value.
    "bfsi_amc_wealth": Scorecard(
        pillar_weights={"q": 50, "v": 30, "m": 20},
        quality={
            "roe_3y": 20, "roce_3y": 18, "op_margin_3y": 18, "op_margin_trend": 10,
            "np_cagr_5y": 15, "cfo_pat_3y": 10, "np_consistency_5y": 9,
        },
        valuation={"pe_ttm": 40, "earnings_yield_trend": 20, "div_yield": 15, "fcf_yield": 25},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    # Exchanges/depositories: regulated near-monopolies, very stable margins.
    # Quality dominates; pricier on traditional metrics because of moat.
    "bfsi_exchange": Scorecard(
        pillar_weights={"q": 55, "v": 25, "m": 20},
        quality={
            "op_margin_3y": 22, "op_margin_trend": 12, "roce_3y": 20, "roe_3y": 16,
            "cfo_pat_3y": 12, "np_cagr_5y": 10, "np_consistency_5y": 8,
        },
        valuation={"pe_ttm": 35, "earnings_yield_trend": 15, "div_yield": 20, "fcf_yield": 30},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    # RTAs/Rating: service-fee oligopolies. Similar to AMCs but lower margins.
    "bfsi_rta_rating": Scorecard(
        pillar_weights={"q": 48, "v": 30, "m": 22},
        quality={
            "roe_3y": 20, "roce_3y": 18, "op_margin_3y": 18, "op_margin_trend": 12,
            "np_cagr_5y": 12, "cfo_pat_3y": 10, "np_consistency_5y": 10,
        },
        valuation={"pe_ttm": 40, "earnings_yield_trend": 20, "div_yield": 15, "fcf_yield": 25},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    # Brokers: cyclical, transaction-driven, rate-sensitive. Lighter on quality
    # weight, heavier on momentum since the cycle matters more than steady-state
    # economics. P/B is more meaningful for broker balance sheets than P/E.
    "bfsi_broker": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roe_3y": 22, "roce_3y": 18, "op_margin_3y": 14, "op_margin_trend": 8,
            "np_cagr_5y": 14, "cfo_pat_3y": 12, "np_consistency_5y": 12,
        },
        valuation={"pe_ttm": 30, "pb": 30, "earnings_yield_trend": 15, "div_yield": 10, "fcf_yield": 15},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "bfsi_fintech": Scorecard(
        # Same as capmarkets but np_consistency dropped, replaced with rev_cagr
        pillar_weights={"q": 45, "v": 30, "m": 25},
        quality={
            "roe_3y": 20, "roce_3y": 18, "op_margin_3y": 15, "op_margin_trend": 10,
            "np_cagr_5y": 15, "cfo_pat_3y": 10, "rev_cagr_5y": 12,
        },
        valuation={"pe_ttm": 35, "pb": 20, "earnings_yield_trend": 15, "div_yield": 10, "fcf_yield": 20},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),

    # ===== B. ASSET-LIGHT SERVICES ==========================================
    "it_services_large": Scorecard(
        pillar_weights={"q": 45, "v": 30, "m": 25},
        quality={
            "op_margin_3y": 22, "op_margin_trend": 12, "roce_3y": 18,
            "cfo_ebitda_3y": 14, "dso": 8, "rev_cagr_5y": 12,
            "np_cagr_5y": 8, "np_consistency_5y": 6,
        },
        valuation={"pe_ttm": 35, "ev_ebitda_ttm": 20, "peg": 25, "fcf_yield": 15, "div_yield": 5},
        momentum={
            "ret_12m_rel": 15, "ret_6m_rel": 15, "ret_3m_rel": 10,
            "pct_above_200ema_252d": 10, "ema_stack_bull": 5, "tech_net_score_scaled": 5,
            "sales_yoy_q": 22.5, "np_yoy_q": 17.5,
        },
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "it_services_midsmall": Scorecard(
        pillar_weights={"q": 45, "v": 30, "m": 25},
        quality={
            "op_margin_3y": 22, "op_margin_trend": 12, "roce_3y": 18,
            "cfo_ebitda_3y": 14, "dso": 8, "rev_cagr_5y": 12,
            "np_cagr_5y": 4, "np_consistency_5y": 10,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 20, "peg": 30, "fcf_yield": 15, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "it_hardware": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "op_margin_3y": 18, "roce_3y": 18, "wc_days": 12, "rev_cagr_5y": 12,
            "np_cagr_5y": 10, "cfo_pat_3y": 10, "np_consistency_5y": 8, "asset_turnover": 12,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 25, "pb": 15, "peg": 15, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "telecom": Scorecard(
        pillar_weights={"q": 35, "v": 35, "m": 30},
        quality={
            "ebitda_margin_3y": 25, "roce_3y": 15, "cfo_ebitda_3y": 18,
            "net_debt_ebitda": 15, "op_margin_trend": 10, "np_consistency_5y": 10,
            "rev_cagr_5y": 7,
        },
        valuation={"ev_ebitda_ttm": 35, "pe_ttm": 20, "fcf_yield": 25, "pb": 10, "div_yield": 10},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),

    # ===== C. BRAND-LED CONSUMER ============================================
    "fmcg_food_agri": Scorecard(
        pillar_weights={"q": 50, "v": 30, "m": 20},
        quality={
            "roce_3y": 22, "op_margin_3y": 14, "wc_days": 10, "rev_cagr_5y": 12,
            "np_cagr_5y": 12, "cfo_pat_3y": 12, "np_consistency_5y": 8, "debt_equity": 4,
            "op_margin_trend": 6,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 25, "peg": 20, "pb": 10, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "fmcg_personal": Scorecard(
        pillar_weights={"q": 50, "v": 30, "m": 20},
        quality={
            "roce_3y": 25, "op_margin_3y": 14, "wc_days": 10, "rev_cagr_5y": 10,
            "np_cagr_5y": 12, "cfo_pat_3y": 12, "np_consistency_5y": 8, "debt_equity": 4,
            "op_margin_trend": 5,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 25, "peg": 20, "pb": 10, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "fmcg_beverages": Scorecard(
        pillar_weights={"q": 50, "v": 30, "m": 20},
        quality={
            "roce_3y": 22, "op_margin_3y": 16, "wc_days": 10, "rev_cagr_5y": 12,
            "np_cagr_5y": 12, "cfo_pat_3y": 10, "np_consistency_5y": 8, "debt_equity": 4,
            "op_margin_trend": 6,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 25, "peg": 20, "pb": 10, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "fmcg_diversified": Scorecard(
        pillar_weights={"q": 50, "v": 30, "m": 20},
        quality={
            "roce_3y": 20, "op_margin_3y": 14, "wc_days": 10, "rev_cagr_5y": 12,
            "np_cagr_5y": 12, "cfo_pat_3y": 12, "np_consistency_5y": 10, "debt_equity": 4,
            "op_margin_trend": 6,
        },
        valuation={"pe_ttm": 25, "ev_ebitda_ttm": 25, "peg": 15, "pb": 10, "fcf_yield": 10, "div_yield": 15},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "consumer_durables": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 18, "op_margin_3y": 14, "op_margin_trend": 10, "wc_days": 12,
            "inv_days": 8, "rev_cagr_5y": 12, "np_cagr_5y": 10, "cfo_pat_3y": 8, "debt_equity": 8,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 22, "peg": 23, "pb": 10, "fcf_yield": 10, "div_yield": 5},
        momentum={
            "ret_12m_rel": 20, "ret_6m_rel": 15, "ret_3m_rel": 10,
            "pct_above_200ema_252d": 10, "ema_stack_bull": 5, "tech_net_score_scaled": 5,
            "sales_yoy_q": 20, "np_yoy_q": 15,
        },
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "retail": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 18, "op_margin_3y": 12, "wc_days": 12, "inv_days": 12,
            "asset_turnover": 14, "rev_cagr_5y": 14, "np_cagr_5y": 10,
            "np_consistency_5y": 6, "debt_equity": 2,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 25, "peg": 22, "pb": 13, "fcf_yield": 5, "div_yield": 5},
        momentum={
            "ret_12m_rel": 20, "ret_6m_rel": 15, "ret_3m_rel": 10,
            "pct_above_200ema_252d": 10, "ema_stack_bull": 5, "tech_net_score_scaled": 5,
            "sales_yoy_q": 22.5, "np_yoy_q": 12.5,
        },
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "leisure_hospitality": Scorecard(
        pillar_weights={"q": 35, "v": 30, "m": 35},
        quality={
            "ebitda_margin_3y": 18, "roce_3y": 16, "asset_turnover": 14,
            "cfo_ebitda_3y": 10, "net_debt_ebitda": 12, "rev_cagr_5y": 12,
            "np_cagr_5y": 10, "np_consistency_5y": 8,
        },
        valuation={"ev_ebitda_ttm": 32, "pe_ttm": 22, "pb": 18, "fcf_yield": 18, "div_yield": 10},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "media_entertainment": Scorecard(
        pillar_weights={"q": 35, "v": 35, "m": 30},
        quality={
            "roce_3y": 16, "op_margin_3y": 12, "op_margin_trend": 12, "cfo_pat_3y": 12,
            "wc_days": 10, "rev_cagr_5y": 12, "np_cagr_5y": 10, "np_consistency_5y": 10,
            "debt_equity": 6,
        },
        valuation={"pe_ttm": 25, "ev_ebitda_ttm": 25, "pb": 15, "fcf_yield": 20, "div_yield": 10, "peg": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),

    # ===== C. HEALTHCARE ====================================================
    "pharma": Scorecard(
        pillar_weights={"q": 45, "v": 30, "m": 25},
        quality={
            "roce_3y": 22, "op_margin_3y": 14, "cfo_ebitda_3y": 12, "wc_days": 10,
            "rev_cagr_5y": 12, "np_cagr_5y": 12, "np_consistency_5y": 8, "op_margin_trend": 10,
        },
        valuation={"pe_ttm": 32, "ev_ebitda_ttm": 23, "peg": 22, "pb": 8, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "health_services": Scorecard(
        pillar_weights={"q": 45, "v": 30, "m": 25},
        quality={
            "roce_3y": 18, "ebitda_margin_3y": 18, "op_margin_trend": 10, "cfo_ebitda_3y": 12,
            "asset_turnover": 8, "rev_cagr_5y": 12, "np_cagr_5y": 10,
            "np_consistency_5y": 8, "net_debt_ebitda": 4,
        },
        valuation={"pe_ttm": 32, "ev_ebitda_ttm": 23, "peg": 22, "pb": 8, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "medtech": Scorecard(
        pillar_weights={"q": 45, "v": 30, "m": 25},
        quality={
            "roce_3y": 22, "op_margin_3y": 14, "cfo_ebitda_3y": 12, "wc_days": 10,
            "rev_cagr_5y": 12, "np_cagr_5y": 12, "np_consistency_5y": 8, "op_margin_trend": 10,
        },
        valuation={"pe_ttm": 32, "ev_ebitda_ttm": 23, "peg": 22, "pb": 8, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),

    # ===== D. ASSET-HEAVY CYCLICALS =========================================
    "cement": Scorecard(
        pillar_weights={"q": 35, "v": 30, "m": 35},
        quality={
            "ebitda_margin_3y": 22, "roce_3y": 18, "net_debt_ebitda": 14,
            "asset_turnover": 12, "capex_intensity_3y": 10, "op_margin_trend": 8,
            "rev_cagr_5y": 10, "np_consistency_5y": 6,
        },
        valuation={"ev_ebitda_ttm": 35, "pe_ttm": 22, "pb": 15, "fcf_yield": 18, "div_yield": 10},
        momentum={
            "ret_12m_rel": 18, "ret_6m_rel": 15, "ret_3m_rel": 10,
            "pct_above_200ema_252d": 10, "ema_stack_bull": 5, "tech_net_score_scaled": 7,
            "sales_yoy_q": 17.5, "np_yoy_q": 17.5,
        },
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "metals_ferrous": Scorecard(
        pillar_weights={"q": 35, "v": 30, "m": 35},
        quality={
            "ebitda_margin_3y": 22, "roce_3y": 18, "net_debt_ebitda": 14,
            "asset_turnover": 12, "capex_intensity_3y": 10, "op_margin_trend": 12,
            "rev_cagr_5y": 6, "np_cagr_5y": 6,
        },
        valuation={"ev_ebitda_ttm": 35, "pe_ttm": 22, "pb": 15, "fcf_yield": 18, "div_yield": 10},
        momentum={
            "ret_12m_rel": 15, "ret_6m_rel": 18, "ret_3m_rel": 15,
            "pct_above_200ema_252d": 8, "ema_stack_bull": 5, "tech_net_score_scaled": 4,
            "sales_yoy_q": 17.5, "np_yoy_q": 17.5,
        },
        loss_maker_val_fallback=_val_fallback_industrials(),
    ),
    "metals_nonferrous_mining": Scorecard(
        pillar_weights={"q": 35, "v": 30, "m": 35},
        quality={
            "ebitda_margin_3y": 22, "roce_3y": 18, "net_debt_ebitda": 14,
            "asset_turnover": 12, "capex_intensity_3y": 10, "op_margin_trend": 12,
            "rev_cagr_5y": 6, "np_cagr_5y": 6,
        },
        valuation={"ev_ebitda_ttm": 35, "pe_ttm": 22, "pb": 15, "fcf_yield": 18, "div_yield": 10},
        momentum={
            "ret_12m_rel": 15, "ret_6m_rel": 18, "ret_3m_rel": 15,
            "pct_above_200ema_252d": 8, "ema_stack_bull": 5, "tech_net_score_scaled": 4,
            "sales_yoy_q": 17.5, "np_yoy_q": 17.5,
        },
        loss_maker_val_fallback=_val_fallback_industrials(),
    ),
    "paper_forest": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 22, "ebitda_margin_3y": 18, "net_debt_ebitda": 12,
            "asset_turnover": 10, "capex_intensity_3y": 8, "rev_cagr_5y": 10,
            "np_cagr_5y": 10, "np_consistency_5y": 10,
        },
        valuation={"ev_ebitda_ttm": 32, "pe_ttm": 22, "pb": 18, "fcf_yield": 18, "div_yield": 10},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_industrials(),
    ),
    "textiles": Scorecard(
        pillar_weights={"q": 35, "v": 35, "m": 30},
        quality={
            "roce_3y": 16, "op_margin_3y": 14, "wc_days": 12, "inv_days": 10,
            "debt_equity": 14, "cfo_pat_3y": 10, "rev_cagr_5y": 12, "np_consistency_5y": 12,
        },
        valuation={"pe_ttm": 22, "pb": 25, "ev_ebitda_ttm": 20, "fcf_yield": 18, "div_yield": 15},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_industrials(),
    ),
    "oil_refining": Scorecard(
        pillar_weights={"q": 35, "v": 30, "m": 35},
        quality={
            "roce_3y": 20, "ebitda_margin_3y": 18, "op_margin_trend": 10,
            "asset_turnover": 12, "net_debt_ebitda": 12, "cfo_ebitda_3y": 10,
            "np_consistency_5y": 8, "inv_days": 10,
        },
        valuation={"ev_ebitda_ttm": 32, "pe_ttm": 22, "pb": 18, "fcf_yield": 18, "div_yield": 10},
        momentum={
            "ret_12m_rel": 18, "ret_6m_rel": 15, "ret_3m_rel": 15,
            "pct_above_200ema_252d": 10, "ema_stack_bull": 5, "tech_net_score_scaled": 2,
            "sales_yoy_q": 17.5, "np_yoy_q": 17.5,
        },
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "gas_distribution": Scorecard(
        pillar_weights={"q": 45, "v": 30, "m": 25},
        quality={
            "roce_3y": 22, "op_margin_3y": 16, "op_margin_trend": 8, "cfo_ebitda_3y": 12,
            "asset_turnover": 10, "rev_cagr_5y": 10, "np_consistency_5y": 12, "debt_equity": 10,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 28, "pb": 15, "fcf_yield": 17, "div_yield": 10},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "power": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 20, "ebitda_margin_3y": 14, "dso": 14, "net_debt_ebitda": 12,
            "asset_turnover": 10, "cfo_ebitda_3y": 10, "rev_cagr_5y": 10, "np_consistency_5y": 10,
        },
        valuation={"ev_ebitda_ttm": 32, "pe_ttm": 22, "pb": 18, "fcf_yield": 18, "div_yield": 10},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),

    # ===== E. PROJECT-LED ===================================================
    "cap_goods_industrial": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 20, "op_margin_3y": 14, "op_margin_trend": 8, "wc_days": 14,
            "inv_days": 8, "cfo_pat_3y": 10, "rev_cagr_5y": 10, "np_cagr_5y": 8,
            "np_consistency_5y": 4, "debt_equity": 4,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 25, "peg": 22, "pb": 10, "fcf_yield": 8, "div_yield": 5},
        momentum={
            "ret_12m_rel": 20, "ret_6m_rel": 15, "ret_3m_rel": 10,
            "pct_above_200ema_252d": 10, "ema_stack_bull": 5, "tech_net_score_scaled": 6,
            "sales_yoy_q": 22, "np_yoy_q": 12,
        },
        loss_maker_val_fallback=_val_fallback_industrials(),
    ),
    "cap_goods_electrical": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 20, "op_margin_3y": 14, "op_margin_trend": 12, "wc_days": 12,
            "inv_days": 8, "cfo_pat_3y": 10, "rev_cagr_5y": 10, "np_cagr_5y": 8,
            "np_consistency_5y": 4, "debt_equity": 2,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 25, "peg": 22, "pb": 10, "fcf_yield": 8, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_industrials(),
    ),
    "defense_aero": Scorecard(
        pillar_weights={"q": 40, "v": 25, "m": 35},
        quality={
            "roce_3y": 20, "op_margin_3y": 14, "op_margin_trend": 8, "wc_days": 18,
            "inv_days": 6, "cfo_pat_3y": 12, "rev_cagr_5y": 8, "np_cagr_5y": 8,
            "np_consistency_5y": 6,
        },
        valuation={"pe_ttm": 25, "peg": 35, "ev_ebitda_ttm": 20, "pb": 10, "fcf_yield": 10},
        momentum={
            "ret_12m_rel": 22, "ret_6m_rel": 15, "ret_3m_rel": 10,
            "pct_above_200ema_252d": 10, "ema_stack_bull": 5, "tech_net_score_scaled": 1,
            "sales_yoy_q": 22, "np_yoy_q": 15,
        },
        loss_maker_val_fallback=_val_fallback_industrials(),
    ),
    "construction": Scorecard(
        pillar_weights={"q": 35, "v": 30, "m": 35},
        quality={
            "roce_3y": 16, "op_margin_3y": 12, "wc_days": 20, "dso": 10,
            "cfo_sales_3y": 12, "debt_equity": 12, "rev_cagr_5y": 10,
            "np_consistency_5y": 8,
        },
        valuation={"pe_ttm": 25, "pb": 25, "ev_ebitda_ttm": 20, "fcf_yield": 15, "div_yield": 5, "peg": 10},
        momentum={
            "ret_12m_rel": 20, "ret_6m_rel": 15, "ret_3m_rel": 10,
            "pct_above_200ema_252d": 10, "ema_stack_bull": 5, "tech_net_score_scaled": 6,
            "sales_yoy_q": 22, "np_yoy_q": 12,
        },
        loss_maker_val_fallback=_val_fallback_industrials(),
    ),
    "realty": Scorecard(
        pillar_weights={"q": 35, "v": 30, "m": 35},
        quality={
            "roe_3y": 18, "inv_days": 18, "debt_equity": 18, "cfo_sales_3y": 12,
            "rev_cagr_5y": 10, "np_cagr_5y": 8, "op_margin_3y": 8, "np_consistency_5y": 8,
        },
        valuation={"pb": 35, "pe_ttm": 22, "ev_ebitda_ttm": 18, "fcf_yield": 15, "div_yield": 10},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=[("pb", 1.0)],
    ),

    # ===== F. DISTRIBUTION-LED INDUSTRIALS ==================================
    "auto_oem": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 20, "op_margin_3y": 14, "op_margin_trend": 12, "asset_turnover": 10,
            "cfo_pat_3y": 10, "rev_cagr_5y": 12, "np_cagr_5y": 8, "np_consistency_5y": 8,
            "debt_equity": 6,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 25, "peg": 18, "pb": 12, "fcf_yield": 10, "div_yield": 5},
        momentum={
            "ret_12m_rel": 18, "ret_6m_rel": 15, "ret_3m_rel": 10,
            "pct_above_200ema_252d": 10, "ema_stack_bull": 5, "tech_net_score_scaled": 2,
            "sales_yoy_q": 22, "np_yoy_q": 18,
        },
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "auto_components": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 18, "op_margin_3y": 14, "op_margin_trend": 10, "wc_days": 14,
            "cfo_pat_3y": 10, "rev_cagr_5y": 10, "np_cagr_5y": 8, "np_consistency_5y": 8,
            "debt_equity": 8,
        },
        valuation={"pe_ttm": 30, "ev_ebitda_ttm": 25, "peg": 18, "pb": 12, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),

    # ===== G. SPECIALTY MFG =================================================
    "chemicals_specialty": Scorecard(
        pillar_weights={"q": 45, "v": 30, "m": 25},
        quality={
            "roce_3y": 18, "op_margin_3y": 14, "cfo_pat_3y": 10, "capex_intensity_3y": 8,
            "asset_turnover": 8, "rev_cagr_5y": 10, "np_cagr_5y": 8, "np_consistency_5y": 6,
            "op_margin_trend": 8, "wc_days": 10,
        },
        valuation={"pe_ttm": 28, "ev_ebitda_ttm": 25, "peg": 22, "pb": 10, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "chemicals_agro": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 18, "op_margin_3y": 14, "cfo_pat_3y": 10, "capex_intensity_3y": 8,
            "asset_turnover": 8, "rev_cagr_5y": 10, "np_cagr_5y": 8, "np_consistency_5y": 12,
            "op_margin_trend": 6, "wc_days": 6,
        },
        valuation={"pe_ttm": 28, "ev_ebitda_ttm": 25, "peg": 22, "pb": 10, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),

    # ===== H. SERVICES =====================================================
    "services_commercial": Scorecard(
        pillar_weights={"q": 45, "v": 30, "m": 25},
        quality={
            "roce_3y": 22, "op_margin_3y": 14, "op_margin_trend": 8, "cfo_pat_3y": 14,
            "wc_days": 10, "rev_cagr_5y": 12, "np_cagr_5y": 10, "np_consistency_5y": 10,
        },
        valuation={"pe_ttm": 32, "ev_ebitda_ttm": 25, "peg": 18, "pb": 10, "fcf_yield": 10, "div_yield": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
    "transport_logistics": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 18, "op_margin_3y": 14, "asset_turnover": 14, "cfo_pat_3y": 12,
            "net_debt_ebitda": 10, "rev_cagr_5y": 12, "np_consistency_5y": 10, "np_cagr_5y": 10,
        },
        valuation={"pe_ttm": 28, "ev_ebitda_ttm": 28, "pb": 14, "fcf_yield": 15, "div_yield": 10, "peg": 5},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),

    # ===== I. DIVERSIFIED ===================================================
    "diversified": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={
            "roce_3y": 18, "op_margin_3y": 12, "cfo_pat_3y": 12, "rev_cagr_5y": 12,
            "np_cagr_5y": 12, "np_consistency_5y": 12, "debt_equity": 10, "roe_3y": 12,
        },
        valuation={"pe_ttm": 25, "pb": 20, "ev_ebitda_ttm": 20, "fcf_yield": 15, "div_yield": 10, "peg": 10},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),

    # ===== Fallback (catch-all for unclassified — won't actually be used) ===
    "unclassified": Scorecard(
        pillar_weights={"q": 40, "v": 30, "m": 30},
        quality={"roe_3y": 25, "op_margin_3y": 20, "rev_cagr_5y": 20, "np_cagr_5y": 20, "debt_equity": 15},
        valuation={"pe_ttm": 40, "pb": 30, "div_yield": 30},
        momentum=UNIVERSAL_MOMENTUM,
        loss_maker_val_fallback=_val_fallback_ev_sales(),
    ),
}


# -------------------------------------------------------------------------
# Validation: weights sum to 100 within each pillar
# -------------------------------------------------------------------------

def validate(card: Scorecard, cluster_id: str) -> list[str]:
    errs = []
    pw_sum = sum(card.pillar_weights.values())
    if abs(pw_sum - 100) > 0.5:
        errs.append(f"{cluster_id}: pillar weights sum to {pw_sum} (expected 100)")
    for pillar_name in ("quality", "valuation", "momentum"):
        comps = getattr(card, pillar_name)
        s = sum(comps.values())
        if abs(s - 100) > 0.5:
            errs.append(f"{cluster_id}.{pillar_name}: weights sum to {s} (expected 100)")
    return errs


def validate_all() -> list[str]:
    errs: list[str] = []
    for cid, card in SCORECARDS_MATURE.items():
        errs.extend(validate(card, cid))
    return errs


# -------------------------------------------------------------------------
# Tier-variant generator — applies the rules from docs/scorecards.md
# -------------------------------------------------------------------------

# Substitutions for VETERAN tier — every 5y/7y window goes one level deeper
# so a long-tenured stock's score reflects its longest available history.
_VET_REPLACE = {
    "np_consistency_5y": "np_consistency_10y",
    "np_consistency_7y": "np_consistency_10y",
    "book_value_cagr_5y": "book_value_cagr_10y",
    "book_value_cagr_7y": "book_value_cagr_10y",
    "op_margin_trend": "op_margin_trend_7y",
}
# Substitutions for MID tier — longer windows fall back to whatever the
# company actually has history for (typically 3y, occasionally 5y).
_MID_REPLACE = {
    "rev_cagr_5y": "rev_cagr_3y", "rev_cagr_7y": "rev_cagr_3y",
    "np_cagr_5y": "np_cagr_3y", "np_cagr_7y": "np_cagr_3y",
    "book_value_cagr_5y": "book_value_cagr_3y", "book_value_cagr_7y": "book_value_cagr_3y",
    "np_consistency_5y": "np_consistency_3y", "np_consistency_7y": "np_consistency_3y",
    "op_margin_trend": "op_margin_trend_3y",
    "roe_5y": "roe_3y", "roe_7y": "roe_3y",
    "roce_5y": "roce_3y", "roce_7y": "roce_3y",
    "op_margin_5y": "op_margin_3y", "op_margin_7y": "op_margin_3y",
}
# Substitutions for NEW tier (drop CAGR & trend & consistency; latest substitutes)
_NEW_DROP = {
    "rev_cagr_5y", "rev_cagr_3y", "rev_cagr_7y", "rev_cagr_10y",
    "np_cagr_5y", "np_cagr_3y", "np_cagr_7y", "np_cagr_10y",
    "book_value_cagr_5y", "book_value_cagr_3y", "book_value_cagr_7y", "book_value_cagr_10y",
    "np_consistency_5y", "np_consistency_3y", "np_consistency_7y", "np_consistency_10y",
    "op_margin_trend", "op_margin_trend_3y", "op_margin_trend_7y",
    "loan_book_cagr_3y",
    "earnings_yield_trend", "capex_intensity_3y",
    "roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_10y",
    "np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y",
}
_NEW_REPLACE_LATEST = {
    "roe_3y": "roe_latest", "roe_5y": "roe_latest", "roe_7y": "roe_latest",
    "roce_3y": "roce_latest", "roce_5y": "roce_latest", "roce_7y": "roce_latest",
    "op_margin_3y": "op_margin_latest",
    "op_margin_5y": "op_margin_latest", "op_margin_7y": "op_margin_latest",
    "cfo_pat_3y": "cfo_pat_latest",
    "rev_cagr_5y": "rev_yoy_latest", "rev_cagr_3y": "rev_yoy_latest",
    "np_cagr_5y": "np_yoy_latest", "np_cagr_3y": "np_yoy_latest",
}


def _renorm(weights: dict[str, float]) -> dict[str, float]:
    """Renormalize a weights dict to sum to 100."""
    s = sum(weights.values())
    if s <= 0:
        return weights
    return {k: round(v * 100 / s, 4) for k, v in weights.items()}


def _shift_pillars(pw: dict[str, float], delta_q: int) -> dict[str, float]:
    """Shift +delta_q% to Q from M (clamp 0-100)."""
    out = dict(pw)
    out["q"] = max(0, min(100, out.get("q", 0) + delta_q))
    out["m"] = max(0, min(100, out.get("m", 0) - delta_q))
    return out


def make_veteran(card: Scorecard) -> Scorecard:
    new_q = {}
    for k, v in card.quality.items():
        new_q[_VET_REPLACE.get(k, k)] = new_q.get(_VET_REPLACE.get(k, k), 0) + v
    # Add graduated track-record bonuses. Two threshold metrics × 3 windows
    # (5y / 7y / 10y), each adding to a total bonus of 10 — same overall budget
    # as before but spread across windows. The 10y window still carries the
    # most weight (2.5 each) because a decade of consistent ROE/NP growth is
    # the strongest signal; 7y is 1.5 each; 5y is 1.0 each. This rewards
    # graduated durability without making 10-yr-old companies dominate scoring.
    if not new_q:
        return card
    bonus_total = 10
    factor = (sum(new_q.values()) - bonus_total) / sum(new_q.values())
    new_q = {k: round(v * factor, 4) for k, v in new_q.items()}
    new_q["roe_avg_above_threshold_5y"] = 1.0
    new_q["roe_avg_above_threshold_7y"] = 1.5
    new_q["roe_avg_above_threshold_10y"] = 2.5
    new_q["np_growth_above_inflation_5y"] = 1.0
    new_q["np_growth_above_inflation_7y"] = 1.5
    new_q["np_growth_above_inflation_10y"] = 2.5

    return Scorecard(
        pillar_weights=_shift_pillars(card.pillar_weights, +5),
        quality=_renorm(new_q),
        valuation=card.valuation,
        momentum=card.momentum,
        loss_maker_val_fallback=card.loss_maker_val_fallback,
    )


def make_mid(card: Scorecard) -> Scorecard:
    new_q = {}
    for k, v in card.quality.items():
        new_q[_MID_REPLACE.get(k, k)] = new_q.get(_MID_REPLACE.get(k, k), 0) + v
    return Scorecard(
        pillar_weights=_shift_pillars(card.pillar_weights, -5),
        quality=_renorm(new_q),
        valuation=card.valuation,
        momentum=card.momentum,
        loss_maker_val_fallback=card.loss_maker_val_fallback,
    )


def make_new(card: Scorecard) -> Scorecard:
    new_q = {}
    for k, v in card.quality.items():
        if k in _NEW_DROP:
            continue  # drop CAGR/trend/consistency
        nk = _NEW_REPLACE_LATEST.get(k, k)
        new_q[nk] = new_q.get(nk, 0) + v
    return Scorecard(
        pillar_weights=_shift_pillars(card.pillar_weights, -15),
        quality=_renorm(new_q) if new_q else {"roe_latest": 50, "op_margin_latest": 50},
        valuation=card.valuation,
        momentum=card.momentum,
        loss_maker_val_fallback=card.loss_maker_val_fallback,
    )


def get_scorecard(cluster_id: str, tier: str) -> Scorecard:
    base = SCORECARDS_MATURE.get(cluster_id) or SCORECARDS_MATURE["unclassified"]
    if tier == "mature":
        return base
    if tier == "veteran":
        return make_veteran(base)
    if tier == "mid":
        return make_mid(base)
    if tier == "new":
        return make_new(base)
    raise ValueError(f"Unknown tier: {tier}")


# -------------------------------------------------------------------------
# DB-backed loader (reads app.cluster_scorecard_active; falls back to SCORECARDS_MATURE)
# -------------------------------------------------------------------------

def _row_to_scorecard(row: dict) -> Scorecard:
    """Convert a cluster_scorecard row (with JSONB fields) into a Scorecard dataclass."""
    pw = row["pillar_weights"]
    fb_raw = row.get("loss_maker_val_fallback") or []
    fb = [(item[0], float(item[1])) for item in fb_raw]
    return Scorecard(
        pillar_weights={k: float(v) for k, v in pw.items()},
        quality={k: float(v) for k, v in (row["quality"] or {}).items()},
        valuation={k: float(v) for k, v in (row["valuation"] or {}).items()},
        momentum={k: float(v) for k, v in (row["momentum"] or {}).items()},
        loss_maker_val_fallback=fb,
    )


def load_db_overrides(conn) -> dict[str, Scorecard]:
    """Read app.cluster_scorecard_active. Returns {cluster_id: Scorecard} for any cluster
    that has a row. Clusters without a DB row fall back to Python defaults."""
    out: dict[str, Scorecard] = {}
    with conn.cursor() as cur:
        cur.execute("""
            SELECT cluster_id, pillar_weights, quality, valuation, momentum, loss_maker_val_fallback
            FROM app.cluster_scorecard_active
        """)
        for r in cur.fetchall():
            out[r["cluster_id"]] = _row_to_scorecard(r)
    return out


def get_scorecard_from(overrides: dict[str, Scorecard], cluster_id: str, tier: str) -> Scorecard:
    """Tier-variant generation from a (DB-or-Python) base scorecard."""
    base = overrides.get(cluster_id) or SCORECARDS_MATURE.get(cluster_id) or SCORECARDS_MATURE["unclassified"]
    if tier == "mature":
        return base
    if tier == "veteran":
        return make_veteran(base)
    if tier == "mid":
        return make_mid(base)
    if tier == "new":
        return make_new(base)
    raise ValueError(f"Unknown tier: {tier}")
