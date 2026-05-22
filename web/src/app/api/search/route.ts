/** Stock search API — symbol prefix + company-name substring with peer scoring metadata. */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
// Symbol list changes only when new stocks are added (rare). 1h cache instead
// of 1min cuts Neon wakes from search activity by 60x.
export const revalidate = 3600;

type Hit = {
  symbol: string;
  company_name: string;
  industry_name: string | null;
  industry_id: string | null;
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
           c.name AS industry_name,
           c.id   AS industry_id,
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
