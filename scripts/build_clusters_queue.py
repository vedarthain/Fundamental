#!/usr/bin/env python3
"""Generate clusters_queue.json and clusters_queue.txt."""

from __future__ import annotations

import json
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parent.parent

with psycopg.connect("postgres:///fundamental_app") as conn:
    with conn.cursor() as cur:
        cur.execute("""
            WITH yesterday_clusters AS (
                SELECT 
                    c.id AS cluster_id,
                    c.name AS cluster_name,
                    count(ca.symbol) AS total_stocks,
                    count(DISTINCT CASE WHEN v.generated_at >= '2026-10-25' AND v.generated_at < '2026-10-26' THEN v.symbol END) AS yesterday_count,
                    count(DISTINCT CASE WHEN v.generated_at >= '2026-10-26' THEN v.symbol END) AS today_count
                FROM app.cluster c
                JOIN app.cluster_assignment ca ON ca.cluster_id = c.id
                LEFT JOIN app.stock_verdict v ON v.symbol = ca.symbol
                WHERE c.id != 'unclassified'
                GROUP BY c.id, c.name
            )
            SELECT 
                cluster_id, cluster_name, total_stocks, yesterday_count, today_count,
                CASE WHEN yesterday_count > 0 THEN 1 ELSE 2 END as group_order
            FROM yesterday_clusters
            ORDER BY 
                group_order ASC,
                CASE WHEN yesterday_count > 0 THEN yesterday_count ELSE total_stocks END ASC,
                total_stocks ASC;
        """)
        rows = cur.fetchall()

clusters = []
hdr = f"{'IDX':<5} | {'CLUSTER ID':<32} | {'YESTERDAY':<10} | {'TODAY':<8} | {'TOTAL':<8} | {'CLUSTER NAME'}"
txt_lines = [
    "=" * 95,
    hdr,
    "=" * 95,
    "--- PHASE 1: REDO YESTERDAY VERDICTS (CLUSTERS 1 TO 27) ---"
]

for idx, r in enumerate(rows, 1):
    cid, name, total, y_cnt, t_cnt, grp = r
    rem_yesterday = max(0, y_cnt - t_cnt)
    item = {
        "index": idx,
        "cluster_id": cid,
        "cluster_name": name,
        "total_stocks": total,
        "yesterday_stocks": y_cnt,
        "today_stocks": t_cnt,
        "remaining_to_refresh": rem_yesterday if grp == 1 else total,
        "phase": "redo_yesterday" if grp == 1 else "refill_universe"
    }
    clusters.append(item)
    if idx == 28:
        txt_lines.append("-" * 95)
        txt_lines.append("--- PHASE 2: REFILL REMAINING UNIVERSE (CLUSTERS 28 TO 72) ---")
    txt_lines.append(f"[{idx:>2}]  | {cid:<32} | {y_cnt:>9} | {t_cnt:>7} | {total:>7} | {name}")

txt_lines.append("=" * 95)

(ROOT / "clusters_queue.json").write_text(json.dumps(clusters, indent=2))
(ROOT / "clusters_queue.txt").write_text("\n".join(txt_lines))
print(f"Generated clusters_queue.json and clusters_queue.txt with {len(clusters)} clusters.")
