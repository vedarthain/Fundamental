#!/usr/bin/env python3
"""
generate-scorecards-doc.py — write a markdown reference of every active
per-industry scorecard to docs/SCORECARDS_BY_INDUSTRY.md.

Reads from `app.cluster_scorecard_active`, formats one section per sector
with one block per industry showing:
  - Pillar weights (Quality / Valuation / Momentum)
  - All formulas in each pillar with their weights, sorted descending

Re-run after tuning scorecards. The output is a *snapshot* — point-in-time
view of what the engine is using right now.

Usage:
    etl/.venv/bin/python scripts/generate-scorecards-doc.py
"""
from __future__ import annotations

import os
import re
import sys
from datetime import date
from pathlib import Path

import psycopg


def env_app_db_url() -> str:
    """Read APP_DB_URL from .env.local at repo root."""
    repo = Path(__file__).resolve().parent.parent
    env = (repo / ".env.local").read_text()
    for line in env.splitlines():
        if line.startswith("APP_DB_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("APP_DB_URL not found in .env.local")


def fmt_pillar(d: dict) -> str:
    """Format a {formula: weight} dict as 'formula(w), formula(w), …' sorted by w desc."""
    if not d:
        return "—"
    items = sorted(d.items(), key=lambda kv: kv[1], reverse=True)
    return ", ".join(f"`{k}`({_fmt_weight(v)})" for k, v in items)


def _fmt_weight(w) -> str:
    # Trim trailing .0 from floats; keep one decimal for fractional weights.
    if isinstance(w, (int,)) or (isinstance(w, float) and w.is_integer()):
        return str(int(w))
    return f"{w:.1f}"


def main() -> None:
    repo = Path(__file__).resolve().parent.parent
    out_path = repo / "docs" / "SCORECARDS_BY_INDUSTRY.md"

    with psycopg.connect(env_app_db_url(), row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT mc.name AS sector, c.name AS industry, c.id AS industry_id,
                       csa.pillar_weights, csa.quality, csa.valuation, csa.momentum,
                       csa.loss_maker_val_fallback
                FROM app.cluster_scorecard_active csa
                JOIN app.cluster c ON c.id = csa.cluster_id
                JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
                ORDER BY mc.name, c.name
                """
            )
            rows = cur.fetchall()

    sectors: dict[str, list[dict]] = {}
    for r in rows:
        sectors.setdefault(r["sector"], []).append(r)

    lines: list[str] = []
    lines.append("# Per-Industry Scorecards")
    lines.append("")
    lines.append(
        f"Generated {date.today().isoformat()} by "
        "`scripts/generate-scorecards-doc.py`. Re-run after tuning."
    )
    lines.append("")
    lines.append(
        f"**{len(rows)} active scorecards** across **{len(sectors)} sectors**. "
        "Every industry has its own pillar blend (Quality / Valuation / Momentum) "
        "and its own per-pillar formula weights. Per `MOAT.md` Moat #2: "
        "*\"banks judged on bank metrics, IT firms on IT metrics — not blanket rules.\"*"
    )
    lines.append("")
    lines.append(
        "Within each formula list, weights are shown in parentheses and sorted "
        "high → low so the most-impactful signals appear first."
    )
    lines.append("")
    lines.append("---")
    lines.append("")

    for sector, industries in sectors.items():
        lines.append(f"## {sector}")
        lines.append("")
        lines.append(f"_{len(industries)} {'industry' if len(industries) == 1 else 'industries'}_")
        lines.append("")
        for r in industries:
            pw = r["pillar_weights"] or {}
            q = r["quality"] or {}
            v = r["valuation"] or {}
            m = r["momentum"] or {}
            lines.append(f"### {r['industry']}  ·  `{r['industry_id']}`")
            lines.append("")
            lines.append(
                f"**Pillars** — Quality **{_fmt_weight(pw.get('q', 0))}**, "
                f"Valuation **{_fmt_weight(pw.get('v', 0))}**, "
                f"Momentum **{_fmt_weight(pw.get('m', 0))}**"
            )
            lines.append("")
            lines.append(f"- **Quality ({len(q)})** — {fmt_pillar(q)}")
            lines.append(f"- **Valuation ({len(v)})** — {fmt_pillar(v)}")
            lines.append(f"- **Momentum ({len(m)})** — {fmt_pillar(m)}")
            if r.get("loss_maker_val_fallback"):
                lines.append(
                    f"- _Loss-maker fallback_: {r['loss_maker_val_fallback']}"
                )
            lines.append("")
        lines.append("---")
        lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines))
    print(f"✓ wrote {out_path.relative_to(repo)} ({len(rows)} scorecards)")


if __name__ == "__main__":
    main()
