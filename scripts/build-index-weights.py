#!/usr/bin/env python3
"""
build-index-weights.py — generate web/src/lib/indexWeights.ts from the NSE
index Fact Sheet PDFs in factsheet/.

NSE/niftyindices block server fetches and only publish the TOP ~10 constituents
by weight (monthly PDF). We can't ingest weights at runtime, so this offline
tool parses the factsheets we've saved locally and emits the curated TS table
the /indices constituents view reads. Re-run it whenever you refresh the
factsheets (NSE rebalances semi-annually, cut-off Jan 31 / Jul 31).

HOW:
  1. pdftotext -layout each factsheet → find the "Top constituents by
     weightage" block → parse (company name, weight%).
  2. Map company name → bare NSE symbol via that index's list CSV (names match
     verbatim between factsheet and list CSV — same NSE source). For broad
     indices with no local list CSV, fall back to a union of every list CSV in
     factsheet/. Unmapped names are reported and skipped (UI shows "—").
  3. Emit web/src/lib/indexWeights.ts.

USAGE:  python scripts/build-index-weights.py
Requires: pdftotext (poppler) on PATH.
"""
from __future__ import annotations

import csv
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FACTSHEET_DIR = REPO / "factsheet"
OUT = REPO / "web" / "src" / "lib" / "indexWeights.ts"

# Board index_code → (factsheet pdf, own list csv | None). Filenames are exact
# (NSE's casing is inconsistent, so we don't glob).
INDEX_FILES: dict[str, tuple[str, str | None]] = {
    "NIFTY50":          ("ind_nifty50.pdf",          None),
    "NIFTYNEXT50":      ("ind_next50.pdf",           None),
    "NIFTY100":         ("ind_nifty_100.pdf",        None),
    "NIFTY500":         ("ind_nifty_500.pdf",        None),
    "NIFTYMIDCAP100":   ("ind_niftymidcap100.pdf",   None),
    "NIFTYSMALLCAP100": ("ind_niftysmallcap100.pdf", None),
    "NIFTYBANK":        ("ind_nifty_bank.pdf",        "ind_niftybanklist.csv"),
    "NIFTYIT":          ("ind_nifty_it.pdf",          "ind_niftyitlist.csv"),
    "NIFTYAUTO":        ("ind_nifty_auto.pdf",        "ind_niftyautolist.csv"),
    "NIFTYFMCG":        ("ind_nifty_FMCG.pdf",        "ind_niftyfmcglist.csv"),
    "NIFTYPHARMA":      ("ind_nifty_pharma.pdf",      "ind_niftypharmalist.csv"),
    "NIFTYMETAL":       ("ind_nifty_metal.pdf",       "ind_niftymetallist.csv"),
    "NIFTYREALTY":      ("ind_nifty_realty.pdf",      "ind_niftyrealtylist.csv"),
    # NIFTYENERGY: no factsheet saved yet → not emitted (UI shows "not added").
}

DATE_RE = re.compile(r"([A-Z][a-z]+ \d{1,2}, \d{4})")
# "<company name>  <weight>" — ≥2 spaces between name and the trailing number.
ROW_RE = re.compile(r"^\s*(.+?)\s{2,}(\d+(?:\.\d+)?)\s*$")


def norm_name(s: str) -> str:
    """Normalise a company name for matching across factsheet vs list CSV."""
    s = s.replace("’", "'").lower()
    s = re.sub(r"[^a-z0-9& ]", " ", s)
    s = re.sub(r"\b(ltd|limited)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_symbol_map(csv_path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not csv_path.exists():
        return out
    with csv_path.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sym = (row.get("Symbol") or "").strip().upper()
            name = (row.get("Company Name") or "").strip()
            if sym and name:
                out[norm_name(name)] = sym
    return out


def global_symbol_map() -> dict[str, str]:
    """Union of every list CSV in factsheet/ — fallback for broad indices."""
    out: dict[str, str] = {}
    for p in FACTSHEET_DIR.glob("*list*.csv"):
        out.update(load_symbol_map(p))
    return out


def pdf_text(pdf: Path) -> str:
    return subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"],
        capture_output=True, text=True, check=True,
    ).stdout


