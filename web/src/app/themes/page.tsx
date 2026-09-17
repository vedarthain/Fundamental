import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { ThemesClient, type ThemeTile, type ThemeStock, type ThemesData } from "./ThemesClient";

// Themes are an ORTHOGONAL grouping to /sectors, not a prettier version of it.
// /sectors renders app.cluster — the scoring taxonomy, where a cluster must be
// a set of comparable businesses because percentiles are computed inside it.
// That constraint is precisely why it cannot express "Drone" (defence
// electronics + plastics + software) or "Green Hydrogen" (utilities +
// engineering + gas). app.theme is many-to-many, non-exhaustive, editorial,
// and feeds no score.
//
// Same single-fetch architecture as /sectors: one cached query for every theme
// and every member, handed to the client, so switching themes is a React state
// change rather than a round-trip. ~1,900 membership rows joined to the panel
// cache — comparable to the 2,150 rows /sectors already ships.

export const revalidate = 86400;

async function loadAll(): Promise<ThemesData> {
  const latest = await sql<{ snapshot_date: string }[]>`
    SELECT MAX(snapshot_date)::text AS snapshot_date FROM app.cluster_stocks_panel_cache
  `;
  const snapshotDate = latest[0]?.snapshot_date ?? null;
  if (!snapshotDate) return { themes: [], stocksByTheme: {}, snapshotDate: null };

  // Themes carrying at least one resolvable member. A theme whose every
  // constituent is BSE-only renders as an empty page, so it is excluded here
  // rather than shown as a dead tab.
  const themes = await sql<ThemeTile[]>`
    SELECT t.id,
           t.slug,
           t.label,
           t.kind,
           COUNT(m.symbol)::int AS stock_count
      FROM app.theme t
      JOIN app.theme_member m ON m.theme_id = t.id
     WHERE t.is_active
     GROUP BY t.id, t.slug, t.label, t.kind, t.display_order
     HAVING COUNT(m.symbol) > 0
     ORDER BY t.kind DESC, t.label
  `;

  // Every member of every theme, pre-joined with the same panel cache that
  // feeds /sectors and the scanner. Nothing here comes from the import source:
  // prices, returns and percentiles are ours, so a theme page cannot disagree
  // with the rest of the site about what a stock did today.
  //
  // Returns are stored as FRACTIONS in this table (-0.0487 = -4.9%) while every
  // other surface renders percent — multiplied here so the client never has to
  // know, and so this page cannot become the fourth place that gets it wrong.
  const rows = await sql<(ThemeStock & { theme_id: number })[]>`
    SELECT m.theme_id,
           p.symbol,
           p.company_name,
           p.current_price::float        AS price,
           p.market_cap_cr::float        AS market_cap_cr,
           p.composite_pct::float        AS composite_pct,
           p.quality_pct::float          AS quality_pct,
           p.valuation_pct::float        AS valuation_pct,
           p.momentum_pct::float         AS momentum_pct,
           (p.ret_1w::float * 100)       AS ret_1w,
           (p.ret_1m::float * 100)       AS ret_1m,
           (p.ret_1y::float * 100)       AS ret_1y
      FROM app.theme_member m
      JOIN app.cluster_stocks_panel_cache p
        ON p.symbol = m.symbol AND p.snapshot_date = ${snapshotDate}
     ORDER BY p.market_cap_cr DESC NULLS LAST
  `;

  const stocksByTheme: Record<string, ThemeStock[]> = {};
  for (const r of rows) {
    const { theme_id, ...stock } = r;
    (stocksByTheme[theme_id] ??= []).push(stock);
  }

  return { themes, stocksByTheme, snapshotDate };
}

// Tagged "sectors" + "panel-cache" deliberately: the underlying numbers are the
// panel cache, so this page must go stale at exactly the moment /sectors does.
// Membership itself changes far more slowly than the 24h revalidate and is
// refreshed out-of-band by the ETL importer.
const getCachedAll = unstable_cache(() => loadAll(), ["themes-all"], {
  revalidate: 86400,
  tags: ["sectors", "panel-cache"],
});

export const metadata = {
  title: "Themes — NSE stocks grouped by investment theme · EquityRoots",
  description:
    "Browse NSE stocks by theme — Defence, Drone, Data Center, Green Hydrogen, Semiconductor, Nuclear Power and more — each constituent scored on Quality, Valuation and Momentum.",
};

export default async function ThemesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [sp, data] = await Promise.all([searchParams, getCachedAll()]);
  return (
    <div className="theme-teal mx-auto max-w-[1200px] px-4 md:px-6 py-6 md:py-8">
      <ThemesClient data={data} initialSlug={sp.theme ?? null} />
    </div>
  );
}
