/**
 * /indices — the all-Nifty index board.
 *
 * Server component: one cheap read of every tracked index's latest daily
 * level + 1D/1W/1M/1Y change + a 90-day sparkline, handed to a client
 * component that overlays the LIVE 10-min tick from /api/market/index-live.
 *
 * The daily figures come from app.market_index_history (EOD, authoritative);
 * the live level + today's move are layered on the client so the board ticks
 * during market hours without busting this page's cache. Constituents
 * (Phase 2) expand per-card and read each member's live price from the same
 * 10-min equity pinger — not built yet; this ships the board first.
 */
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { IndicesClient, type IndexBoardRow } from "./IndicesClient";

export const revalidate = 3600;

async function loadIndices(): Promise<IndexBoardRow[]> {
  // Latest level + trailing-window changes per index. Same shape the /market
  // overview uses; LATERAL look-backs find the closest close at/under each
  // window boundary (tolerant of weekends/holidays).
  const rows = await sql<Omit<IndexBoardRow, "sparkline">[]>`
    WITH latest_date AS (
      SELECT MAX(date) AS d FROM app.market_index_history
    ),
    today AS (
      SELECT h.index_code, h.display_name AS name, h.close::float, h.date::text,
             h.pct_change::float AS pct_change_1d
        FROM app.market_index_history h
        JOIN latest_date l ON l.d = h.date
    )
    SELECT t.index_code AS code,
           t.name,
           t.close,
           t.pct_change_1d,
           CASE WHEN w.close > 0 THEN ((t.close - w.close::float) / w.close::float * 100)::float ELSE NULL END AS pct_change_1w,
           CASE WHEN m.close > 0 THEN ((t.close - m.close::float) / m.close::float * 100)::float ELSE NULL END AS pct_change_1m,
           CASE WHEN y.close > 0 THEN ((t.close - y.close::float) / y.close::float * 100)::float ELSE NULL END AS pct_change_1y,
           t.date
      FROM today t
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history h2
         WHERE h2.index_code = t.index_code AND h2.date <= (t.date::date - INTERVAL '7 days')
         ORDER BY h2.date DESC LIMIT 1
      ) w ON TRUE
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history h2
         WHERE h2.index_code = t.index_code AND h2.date <= (t.date::date - INTERVAL '30 days')
         ORDER BY h2.date DESC LIMIT 1
      ) m ON TRUE
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history h2
         WHERE h2.index_code = t.index_code AND h2.date <= (t.date::date - INTERVAL '365 days')
         ORDER BY h2.date DESC LIMIT 1
      ) y ON TRUE
     ORDER BY t.name
  `;

  // 90 trailing daily closes per index for the sparkline, oldest-first.
  const spark = await sql<{ index_code: string; date: string; close: number }[]>`
    WITH ranked AS (
      SELECT index_code, date::text AS date, close::float AS close,
             ROW_NUMBER() OVER (PARTITION BY index_code ORDER BY date DESC) AS rn
        FROM app.market_index_history
    )
    SELECT index_code, date, close FROM ranked WHERE rn <= 90 ORDER BY index_code, date
  `;
  const byCode = new Map<string, { date: string; close: number }[]>();
  for (const r of spark) {
    const arr = byCode.get(r.index_code) ?? [];
    arr.push({ date: r.date, close: r.close });
    byCode.set(r.index_code, arr);
  }

  return rows.map((r) => ({ ...r, sparkline: byCode.get(r.code) ?? [] }));
}

const getCachedIndices = unstable_cache(loadIndices, ["indices-board"], {
  revalidate: 3600,
  tags: ["market"],
});

export default async function IndicesPage() {
  const indices = await getCachedIndices();
  return (
    <div className="mx-auto max-w-[1300px] px-4 md:px-6 py-6 md:py-8">
      <IndicesClient indices={indices} />
    </div>
  );
}