def parse_factsheet(text: str) -> tuple[str | None, list[tuple[str, float]]]:
    """Return (factsheet_date, [(company_name, weight), ...]) for the top
    constituents block."""
    date_m = DATE_RE.search(text)
    # ISO-ify the date for the TS file.
    as_of = None
    if date_m:
        try:
            from datetime import datetime
            as_of = datetime.strptime(date_m.group(1), "%B %d, %Y").strftime("%Y-%m-%d")
        except ValueError:
            as_of = None

    lines = text.splitlines()
    start = next((i for i, ln in enumerate(lines) if "top constituents by weightage" in ln.lower()), None)
    if start is None:
        return as_of, []

    rows: list[tuple[str, float]] = []
    for ln in lines[start + 1:]:
        m = ROW_RE.match(ln)
        if not m:
            # stop once we've started collecting and hit a non-row line
            if rows:
                break
            continue
        name, wt = m.group(1).strip(), float(m.group(2))
        # The "Company's Name  Weight(%)" header never matches ROW_RE (no
        # trailing number), so no skip is needed. (Do NOT filter on the word
        # "company" — it'd drop real names like "TVS Motor Company Ltd.")
        rows.append((name, wt))
        if len(rows) >= 15:
            break
    return as_of, rows


def main() -> None:
    glob_map = global_symbol_map()
    weights: dict[str, list[tuple[str, float]]] = {}
    as_of_map: dict[str, str] = {}
    unmatched: list[str] = []

    for code, (pdf_name, csv_name) in INDEX_FILES.items():
        pdf = FACTSHEET_DIR / pdf_name
        if not pdf.exists():
            print(f"  ! {code}: factsheet {pdf_name} missing — skipped", file=sys.stderr)
            continue
        own_map = load_symbol_map(FACTSHEET_DIR / csv_name) if csv_name else {}
        as_of, rows = parse_factsheet(pdf_text(pdf))
        if as_of:
            as_of_map[code] = as_of
        entries: list[tuple[str, float]] = []
        for name, wt in rows:
            key = norm_name(name)
            sym = own_map.get(key) or glob_map.get(key)
            if not sym:
                unmatched.append(f"{code}: '{name}'")
                continue
            entries.append((sym, wt))
        if entries:
            weights[code] = entries
            print(f"  ✓ {code}: {len(entries)}/{len(rows)} mapped (as_of {as_of_map.get(code, '?')})")
        else:
            print(f"  ! {code}: 0 mapped of {len(rows)} parsed", file=sys.stderr)

    if unmatched:
        print("\n  Unmatched names (no symbol — left out, UI shows '—'):", file=sys.stderr)
        for u in unmatched:
            print(f"    - {u}", file=sys.stderr)

    emit(weights, as_of_map)
    print(f"\nWrote {OUT.relative_to(REPO)} — {len(weights)} indices.")


def emit(weights: dict[str, list[tuple[str, float]]], as_of: dict[str, str]) -> None:
    lines: list[str] = []
    lines.append("/**")
    lines.append(" * Curated index constituent weights — REAL NSE free-float index weights,")
    lines.append(" * extracted from the index Fact Sheet PDFs in factsheet/ by")
    lines.append(" * scripts/build-index-weights.py. GENERATED FILE — do not edit by hand;")
    lines.append(" * refresh the factsheets and re-run the script after NSE rebalances.")
    lines.append(" *")
    lines.append(" * Factsheets publish only the TOP ~10 by weight, so the long tail of each")
    lines.append(" * index carries no weight here (the UI shows \"—\"). Keyed by bare NSE")
    lines.append(" * symbol (matches app.index_constituent.symbol).")
    lines.append(" */")
    lines.append("export type IndexWeight = { symbol: string; weight: number };")
    lines.append("")
    lines.append("export const INDEX_WEIGHTS_AS_OF: Record<string, string> = {")
    for code in weights:
        if code in as_of:
            lines.append(f"  {code}: {js(as_of[code])},")
    lines.append("};")
    lines.append("")
    lines.append("export const INDEX_WEIGHTS: Record<string, IndexWeight[]> = {")
    for code, entries in weights.items():
        lines.append(f"  {code}: [")
        for sym, wt in entries:
            lines.append(f"    {{ symbol: {js(sym)}, weight: {wt} }},")
        lines.append("  ],")
    lines.append("};")
    lines.append("")
    lines.append("/** symbol → weight for an index (empty map when none curated yet). */")
    lines.append("export function weightsForIndex(code: string): Map<string, number> {")
    lines.append("  return new Map((INDEX_WEIGHTS[code] ?? []).map((w) => [w.symbol, w.weight]));")
    lines.append("}")
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")


def js(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


if __name__ == "__main__":
    main()
