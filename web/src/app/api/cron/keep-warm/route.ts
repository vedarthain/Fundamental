/**
 * GET|POST /api/cron/keep-warm — defeat Vercel cold-start on the heavy routes.
 *
 * WHY: /dashboard, /watchlist, /portfolio and /tools/scanner each pull in a large client
 * bundle (charts, the graph universe). When their serverless function goes cold
 * — which happens after a few idle minutes on low-traffic apps — the FIRST hard
 * load pays 2–3s of function boot BEFORE any of our code runs (measured: scanner
 * 2.63s cold vs 0.47s warm; watchlist document 3.4s cold). The data itself is
 * fast (the /api/watchlist golden waterfall is ~0.5s). So the fix is not query
 * tuning — it's keeping the functions warm.
 *
 * HOW (and why it costs ZERO Neon): this route server-side fetches those
 * pages WITHOUT a session cookie. getSession() returns null on a missing cookie
 * in a single HMAC compute (no DB). Dashboard redirects to login; the
 * watchlist/portfolio pages early-return their sign-in shell before touching
 * the database; scanner honours a ?warm=1 short-circuit that returns before
 * any loader runs. So every function's bundle gets loaded and kept warm while
 * Neon is never woken. Rule #1 satisfied.
 *
 * TRIGGER: cron-job.org (the same reliable external pinger used for intraday /
 * news — GitHub's `schedule:` is load-shed and unreliable). Point ONE job at
 * this route every ~5 minutes, 7 days a week. No GitHub workflow needed — this
 * does no compute, just HTTP GETs.
 *
 * AUTH: bearer INTRADAY_CRON_TOKEN (falls back to REVALIDATE_TOKEN) — the same
 * token cron-job.org already carries, so no new secret. Auth also stops the
 * 1→3 fan-out from being an open amplification endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runMorningWarmup } from "@/lib/morningWarmup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Active window: 07:00–22:00 IST. Self-hosted DigitalOcean Postgres has zero
// per-second compute billing (unlike old Neon), so warming the caches every
// morning and during the day is completely free and makes /portfolio, /watchlist,
// and /admin/calls open in <200ms instead of 5–6s.
const WARM_START_HOUR_IST = 7;
const WARM_END_HOUR_IST = 22;

function withinActiveWindowIST(): boolean {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const hour = new Date(istMs).getUTCHours();
  return hour >= WARM_START_HOUR_IST && hour < WARM_END_HOUR_IST;
}

function authOk(req: NextRequest): boolean {
  const candidates = [
    process.env.INTRADAY_CRON_TOKEN,
    process.env.REVALIDATE_TOKEN,
    process.env.CRON_SECRET,
  ].filter((x): x is string => !!x);
  if (candidates.length === 0) return false;
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const given = m?.[1] ?? req.nextUrl.searchParams.get("token") ?? "";
  if (!given) return false;
  return candidates.some(
    (exp) => given.length === exp.length && timingSafeEqual(Buffer.from(given), Buffer.from(exp)),
  );
}

async function warm(req: NextRequest): Promise<NextResponse> {
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !withinActiveWindowIST()) {
    return NextResponse.json({ ok: true, skipped: "outside_active_window_ist" });
  }
  try {
    const res = await runMorningWarmup(1);
    return NextResponse.json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return warm(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return warm(req);
}


