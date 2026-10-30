/**
 * Admin-only cluster → sector lookup, for the verdict detail page's tree.
 *
 * QueueEntry (from /api/admin/verdict?queue=1) carries cluster_id and
 * cluster_name, but cluster_name is the INDUSTRY-level grouping (e.g.
 * "Consumer Appliances & Electronics") — there are ~70+ of those. The real
 * 9-ish sector taxonomy ("Consumer", "BFSI", "Industrials", ...) lives one
 * level up, on app.meta_cluster, joined via app.cluster.meta_cluster_id.
 * app.universe.sector/industry is a SEPARATE, noisier free-text field (often
 * null) and is NOT this taxonomy — using it for the tree is why the tree
 * looked thin instead of showing all ~9 sectors.
 *
 * Two shapes, both from the same join, because QueueEntry's own cluster_id is
 * incomplete:
 *   - `rows`: cluster_id -> sector_name, for entries that already carry a
 *     cluster_id (every currently-tracked/live stock does).
 *   - `bySymbol`: symbol -> {cluster_name, sector_name}, for entries that
 *     DON'T — lib/verdict.ts hard-codes cluster_id: null for "dormant"
 *     entries (a verdict exists but the symbol fell off the tracked set), so
 *     those were falling back to the noisy app.universe.sector field and
 *     showing up as extra sector-looking buckets ("Capital Goods",
 *     "Construction", ...) that aren't in app.meta_cluster at all.
 *     app.cluster_assignment covers ~3,250 of 3,253 universe symbols
 *     regardless of tracked status, so a symbol-keyed lookup closes that gap
 *     without touching lib/verdict.ts.
 */
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClusterMapRow = { cluster_id: string; cluster_name: string; sector_name: string };
type SymbolMapRow = { symbol: string; cluster_name: string; sector_name: string };

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  let rows: ClusterMapRow[] = [];
  try {
    rows = await sql<ClusterMapRow[]>`
      SELECT c.id AS cluster_id, c.name AS cluster_name, mc.name AS sector_name
        FROM app.cluster c
        JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    `;
  } catch {
    rows = [];
  }

  let bySymbol: SymbolMapRow[] = [];
  try {
    bySymbol = await sql<SymbolMapRow[]>`
      SELECT ca.symbol, c.name AS cluster_name, mc.name AS sector_name
        FROM app.cluster_assignment ca
        JOIN app.cluster c ON c.id = ca.cluster_id
        JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    `;
  } catch {
    bySymbol = [];
  }

  return NextResponse.json({ rows, bySymbol }, { headers: { "Cache-Control": "no-store" } });
}
