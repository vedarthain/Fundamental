/**
 * /tools/screener/export — CSV download endpoint.
 *
 * Reads the same URL search params as the screener page, runs the same
 * query WITHOUT pagination (capped at 5,000 rows for safety), and
 * streams a text/csv response.  Users can pin filters in the screener
 * UI, then click "Export CSV" to download the full result set instead
 * of just the visible 50-row page.
 *
 * Cost (Rule #1): one query per export click — same shape as the page
 * query, just without LIMIT/OFFSET.  Capped at 5,000 rows so a runaway
 * filter can't produce a huge response.  Typical export: 100-500 rows,
 * < 100ms of Neon compute.
 */
import type { NextRequest } from "next/server";
import { parseParams } from "../types";
import { loadRowsForExport } from "../page";
import { tierLabel } from "@/lib/score";

export const runtime = "nodejs";
// Force dynamic — the params drive every row.  Same constraint as the
// screener page itself.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = parseParams(req.nextUrl.searchParams);
  const { rows } = await loadRowsForExport(params, { exportAll: true });

  // CSV header — same column order as the screener table, in plain
  // numeric units (no formatting, no %, no Cr suffix). That way the
  // CSV is friendly to Excel / spreadsheet pivot tables.
  const header = [
    "symbol",
    "company_name",
    "sector",
    "industry",
    "maturity_tier",
    "market_cap_cr",
    "current_price",
    "composite_pct",
    "quality_pct",
    "valuation_pct",
    "momentum_pct",
    "peer_rank",
    "peer_count",
    "pe_ttm",
    "pb",
    "roe_or_roce_3y_pct", // converted to %; ROE for BFSI, ROCE elsewhere
    "div_yield_pct",     // converted to percent
    "op_margin_3y_pct",  // converted to percent
    "ret_12m_rel_pct",   // converted to percent
  ];

  // CSV field formatter — wraps anything containing comma/quote/newline
  // in quotes and doubles internal quotes per RFC 4180.
  const esc = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const pct = (v: number | null): string =>
    v == null ? "" : (v * 100).toFixed(2);

  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      esc(r.symbol),
      esc(r.company_name),
      esc(r.sector_name),
      esc(r.industry_name),
      esc(tierLabel(r.maturity_tier)),
      esc(r.market_cap_cr ?? ""),
      esc(r.current_price ?? ""),
      esc(r.composite_pct ?? ""),
      esc(r.quality_pct ?? ""),
      esc(r.valuation_pct ?? ""),
      esc(r.momentum_pct ?? ""),
      esc(r.peer_rank ?? ""),
      esc(r.peer_count ?? ""),
      esc(r.pe_ttm ?? ""),
      esc(r.pb ?? ""),
      esc(pct(r.roe_3y)),
      esc(pct(r.div_yield)),
      esc(pct(r.op_margin_3y)),
      esc(pct(r.ret_12m_rel)),
    ].join(","));
  }
  const body = lines.join("\n") + "\n";

  // ISO date in filename so the user can tell exports apart later.
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `equityroots-screener-${stamp}.csv`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Prevent any layer (Vercel, browser) from caching — query is
      // dynamic and a cached CSV would be misleading.
      "Cache-Control": "no-store",
    },
  });
}
