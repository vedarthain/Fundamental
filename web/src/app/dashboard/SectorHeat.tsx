/**
 * Zone 6 — the NSE sectoral indices, 1d and 1w, hottest first.
 *
 * Source is app.market_index_history, the SAME daily driver MarketLine reads —
 * not /sectors. That page's cached loader pulls ~2,150 stock rows to build 46
 * peer-group tiles, which is the wrong shape and the wrong weight for a tile
 * that shows fifteen numbers; and its "heat" is score aggregation, not return.
 * Here heat means what moved, so it is index return, straight from NSE.
 *
 * 1W and 1M are close vs the 6th and 22nd latest SESSION, not calendar dates:
 * the table only has trading days, so `date - 30` would land on a weekend or an
 * NSE holiday and return NULL — and the gap is wider than it looks, because a
 * month with Diwali in it has ~19 sessions, not 22. Row offsets are immune to
 * that. Shares the "market" cache tag with MarketLine, so one purge busts both.
 */
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { Zone, Delta, Empty, fmtDay } from "./ui";

/**
 * Sectoral indices only. Broad-market (NIFTY50/100/500) and size (MIDCAP,
 * SMALLCAP) codes are deliberately excluded — they are already in the market
 * strip above, and including them makes the ranking meaningless because a
 * sector is being compared against its own aggregate.
 */
const SECTOR_INDICES = [
  "NIFTYAUTO",
  "NIFTYBANK",
  "NIFTYCONSDUR",
  "NIFTYENERGY",
  "NIFTYFINSERVICE",
  "NIFTYFMCG",
  "NIFTYHEALTHCARE",
  "NIFTYIT",
  "NIFTYMEDIA",
  "NIFTYMETAL",
  "NIFTYOILGAS",
  "NIFTYPHARMA",
  "NIFTYPSUBANK",
  "NIFTYPVTBANK",
  "NIFTYREALTY",
];

/** Row offsets: 6th latest row = 5 sessions back, 22nd = 21 sessions (~1 month). */
const WEEK_RN = 6;
const MONTH_RN = 22;

type HeatRow = {
  code: string;
  name: string;
  d1: number | null;
  w1: number | null;
  m1: number | null;
  date: string;
};

async function loadSectorHeat(): Promise<HeatRow[]> {
  return sql<HeatRow[]>`
    WITH ranked AS (
      SELECT index_code, display_name, date, close, pct_change,
             ROW_NUMBER() OVER (PARTITION BY index_code ORDER BY date DESC) AS rn
        FROM app.market_index_history
       WHERE index_code = ANY(${SECTOR_INDICES})
    )
    SELECT a.index_code              AS code,
           a.display_name            AS name,
           a.pct_change::float       AS d1,
           CASE WHEN w.close > 0
                THEN ((a.close - w.close) / w.close * 100)::float
           END                       AS w1,
           CASE WHEN m.close > 0
                THEN ((a.close - m.close) / m.close * 100)::float
           END                       AS m1,
           a.date::text              AS date
      FROM ranked a
      LEFT JOIN ranked w ON w.index_code = a.index_code AND w.rn = ${WEEK_RN}
      LEFT JOIN ranked m ON m.index_code = a.index_code AND m.rn = ${MONTH_RN}
     WHERE a.rn = 1
     ORDER BY a.pct_change DESC NULLS LAST
  `.catch(() => [] as HeatRow[]);
}

const cachedHeat = unstable_cache(loadSectorHeat, ["dashboard:sector-heat:v1"], {
  revalidate: 3600,
  tags: ["market"],
});

export async function SectorHeat() {
  const rows = await cachedHeat();
  const asOf = rows[0]?.date ?? null;

  return (
    <Zone
      title="Sector heat"
      href="/sectors"
      meta={asOf ? `EOD · ${fmtDay(asOf)}` : undefined}
    >
      {rows.length === 0 ? (
        <Empty>No index data.</Empty>
      ) : (
        <table className="w-full text-[11.5px] table-fixed">
          <thead>
            <tr className="muted-text text-[9.5px] uppercase tracking-wide">
              <th className="pb-0.5 font-normal text-left">Sector</th>
              <th className="pb-0.5 font-normal text-right w-[20%]">1D</th>
              <th className="pb-0.5 font-normal text-right w-[20%]">1W</th>
              <th className="pb-0.5 font-normal text-right w-[20%]">1M</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t hairline">
                <td className="py-[3px] text-left truncate">{shortName(r.name)}</td>
                <td className="py-[3px] text-right tabular-nums">
                  <Delta v={r.d1} />
                </td>
                <td className="py-[3px] text-right tabular-nums">
                  <Delta v={r.w1} />
                </td>
                <td className="py-[3px] text-right tabular-nums">
                  <Delta v={r.m1} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Zone>
  );
}

/** "Nifty Financial Services" → "Financial Services". Every row shares the
 *  prefix, so it is 6 wasted characters in a column that has to truncate. */
function shortName(name: string): string {
  return name.replace(/^Nifty\s+/i, "").replace(/\s+Index$/i, "");
}
