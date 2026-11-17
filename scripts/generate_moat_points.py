#!/usr/bin/env python3
"""generate_moat_points.py — Derive structured Moat key points using local Ollama.

Reads company_overview, universe.business_summary, cluster context, and key
fundamental metrics from Neon/Postgres and asks local Ollama to synthesize
3-4 crisp, specific Moat bullet points + moat_strength + moat_type.

Usage:
    etl/.venv/bin/python scripts/generate_moat_points.py --cluster "Dyes, Pigments & Colorants"
    etl/.venv/bin/python scripts/generate_moat_points.py --sector "Materials" --limit 50
    etl/.venv/bin/python scripts/generate_moat_points.py --all --resume
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import psycopg


def load_db_url() -> str:
    if os.environ.get("APP_DB_URL"):
        return os.environ["APP_DB_URL"]
    for p in ("web/.env.local", "web/.env.production", "web/.env", ".env"):
        if os.path.exists(p):
            with open(p) as f:
                for line in f:
                    if line.startswith("APP_DB_URL="):
                        return line.split("=", 1)[1].strip().strip("\"'")
    raise RuntimeError("APP_DB_URL not found in environment or .env files")


def ensure_table(cur: psycopg.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS app.company_moat (
            symbol TEXT PRIMARY KEY,
            moat_strength TEXT NOT NULL DEFAULT 'Narrow',
            moat_type TEXT NOT NULL DEFAULT 'Niche / Operational',
            moat_points JSONB NOT NULL DEFAULT '[]'::jsonb,
            model TEXT,
            generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)


def pick_default_model(ollama_url: str) -> str:
    try:
        req = urllib.request.Request(f"{ollama_url}/api/tags")
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
            models = [m["name"] for m in data.get("models", [])]
            for pref in ("qwen2.5:14b", "qwen2.5:7b", "qwen2.5:latest", "llama3.1:8b", "llama3.1:latest", "gemma2:9b"):
                if pref in models:
                    return pref
            if models:
                return models[0]
    except Exception:
        pass
    return "qwen2.5:7b"


def call_ollama(ollama_url: str, model: str, prompt: str) -> dict:
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.2, "num_predict": 450},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{ollama_url}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.loads(r.read().decode("utf-8"))
    raw = res.get("response", "").strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            raise ValueError(f"Non-JSON response from Ollama: {raw[:200]}")
        parsed = json.loads(m.group(0))

    strength = str(parsed.get("moat_strength", "Narrow")).strip().title()
    if strength not in ("Wide", "Narrow", "None"):
        strength = "Narrow"
    mtype = str(parsed.get("moat_type", "Niche / Operational")).strip()[:80]
    pts = parsed.get("moat_points", [])
    if not isinstance(pts, list):
        pts = [str(pts)]
    clean_pts = [str(p).strip() for p in pts if str(p).strip()][:4]
    if not clean_pts:
        raise ValueError("Empty moat_points returned")
    return {"moat_strength": strength, "moat_type": mtype, "moat_points": clean_pts}


def build_prompt(row: dict) -> str:
    overview_lines = []
    if row.get("overview_rows"):
        for item in row["overview_rows"]:
            if isinstance(item, dict) and item.get("label") and item.get("value"):
                overview_lines.append(f"- {item['label']}: {item['value']}")
    overview_text = "\n".join(overview_lines) or "N/A"
    summary = (row.get("business_summary") or "N/A")[:800]
    verdict = (row.get("verdict") or "N/A")[:300]

    return f"""You are an equity research analyst evaluating the competitive moat of an Indian NSE-listed company.
Do NOT repeat generic company descriptions. Derive concrete, analytical MOAT KEY POINTS (what protects its pricing power, market share, cost structure, or why it lacks a moat).

Company: {row['company_name']} ({row['symbol']})
Sector: {row['sector_name']} | Cluster: {row['cluster_name']}
Market Cap: ₹{row['market_cap_cr']:.0f} Cr
Scores (0-100): Composite {row['composite_pct']:.0f} | Quality {row['quality_pct']:.0f} | Valuation {row['valuation_pct']:.0f} | Momentum {row['momentum_pct']:.0f}
Latest Verdict Context: {verdict}

Structured Overview:
{overview_text}

Business Summary:
{summary}

