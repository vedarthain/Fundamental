/**
 * /indices — the all-Nifty index board.
 *
 * Server component: one cheap read of every tracked index's latest daily
 * level + 1D/1W/1M/1Y change, handed to a client component that renders the
 * board and lazy-loads each index's full daily-OHLC candlestick from
 * /api/indices/ohlc on demand.
 *
 * EOD-only: the figures come from app.market_index_history (authoritative NSE
 * daily driver + Upstox backfill). No Upstox live-tick layer — index intraday
 * needed an authenticated feed we deliberately dropped. Constituents read each
 * member's live price from the 10-min equity pinger (portfolio prices).
 */
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { IndicesClient, type IndexBoardRow } from "./IndicesClient";

export const revalidate = 3600;

async function loadIndices(): Promise<IndexBoardRow[]> {
  // Latest level + trailing-window changes per index. LATERAL look-backs find
  // the closest close at/under each window boundary (tolerant of
  // weekends/holidays). Cheap: one row per index. The candlestick chart's full
  // OHLC history is loaded lazily per index via /api/indices/ohlc, so we no
  // longer ship a per-index sparkline here.
  const rows = await sql<IndexBoardRow[]>`
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

  return rows;
}

const getCachedIndices = unstable_cache(loadIndices, ["indices-board"], {
  revalidate: 3600,
  tags: ["market"],
});

export const metadata = {
  title: "Indices — all Nifty indices, live levels & constituents · EquityRoots",
  description:
    "All tracked Nifty indices with live levels, 1D–1Y performance and full constituents — each member's live price, 1D move and real NSE index weight.",
};

export default async function IndicesPage() {
  const indices = await getCachedIndices();
  return (
    <div className="mx-auto max-w-[1300px] px-4 md:px-6 py-6 md:py-8">
      <IndicesClient indices={indices} />
    </div>
  );
}
