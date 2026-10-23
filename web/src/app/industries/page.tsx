/**
 * /industries — the sector → industry → detail tree.
 *
 * /sectors already renders all of these, but it drills DOWNWARD: pick a sector,
 * pick an industry, read its stock rows. That answers "what is in this peer
 * group". It does not answer "how do the peer groups compare", because the
 * industry aggregates are scattered one tab at a time and a half-remembered
 * name ("Media & Entertainment") means opening each sector in turn.
 *
 * So this page stops at the industry. Column three is the peer group's own
 * numbers — stock count, total market cap, Quality, Valuation, Momentum and the
 * composite — and the stock rows stay where they already live, one click away
 * at /industry/<id>. The filter box is what keeps the tree from reintroducing
 * the original complaint: typing narrows all three columns at once, so you
 * never have to know the sector first.
 *
 * THREE CLUSTERS ARE DELIBERATELY ABSENT. app.cluster has 49 rows but the
 * latest app.cluster_composite_cache snapshot has 46: `unclassified`,
 * `bfsi_capmarkets (deprecated)` and `bfsi_pvt_banks (deprecated)` carry no
 * aggregate. The join below is an INNER join for that reason — an index whose
 * rows link to a peer-group page with no stocks and no scores would be three
 * dead ends wearing the same chrome as the live ones. They remain reachable at
 * /industry/<id> directly; they are just not offered here.
 *
 * WHY THE SNAPSHOT COMES FROM app.scores. /sectors pins its two queries to
 * MAX(snapshot_date) FROM app.scores and reads both caches at that date. This
 * page does the same rather than taking MAX from the cache it happens to read
 * first: the composite cache and the panel cache are written by different ETL
 * steps, and a run that half-finished would otherwise pair an industry's score
 * with last week's market caps. Measured 2026-10-23: all three agree on
 * 2026-10-21.
 *
 * Cached for 24h under the "sectors" tag, so the existing ETL purge covers
 * this page too rather than leaving it to drift on its own schedule.
 */
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { sql } from "@/lib/db";
import { loadTrailingReturns } from "@/lib/trailingReturns";
import {
  IndustriesClient,
  type IndustryIndexRow,
  type SectorNode,
  type IndustryStockRow,
} from "./IndustriesClient";

export const revalidate = 86400;
export const metadata = {
  title: "Industries · EquityRoots",
  description:
    "Every industry we score, as a sector → industry tree — stock count, market cap, Quality, Valuation, Momentum and composite for each.",
};

