/**
 * /industries — the A–Z index of every scored industry.
 *
 * /sectors already renders all of these, but scoped: it opens on one sector
 * and its industry sidebar only lists that sector's children, so locating
 * "Media & Entertainment" without already knowing which sector holds it means
 * opening each sector tab and reading its sidebar. This page answers the same
 * question with a filter box.
 *
 * THREE CLUSTERS ARE DELIBERATELY ABSENT. app.cluster has 49 rows but the
 * latest app.cluster_composite_cache snapshot has 46: `unclassified`,
 * `bfsi_capmarkets (deprecated)` and `bfsi_pvt_banks (deprecated)` carry no
 * aggregate. The join below is an INNER join for that reason — an index whose
 * rows link to a peer-group page with no stocks and no scores would be three
 * dead ends wearing the same chrome as the live ones. They remain reachable at
 * /industry/<id> directly; they are just not offered here.
 *
 * Cached for 24h under the "sectors" tag, so the existing ETL purge covers
 * this page too rather than leaving it to drift on its own schedule.
 */
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { sql } from "@/lib/db";
import { IndustriesClient, type IndustryIndexRow } from "./IndustriesClient";

export const revalidate = 86400;
export const metadata = {
  title: "Industries · EquityRoots",
  description:
    "Every industry we score, in one filterable list — stock count and aggregate composite for each.",
};

const loadIndustries = unstable_cache(
  async (): Promise<{ rows: IndustryIndexRow[]; snapshotDate: string | null }> => {
    const latest = await sql<{ d: string | null }[]>`
      SELECT MAX(snapshot_date)::text AS d FROM app.cluster_composite_cache
    `;
    const snapshotDate = latest[0]?.d ?? null;
    if (!snapshotDate) return { rows: [], snapshotDate: null };

    const rows = await sql<IndustryIndexRow[]>`
      SELECT cc.cluster_id              AS id,
             cc.industry_name           AS name,
             cc.meta_cluster_id         AS "sectorId",
             cc.sector_name             AS "sectorName",
             mc.display_order           AS "sectorOrder",
             cc.n_stocks                AS "stockCount",
             cc.composite_aggr_pct::float AS "avgComposite"
        FROM app.cluster_composite_cache cc
        JOIN app.meta_cluster mc ON mc.id = cc.meta_cluster_id
       WHERE cc.snapshot_date = ${snapshotDate}
       ORDER BY mc.display_order, cc.industry_name
    `;
    return { rows, snapshotDate };
  },
  ["industries-index"],
  { revalidate: 86400, tags: ["sectors"] },
);

export default async function IndustriesPage() {
  const { rows, snapshotDate } = await loadIndustries();

  return (
    <div className="theme-indigo mx-auto max-w-[1100px] px-6 py-10">
      <div className="text-[12px] uppercase tracking-wide muted-text flex items-center gap-2 flex-wrap">
        <Link href="/sectors" className="hover:underline">Segments</Link>
        <span aria-hidden style={{ color: "var(--color-border-default)" }}>›</span>
        <span>Industries</span>
      </div>

      <h1 className="font-display text-[36px] tracking-tight leading-tight mt-1">
        Every <em className="accent">industry</em>, in one list
      </h1>
      <p className="mt-3 text-[15px] muted-text max-w-[660px]">
        {rows.length} peer groups across{" "}
        {new Set(rows.map((r) => r.sectorId)).size} sectors. Sectors are a way in when you know
        where something sits; this is the way in when you do not. Type part of a name — the filter
        reads the industry, its sector and its id. Each row opens the full peer group.
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 text-[14px] muted-text">
          No industry aggregates in the latest snapshot. That is the weekly compute not having
          run, not an empty universe — check <code>app.cluster_composite_cache</code>.
        </p>
      ) : (
        <div className="mt-7">
          <IndustriesClient rows={rows} />
        </div>
      )}

      {snapshotDate && (
        <p className="mt-10 text-[12px] muted-text">
          Counts and composites from the weekly snapshot of {snapshotDate}. Three groups —
          Unclassified and two deprecated BFSI splits — carry no aggregate and are not listed.
        </p>
      )}
    </div>
  );
}
