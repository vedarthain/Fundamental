/**
 * GET /api/scanner/sparklines — on-demand refetch for the row sparklines when a
 * user switches the per-tab time window.
 *
 * The scanner page server-renders the DEFAULT window for first paint; this route
 * exists ONLY for the client toggle, so it's force-dynamic and reuses the exact
 * same batched loader (one golden query for the whole symbol list — never per row).
 *
 * Query params:
 *   syms — comma-separated BARE symbols (no ".NS"); capped to keep the query sane.
 *   days — calendar-day lookback; clamped to [7, 20000] (20000 = the ALL sentinel).
 */
import { NextResponse } from "next/server";
import { loadSparklines } from "@/lib/sparklines";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 300;
const MIN_DAYS = 7;
const MAX_DAYS = 20000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawSyms = (url.searchParams.get("syms") ?? "").trim();
  const rawDays = Number(url.searchParams.get("days"));

  const syms = rawSyms
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (syms.length === 0) return NextResponse.json({ data: {} });

  const days = Number.isFinite(rawDays)
    ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(rawDays)))
    : 365;

  const data = await loadSparklines(syms, days);
  return NextResponse.json({ data });
}