Return ONLY valid JSON with this exact schema:
{{
  "moat_strength": "Wide" | "Narrow" | "None",
  "moat_type": "2-4 word moat label, e.g. Brand & Distribution, Cost & Integration, Niche Specialty, Commodity / Cyclical",
  "moat_points": [
    "Core Edge: 1 concise sentence on its specific competitive advantage (or lack thereof)",
    "Product / Market Position: 1 concise sentence on niche, scale, integration, or customer stickiness",
    "Financial Proof: 1 concise sentence linking quality/margin/capital efficiency to its moat",
    "Key Moat Risk: 1 concise sentence on what can erode this moat (cyclicality, raw material, competition)"
  ]
}}"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cluster", help="Exact cluster name to process")
    ap.add_argument("--sector", help="Sector name (ILIKE match)")
    ap.add_argument("--symbol", help="Single symbol")
    ap.add_argument("--all", action="store_true", help="Process all clusters/sectors (default when no filter is passed)")
    ap.add_argument("--limit", type=int, default=0, help="Max symbols to process (0 = no limit)")
    ap.add_argument("--model", help="Ollama model name (auto-detected if omitted)")
    ap.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    ap.add_argument("--resume", action="store_true", help="Skip symbols already in app.company_moat")
    args = ap.parse_args()

    db_url = load_db_url()
    model = args.model or pick_default_model(args.ollama_url)
    print(f"Using Ollama model: {model} ({args.ollama_url})")

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            ensure_table(cur)
            conn.commit()

            where = ["1=1"]
            params: list = []
            if args.symbol:
                where.append("p.symbol = %s")
                params.append(args.symbol.upper())
            if args.cluster:
                where.append("cl.name = %s")
                params.append(args.cluster)
            if args.sector:
                where.append("mc.name ILIKE %s")
                params.append(f"%{args.sector}%")
            if args.resume:
                where.append("m.symbol IS NULL")

            limit_sql = f"LIMIT {int(args.limit)}" if args.limit > 0 else ""

            cur.execute(f"""
                WITH latest_panel AS (
                    SELECT DISTINCT ON (symbol)
                        symbol, company_name, cluster_id, market_cap_cr,
                        composite_pct, quality_pct, valuation_pct, momentum_pct
                    FROM app.cluster_stocks_panel_cache
                    ORDER BY symbol, snapshot_date DESC
                ),
                latest_verdict AS (
                    SELECT DISTINCT ON (symbol) symbol, verdict
                    FROM app.stock_verdict
                    ORDER BY symbol, generated_at DESC
                )
                SELECT
                    p.symbol,
                    COALESCE(p.company_name, u.company_name, p.symbol) AS company_name,
                    COALESCE(mc.name, 'General') AS sector_name,
                    COALESCE(cl.name, 'General') AS cluster_name,
                    COALESCE(p.market_cap_cr, 0)::float AS market_cap_cr,
                    COALESCE(p.composite_pct, 0)::float AS composite_pct,
                    COALESCE(p.quality_pct, 0)::float AS quality_pct,
                    COALESCE(p.valuation_pct, 0)::float AS valuation_pct,
                    COALESCE(p.momentum_pct, 0)::float AS momentum_pct,
                    u.business_summary,
                    co.rows AS overview_rows,
                    v.verdict
                FROM latest_panel p
                LEFT JOIN app.cluster cl ON cl.id = p.cluster_id
                LEFT JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
                LEFT JOIN app.universe u ON u.symbol = p.symbol
                LEFT JOIN app.company_overview co ON co.symbol = p.symbol
                LEFT JOIN latest_verdict v ON v.symbol = p.symbol
                LEFT JOIN app.company_moat m ON m.symbol = p.symbol
                WHERE {' AND '.join(where)}
                ORDER BY p.composite_pct DESC NULLS LAST
                {limit_sql}
            """, params)

            cols = [d[0] for d in cur.description]
            targets = [dict(zip(cols, r)) for r in cur.fetchall()]

        print(f"Found {len(targets)} target symbol(s) to process.")
        ok = 0
        for idx, row in enumerate(targets, 1):
            t0 = time.perf_counter()
            sym = row["symbol"]
            try:
                out = call_ollama(args.ollama_url, model, build_prompt(row))
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO app.company_moat (symbol, moat_strength, moat_type, moat_points, model, generated_at)
                        VALUES (%s, %s, %s, %s::jsonb, %s, now())
                        ON CONFLICT (symbol) DO UPDATE SET
                            moat_strength = EXCLUDED.moat_strength,
                            moat_type = EXCLUDED.moat_type,
                            moat_points = EXCLUDED.moat_points,
                            model = EXCLUDED.model,
                            generated_at = now()
                    """, (sym, out["moat_strength"], out["moat_type"], json.dumps(out["moat_points"]), model))
                conn.commit()
                ok += 1
                dt = time.perf_counter() - t0
                print(f"[{idx}/{len(targets)}] {sym:12s} | {out['moat_strength']:6s} | {out['moat_type']} ({dt:.1f}s)")
            except Exception as e:
                print(f"[{idx}/{len(targets)}] {sym:12s} | ERROR: {e}", file=sys.stderr)

    print(f"Done: {ok}/{len(targets)} saved to app.company_moat.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
