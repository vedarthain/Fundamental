import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

let cached: { latest: string | null; coverage: number; clusters: number; fetchedAt: number } | null = null;
const TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET() {
  const now = Date.now();
  if (cached && cached.coverage > 0 && now - cached.fetchedAt < TTL_MS) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
    });
  }

  try {
    const rows = await sql<{ latest: Date | string | null; coverage: string; clusters: string }[]>`
      WITH latest AS (SELECT MAX(snapshot_date) AS d FROM app.scores)
      SELECT
        (SELECT d FROM latest) AS latest,
        (SELECT COUNT(*) FROM app.scores WHERE snapshot_date = (SELECT d FROM latest)) AS coverage,
        (SELECT COUNT(*) FROM app.cluster_composite_cache
          WHERE snapshot_date = (SELECT d FROM latest)) AS clusters
    `;
    const r = rows[0];
    const coverage = Number(r?.coverage ?? 0);
    const clusters = Number(r?.clusters ?? 0);
    const latestDate = r?.latest instanceof Date ? r.latest.toISOString() : r?.latest ? String(r.latest) : null;

    if (latestDate && coverage > 0) {
      cached = { latest: latestDate, coverage, clusters, fetchedAt: now };
    }
    return NextResponse.json(
      { latest: latestDate, coverage, clusters },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } },
    );
  } catch (err) {
    console.error("/api/snapshot-summary failed:", err);
    if (cached) {
      return NextResponse.json(cached);
    }
    return NextResponse.json({ latest: null, coverage: 0, clusters: 0 }, { status: 500 });
  }
}
