/**
 * GET|POST /api/cron/momentum-signals — recompute the daily volume-ignition
 * scanner and cache it into app.momentum_signal (0042_momentum.sql).
 *
 * Runs post-close on weekdays. The screen keys off the LATEST bar in
 * golden.price_history_1d (MAX(date)) rather than "today", so it's robust to
 * whenever the EOD bar lands — a re-run on the same day REPLACES that day's
 * rows, never duplicates.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; we also accept
 * REVALIDATE_TOKEN so the same external pinger that runs the other crons can
 * fire this one. No token set → 401. (Same shape as portfolio-snapshot.)
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { computeMomentumSignals, persistMomentumSignals } from "@/lib/momentum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authOk(req: NextRequest): boolean {
  const candidates = [process.env.CRON_SECRET, process.env.REVALIDATE_TOKEN].filter(
    (x): x is string => !!x,
  );
  if (candidates.length === 0) return false;
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const given = m?.[1] ?? req.nextUrl.searchParams.get("token") ?? "";
  if (!given) return false;
  return candidates.some(
    (exp) => given.length === exp.length && timingSafeEqual(Buffer.from(given), Buffer.from(exp)),
  );
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { snapDate, signals } = await computeMomentumSignals();
  if (!snapDate) {
    return NextResponse.json({ ok: false, error: "no price data" }, { status: 500 });
  }
  await persistMomentumSignals(snapDate, signals);

  return NextResponse.json({
    ok: true,
    snapDate,
    written: signals.length,
    withCatalyst: signals.filter((s) => s.catalystTitle).length,
    symbols: signals.map((s) => s.symbol),
  });
}
