"""Curated register of InvIT / REIT names covered for DIVIDENDS ONLY.

These are trusts, not companies (units not shares, distributions not equity
dividends), so they are deliberately kept OUT of app.universe — the scored
equity universe — and never enter clustering or the Q/V/M engine. See
db/migrations/0046_dividend_only.sql for the rationale.

The list is small and hand-maintained: there are only a handful of liquid,
NSE-listed InvITs/REITs. New listings get added here by hand. Screener.in
covers all of them under the same export the equity path uses (verified live:
PGINVIT export_id 65215754 carries a per-FY 'Dividend Amount' row).

`sector` / `industry` drive the Dividend Scanner's tree grouping. We put every
name under one synthetic sector so they read as a distinct asset class and do
not inflate equity sector counts.
"""
from __future__ import annotations

from dataclasses import dataclass

SECTOR = "InvITs & REITs"


@dataclass(frozen=True)
class DividendOnlyName:
    symbol: str
    company_name: str
    industry: str  # finer grouping under SECTOR


# NSE-listed InvITs & REITs. Symbols must match Screener.in's ticker exactly.
DIVIDEND_ONLY: list[DividendOnlyName] = [
    DividendOnlyName("PGINVIT",  "PowerGrid Infrastructure Investment Trust", "Power InvIT"),
    DividendOnlyName("INDIGRID", "India Grid Trust",                          "Power InvIT"),
    DividendOnlyName("IRBINVIT", "IRB InvIT Fund",                            "Roads InvIT"),
    DividendOnlyName("EMBASSY",  "Embassy Office Parks REIT",                 "Office REIT"),
    DividendOnlyName("MINDSPACE","Mindspace Business Parks REIT",             "Office REIT"),
    DividendOnlyName("NXST",     "Nexus Select Trust",                        "Retail REIT"),
]
