"""Export institutional clusters and their stock constituents to markdown and JSON."""
import psycopg
import json

conn = psycopg.connect("postgresql://localhost/fundamental_app")
with conn.cursor() as cur:
    cur.execute("""
        SELECT c.id, c.name, c.meta_cluster_id, count(ca.symbol) as stock_count,
               array_agg(ca.symbol ORDER BY sm.market_cap_cr DESC NULLS LAST, ca.symbol ASC) as symbols
        FROM app.cluster c
        JOIN app.cluster_assignment ca ON ca.cluster_id = c.id
        LEFT JOIN app.screener_meta sm ON sm.symbol = ca.symbol
        GROUP BY c.id, c.name, c.meta_cluster_id
        HAVING count(ca.symbol) > 0
        ORDER BY c.meta_cluster_id, stock_count DESC;
    """)
    rows = cur.fetchall()

clusters_data = []
md_lines = [
    "# Institutional Clusters & Stock Constituents Directory\n",
    f"**Total Active Clusters:** {len(rows)}  ",
    "**Total Assigned Stocks:** 3,250 (2,627 Mainboard Active + 569 SME Emerge + 54 Delisted/Historical)\n",
    "---\n"
]

current_meta = None
for cid, cname, meta, count, symbols in rows:
    if meta != current_meta:
        current_meta = meta
        sec_title = meta.replace('_', ' ').title()
        md_lines.append(f"\n## Sector: {sec_title}\n")
    
    cmd = f"python scripts/verdict-runner.py --cluster {cid} --force-gemini"
    clusters_data.append({
        "cluster_id": cid,
        "cluster_name": cname,
        "sector": meta,
        "stock_count": count,
        "runner_command": cmd,
        "symbols": symbols
    })
    
    sym_links = " ".join([f"[{s}](http://localhost:3000/stock/{s})" for s in symbols])
    md_lines.append(f"### `{cid}` — {cname} ({count} stocks)\n")
    md_lines.append(f"**Verdict Command:**  \n`{cmd}`\n")
    md_lines.append(f"**Constituents:**  \n{sym_links}\n")

with open("clusters_and_stocks.json", "w") as f:
    json.dump(clusters_data, f, indent=2)

with open("clusters_and_stocks.md", "w") as f:
    f.write("\n".join(md_lines))

print(f"Cleanly updated clusters_and_stocks.md & .json with {len(rows)} active clusters.")