const loadIndustries = unstable_cache(
  async (): Promise<{
    rows: IndustryIndexRow[];
    sectors: SectorNode[];
    stocksByIndustry: Record<string, IndustryStockRow[]>;
    snapshotDate: string | null;
  }> => {
    const latest = await sql<{ d: string | null }[]>`
      SELECT MAX(snapshot_date)::text AS d FROM app.scores
    `;
    const snapshotDate = latest[0]?.d ?? null;
    if (!snapshotDate)
      return { rows: [], sectors: [], stocksByIndustry: {}, snapshotDate: null };

    // Market cap is not in the composite cache, so it is summed from the same
    // per-stock panel /sectors reads. SUM, not AVG: "how big is this peer
    // group" is the question a tree column answers, and an average market cap
    // across 190 consumer-durables names says nothing a reader can use.
    const rows = await sql<IndustryIndexRow[]>`
      WITH mcap AS (
        SELECT cluster_id, SUM(market_cap_cr)::float AS total
          FROM app.cluster_stocks_panel_cache
         WHERE snapshot_date = ${snapshotDate}
         GROUP BY cluster_id
      )
      SELECT cc.cluster_id              AS id,
             cc.industry_name           AS name,
             cc.meta_cluster_id         AS "sectorId",
             cc.sector_name             AS "sectorName",
             mc.display_order           AS "sectorOrder",
             cc.n_stocks                AS "stockCount",
             m.total                    AS "marketCapCr",
             cc.quality_aggr_pct::float   AS "avgQuality",
             cc.valuation_aggr_pct::float AS "avgValuation",
             cc.momentum_aggr_pct::float  AS "avgMomentum",
             cc.composite_aggr_pct::float AS "avgComposite"
        FROM app.cluster_composite_cache cc
        JOIN app.meta_cluster mc ON mc.id = cc.meta_cluster_id
        LEFT JOIN mcap m ON m.cluster_id = cc.cluster_id
       WHERE cc.snapshot_date = ${snapshotDate}
       ORDER BY mc.display_order, cc.industry_name
    `;

    // Sector rows are DERIVED here, not read from a table — there is no
    // sector-level aggregate cache in app.*, and inventing one would be a
    // second place for the same number to live. The sector composite is the
    // market-cap-weighted mean of its industries' aggregates, which matches
    // how the ETL weights cluster-level returns (cli.py, "Aggregate per
    // cluster"). An industry with no market cap contributes nothing rather
    // than being counted at weight zero-but-present, and a sector whose whole
    // weight is missing renders as null, never as 0.
    const bySector = new Map<string, SectorNode>();
    for (const r of rows) {
      const s =
        bySector.get(r.sectorId) ??
        ({
          id: r.sectorId,
          name: r.sectorName,
          order: r.sectorOrder,
          industryCount: 0,
          stockCount: 0,
          marketCapCr: 0,
          avgComposite: null,
        } satisfies SectorNode);
      s.industryCount += 1;
      s.stockCount += r.stockCount;
      s.marketCapCr += r.marketCapCr ?? 0;
      bySector.set(r.sectorId, s);
    }
    for (const s of bySector.values()) {
      let w = 0;
      let acc = 0;
      for (const r of rows) {
        if (r.sectorId !== s.id) continue;
        if (r.avgComposite == null || !r.marketCapCr) continue;
        w += r.marketCapCr;
        acc += r.marketCapCr * r.avgComposite;
      }
      s.avgComposite = w > 0 ? acc / w : null;
    }
    const sectors = [...bySector.values()].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name),
    );

    // Every stock in every cluster, in ONE query, exactly as /sectors does it
    // (same table, same snapshot pin, same column list minus the returns this
    // page does not show). ~2,150 rows is 50-80 KB gzipped — the alternative
    // is a round-trip on every industry click, and the whole point of loading
    // the tree server-side is that moving through it costs nothing.
    //
    // The panel's OWN ret_* columns are deliberately not read — they are
    // anchored to the weekly snapshot while current_price refreshes daily, and
    // lib/trailingReturns records the measurement: 37% of 1W values had the
    // wrong SIGN on 2026-09-17. The 1D/1W/1M/1Y below come from that module
    // instead, computed off golden's newest close, which is the same source
    // /sectors, the watchlist and the stock page use. Four surfaces, one
    // definition.
    type PanelRow = Omit<IndustryStockRow, "ret1d" | "ret1w" | "ret1m" | "ret1y"> & {
      cluster_id: string;
    };
    const panelRows = await sql<PanelRow[]>`
      SELECT cluster_id,
             symbol,
             company_name              AS "companyName",
             market_cap_cr::float      AS "marketCapCr",
             current_price::float      AS "currentPrice",
             quality_pct::float        AS "qualityPct",
             valuation_pct::float      AS "valuationPct",
             momentum_pct::float       AS "momentumPct",
             composite_pct::float      AS "compositePct",
             maturity_tier             AS "maturityTier"
        FROM app.cluster_stocks_panel_cache
       WHERE snapshot_date = ${snapshotDate}
       ORDER BY cluster_id, composite_pct DESC NULLS LAST
    `;

    // One batched call for all ~2,150 symbols, cached inside the module on an
    // IST date key, so this does not become 46 round-trips as the reader walks
    // the tree. Units are FRACTIONS here and are scaled in the client.
    const trailing = await loadTrailingReturns(panelRows.map((r) => r.symbol));

    const stocksByIndustry: Record<string, IndustryStockRow[]> = {};
    for (const r of panelRows) {
      const { cluster_id: cid, ...stock } = r;
      const t = trailing.get(r.symbol);
      (stocksByIndustry[cid] ??= []).push({
        ...stock,
        ret1d: t?.ret_1d ?? null,
        ret1w: t?.ret_1w ?? null,
        ret1m: t?.ret_1m ?? null,
        ret1y: t?.ret_1y ?? null,
      });
    }

    return { rows, sectors, stocksByIndustry, snapshotDate };
  },
  ["industries-tree"],
  { revalidate: 86400, tags: ["sectors"] },
);

export default async function IndustriesPage() {
  const { rows, sectors, stocksByIndustry, snapshotDate } = await loadIndustries();

  return (
    <div className="theme-indigo mx-auto max-w-[1500px] px-6 pt-3 pb-8">
      {/* No <h1> and no standfirst. The tree is three columns of labels that
          already say what the page is, and a 34px heading plus a 760px blurb
          cost ~110px of the first screen — the fold landed mid-table. <title>
          in metadata is what search engines read.

          The breadcrumb is passed INTO the client rather than rendered above
          it, so it shares the filter row instead of owning a line of its own.
          Two 20px lines holding four words between them was the last of the
          wasted vertical space above the table. */}

      {rows.length === 0 ? (
        <p className="mt-8 text-[14px] muted-text">
          No industry aggregates in the latest snapshot. That is the weekly compute not having
          run, not an empty universe — check <code>app.cluster_composite_cache</code>.
        </p>
      ) : (
        <div>
          <IndustriesClient
            rows={rows}
            sectors={sectors}
            stocksByIndustry={stocksByIndustry}
            breadcrumb={
              <span className="text-[12px] uppercase tracking-wide muted-text flex items-center gap-1.5 shrink-0">
                <Link href="/sectors" className="hover:underline">Segments</Link>
                <span aria-hidden style={{ color: "var(--color-border-default)" }}>›</span>
                <span>Industries</span>
              </span>
            }
          />
        </div>
      )}

      {snapshotDate && (
        <p className="mt-8 text-[12px] muted-text">
          Counts, market caps and scores from the weekly snapshot of {snapshotDate}. Sector
          scores are market-cap-weighted means of their industries, not a separately stored
          number. Three groups — Unclassified and two deprecated BFSI splits — carry no
          aggregate and are not listed.
        </p>
      )}
    </div>
  );
}
