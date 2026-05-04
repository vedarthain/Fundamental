/** Stock search API — symbol prefix + company-name substring with peer scoring metadata. */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const revalidate = 60; // Cache for 1 min — universe changes slowly

type Hit = {
  symbol: string;
  company_name: string;
  cluster_name: string | null;
  cluster_id: string | null;
  composite_pct: number | null;
};

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 1) {
    return NextResponse.json({ hits: [] });
  }
  // Cap input length to avoid abuse
  const term = q.slice(0, 60);
  const prefix = term + "%";
  const substr = "%" + term + "%";

  const hits = await sql<Hit[]>`
    SELECT u.symbol,
           u.company_name,
           c.name AS cluster_name,
           c.id   AS cluster_id,
           s.composite_pct
    FROM app.universe u
    LEFT JOIN app.cluster_assignment ca USING (symbol)
    LEFT JOIN app.cluster c ON c.id = ca.cluster_id
    LEFT JOIN app.scores s
      ON s.symbol = u.symbol
     AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
    WHERE u.is_active
      AND (u.symbol ILIKE ${prefix} OR u.company_name ILIKE ${substr})
    ORDER BY
      CASE WHEN u.symbol ILIKE ${prefix} THEN 0 ELSE 1 END,
      LENGTH(u.symbol),
      u.symbol
    LIMIT 10
  `;
  return NextResponse.json({ hits });
}
