/**
 * GET|POST /api/cron/trend-leaders — recompute the daily "fresh trend
 * initiation" scanner and cache it into app.trend_leader_signal (0043).
 *
 * The slow-burn sibling of /api/cron/momentum-signals. Where that catches a
 * one-day volume explosion, this catches the START of a durable uptrend: a
 * 50-SMA that just crossed above a rising 200-SMA within ~30 sessions, price
 * near its 52-week high. Keys off the LATEST golden bar (MAX(date)), so a
 * same-day re-run REPLACES that day's rows rather than duplicating.
 *
 * Auth mirrors the other crons: Bearer CRON_SECRET or REVALIDATE_TOKEN.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { computeTrendLeaders, persistTrendLeaders } from "@/lib/trendLeaders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  const { snapDate, signals } = await computeTrendLeaders();
  if (!snapDate) {
    return NextResponse.json({ ok: false, error: "no price data" }, { status: 500 });
  }
  await persistTrendLeaders(snapDate, signals);

  return NextResponse.json({
    ok: true,
    snapDate,
    written: signals.length,
    scored: signals.filter((s) => s.isScored).length,
    symbols: signals.map((s) => s.symbol),
  });
}
