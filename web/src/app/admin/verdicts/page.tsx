/**
 * /admin/verdicts — Cluster-Wise Verdicts & Moats.
 *
 * Admin-gated. Left rail lists Sectors -> Clusters (all collapsed to sectors
 * on initial load). Clicking a cluster shows its Actionable, Watchlist, and
 * Hold/Avoid tables with LTP, Buy Below, Target, C/Q/V/M scores, latest
 * quarterly numbers, Moat ("what it's known for"), and Why.
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import { ClusterVerdictsClient, type SectorTreeNode } from "./ClusterVerdictsClient";
import type { ClusterVerdictRow } from "@/app/api/admin/cluster-verdicts/route";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Cluster Verdicts — Admin",
  robots: { index: false, follow: false },
};

async function loadSectorClusterTree(): Promise<SectorTreeNode[]> {
  const rows = await sql<{
    sector_name: string;
    cluster_id: string;
    cluster_name: string;
    stock_count: number;
  }[]>`
    WITH latest_snap AS (
      SELECT MAX(snapshot_date) AS d FROM app.cluster_stocks_panel_cache
    )
    SELECT
      mc.name AS sector_name,
      cl.id::text AS cluster_id,
      cl.name AS cluster_name,
      COUNT(p.symbol)::int AS stock_count
    FROM app.cluster cl
    JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
    JOIN app.cluster_stocks_panel_cache p
      ON p.cluster_id = cl.id
     AND p.snapshot_date = (SELECT d FROM latest_snap)
    GROUP BY mc.name, cl.id, cl.name
    HAVING COUNT(p.symbol) > 0
    ORDER BY mc.name ASC, cl.name ASC
  `;

  const bySector = new Map<string, SectorTreeNode>();
  for (const r of rows) {
    let sec = bySector.get(r.sector_name);
    if (!sec) {
      sec = { sectorName: r.sector_name, stockCount: 0, clusters: [] };
      bySector.set(r.sector_name, sec);
    }
    sec.stockCount += r.stock_count;
    sec.clusters.push({
      clusterId: r.cluster_id,
      clusterName: r.cluster_name,
      stockCount: r.stock_count,
    });
  }
  return Array.from(bySector.values());
}

async function loadClusterItems(clusterId: string): Promise<ClusterVerdictRow[]> {
  const [rows, moatRows] = await Promise.all([
    sql<any[]>`
      WITH latest_verdict AS (
        SELECT DISTINCT ON (symbol)
          symbol, verdict, target_price, buy_below, bear_floor, upside_pct
        FROM app.stock_verdict
        ORDER BY symbol, generated_at DESC
      ),
      latest_panel AS (
        SELECT DISTINCT ON (symbol)
          symbol, company_name, cluster_id, market_cap_cr, current_price,
          composite_pct, quality_pct, valuation_pct, momentum_pct,
          ret_1m, ret_6m, ret_1y
        FROM app.cluster_stocks_panel_cache
        ORDER BY symbol, snapshot_date DESC
      ),
      ranked_q AS (
        SELECT
          symbol, period_end, sales::float, net_profit::float,
          ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY period_end DESC) AS rn
        FROM app.fundamentals_quarterly
      ),
      latest_q AS (
        SELECT
          a.symbol,
          a.period_end::text AS q_end,
          a.sales AS q_sales,
          a.net_profit AS q_pat,
          CASE
            WHEN b.sales IS NOT NULL AND ABS(b.sales) > 0
              THEN ROUND(((a.sales - b.sales) / ABS(b.sales) * 100)::numeric, 1)::float
            ELSE NULL
          END AS q_sales_yoy_pct,
          CASE
            WHEN b.net_profit IS NOT NULL AND ABS(b.net_profit) > 0
              THEN ROUND(((a.net_profit - b.net_profit) / ABS(b.net_profit) * 100)::numeric, 1)::float
            ELSE NULL
          END AS q_pat_yoy_pct
        FROM ranked_q a
        LEFT JOIN ranked_q b ON b.symbol = a.symbol AND b.rn = 5
        WHERE a.rn = 1
      )
      SELECT
        p.symbol,
        p.company_name,
        COALESCE(p.market_cap_cr, 0)::float AS market_cap_cr,
        COALESCE(sm.current_price, p.current_price, 0)::float AS ltp,
        v.buy_below::float,
        v.target_price::float,
        v.bear_floor::float,
        CASE
          WHEN v.target_price > 0 AND COALESCE(sm.current_price, p.current_price) > 0
            THEN ROUND(((v.target_price - COALESCE(sm.current_price, p.current_price)) / COALESCE(sm.current_price, p.current_price) * 100)::numeric, 1)::float
          ELSE v.upside_pct::float
        END AS upside_pct,
        COALESCE(p.composite_pct, 0)::float AS composite_pct,
        COALESCE(p.quality_pct, 0)::float AS quality_pct,
        COALESCE(p.valuation_pct, 0)::float AS valuation_pct,
        COALESCE(p.momentum_pct, 0)::float AS momentum_pct,
        p.ret_1m::float,
        p.ret_6m::float,
        p.ret_1y::float,
        q.q_end,
        q.q_sales,
        q.q_pat,
        q.q_sales_yoy_pct,
        q.q_pat_yoy_pct,
        v.verdict,
        u.business_summary,
        EXISTS(SELECT 1 FROM app.portfolio_holding h WHERE h.symbol = p.symbol AND h.quantity > 0) AS in_portfolio
      FROM latest_panel p
      LEFT JOIN latest_verdict v ON v.symbol = p.symbol
      LEFT JOIN app.screener_meta sm ON sm.symbol = p.symbol
      LEFT JOIN app.universe u ON u.symbol = p.symbol
      LEFT JOIN latest_q q ON q.symbol = p.symbol
      WHERE p.cluster_id = ${clusterId}
      ORDER BY p.composite_pct DESC NULLS LAST, upside_pct DESC NULLS LAST
    `,
    sql<{ symbol: string; moat_strength: string | null; moat_type: string | null; moat_points: unknown }[]>`
      SELECT symbol, moat_strength, moat_type, moat_points
      FROM app.company_moat
    `.catch(() => [] as { symbol: string; moat_strength: string | null; moat_type: string | null; moat_points: unknown }[]),
  ]);
  const moatMap = new Map(moatRows.map((m) => [m.symbol, m]));

  return rows.map((r) => {
    const ltp = Number(r.ltp ?? 0);
    const bb = r.buy_below != null ? Number(r.buy_below) : null;
    const tgt = r.target_price != null ? Number(r.target_price) : null;
    const up = r.upside_pct != null ? Number(r.upside_pct) : null;
    const verd = (r.verdict as string | null) ?? "";
    const vLower = verd.toLowerCase();
    const shortVerdict = verd.replace(/^[^—]+—\s*/, "").trim();
    const inZone = bb != null && ltp > 0 && ltp <= bb * 1.02;

    let action_group: "actionable" | "watch" | "hold_avoid" = "watch";
    let action_label = "WATCH";
    let why = shortVerdict || "Monitor fundamentals and price entry.";

    if (vLower.startsWith("avoid")) {
      action_group = "hold_avoid";
      action_label = "AVOID";
      why = shortVerdict || "Weak fundamentals or high risk flags.";
    } else if (vLower.startsWith("hold")) {
      action_group = "hold_avoid";
      action_label = "HOLD";
      why = shortVerdict || "Quality business, limited upside at current price.";
    } else if (vLower.startsWith("buy") || vLower.startsWith("accumulate")) {
      if (inZone || (up != null && up >= 15)) {
        action_group = "actionable";
        action_label = inZone ? "ACCUMULATE (IN ZONE)" : "ACCUMULATE";
      } else {
        action_group = "watch";
        action_label = "WATCH (WAIT DIP)";
      }
      why = shortVerdict || "Strong fundamentals and attractive valuation.";
    } else if (inZone && up != null && up >= 15 && Number(r.composite_pct) >= 60 && Number(r.quality_pct) >= 50) {
      action_group = "actionable";
      action_label = "WATCH (IN ZONE)";
      why = shortVerdict
        ? `Trading inside buy zone (≤ ₹${bb?.toFixed(1)}). ${shortVerdict}`
        : `Trading inside buy zone (≤ ₹${bb?.toFixed(1)}).`;
    } else {
      action_group = "watch";
      action_label = inZone ? "WATCH (IN ZONE)" : "WATCH";
      if (bb != null && ltp > bb * 1.02) {
        const dist = ((ltp - bb) / bb) * 100;
        why = `+${dist.toFixed(1)}% above Buy Below ₹${bb.toFixed(1)}${shortVerdict ? ` — ${shortVerdict}` : ""}`;
      } else if (up != null && up < 10 && tgt != null) {
        why = `Limited upside (${up.toFixed(1)}% to ₹${tgt.toFixed(1)})${shortVerdict ? ` — ${shortVerdict}` : ""}`;
      }
    }

    return {
      symbol: r.symbol,
      company_name: r.company_name,
      market_cap_cr: Number(r.market_cap_cr ?? 0),
      ltp,
      buy_below: bb,
      target_price: tgt,
      bear_floor: r.bear_floor != null ? Number(r.bear_floor) : null,
      upside_pct: up,
      composite_pct: Number(r.composite_pct ?? 0),
      quality_pct: Number(r.quality_pct ?? 0),
      valuation_pct: Number(r.valuation_pct ?? 0),
      momentum_pct: Number(r.momentum_pct ?? 0),
      q_end: r.q_end,
      q_sales: r.q_sales != null ? Number(r.q_sales) : null,
      q_pat: r.q_pat != null ? Number(r.q_pat) : null,
      q_sales_yoy_pct: r.q_sales_yoy_pct != null ? Number(r.q_sales_yoy_pct) : null,
      q_pat_yoy_pct: r.q_pat_yoy_pct != null ? Number(r.q_pat_yoy_pct) : null,
      ret_1m: r.ret_1m != null ? Number(r.ret_1m) : null,
      ret_6m: r.ret_6m != null ? Number(r.ret_6m) : null,
      ret_1y: r.ret_1y != null ? Number(r.ret_1y) : null,
      verdict: r.verdict,
      business_summary: r.business_summary,
      moat_strength: moatMap.get(r.symbol)?.moat_strength ?? null,
      moat_type: moatMap.get(r.symbol)?.moat_type ?? null,
      moat_points: (() => {
        const raw = moatMap.get(r.symbol)?.moat_points;
        if (Array.isArray(raw)) return raw as string[];
        if (typeof raw === "string") {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as string[]) : [];
          } catch {
            return [];
          }
        }
        return [];
      })(),
      in_portfolio: Boolean(r.in_portfolio),
      action_group,
      action_label,
      why,
    };
  });
}

export default async function AdminVerdictsPage() {
  if (!(await isAdminRequest())) redirect("/");

  const sectors = await loadSectorClusterTree();
  const initialClusterId = sectors[0]?.clusters[0]?.clusterId ?? null;
  const initialItems = initialClusterId ? await loadClusterItems(initialClusterId) : [];

  return (
    <main className="mx-auto max-w-[1600px] px-3 sm:px-4 py-2 sm:py-3">
      <PageHeader
        eyebrow="Admin · Cluster Verdicts"
        title="Cluster-Wise Verdicts & Moats"
        subtitle="Scan Actionable, Watchlist, and Hold/Avoid candidates by sector and cluster."
      />
      <ClusterVerdictsClient
        sectors={sectors}
        initialClusterId={initialClusterId}
        initialItems={initialItems}
      />
    </main>
  );
}
