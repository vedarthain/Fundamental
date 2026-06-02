/**
 * GET /api/market/index-live — latest intraday tick for the headline
 * indices (NIFTY 50, NIFTY BANK).
 *
 * Deliberately SEPARATE from /api/market/overview: that payload is large
 * and CDN-cached for an hour. This one is tiny (2 rows) and freshly read,
 * so the /market hero panels can show a LIVE price that updates every few
 * minutes without busting the expensive overview cache.
 *
 * Caching: 60s s-maxage + SWR. The pinger writes a new tick ~every 15 min,
 * so a 60s CDN window means at most one origin read per minute per region
 * while staying within a minute of the freshest tick. We do NOT tag this
 * for revalidation — it's meant to expire on its own short clock.
 *
 * Freshness: each row carries `age_seconds`. The client decides whether a
 * tick is live enough to display (e.g. < 20 min) vs. falling back to the
 * daily close already in the overview payload. Server doesn't gate on
 * market hours — that's a presentation choice the client owns.
 */
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LiveTick = {
  code: string;
  ltp: number;
  prev_close: number | null;
  pct_change: number | null;
  ts: string;
  age_seconds: number;
};

export async function GET() {
  // Latest tick per index_code. DISTINCT ON + the (index_code, ts DESC)
  // index makes this two index seeks.
  const rows = await sql<LiveTick[]>`
    SELECT DISTINCT ON (index_code)
           index_code                                  AS code,
           ltp::float                                  AS ltp,
           prev_close::float                           AS prev_close,
           pct_change::float                           AS pct_change,
           ts::text                                    AS ts,
           EXTRACT(EPOCH FROM (now() - ts))::int       AS age_seconds
      FROM app.market_index_intraday
     ORDER BY index_code, ts DESC
  `;

  const byCode: Record<string, LiveTick> = {};
  for (const r of rows) byCode[r.code] = r;

  return NextResponse.json(
    { ticks: byCode },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
