/**
 * GET|POST /api/cron/keep-warm — defeat Vercel cold-start on the heavy routes.
 *
 * WHY: /watchlist, /portfolio and /tools/scanner each pull in a large client
 * bundle (charts, the graph universe). When their serverless function goes cold
 * — which happens after a few idle minutes on low-traffic apps — the FIRST hard
 * load pays 2–3s of function boot BEFORE any of our code runs (measured: scanner
 * 2.63s cold vs 0.47s warm; watchlist document 3.4s cold). The data itself is
 * fast (the /api/watchlist golden waterfall is ~0.5s). So the fix is not query
 * tuning — it's keeping the functions warm.
 *
 * HOW (and why it costs ZERO Neon): this route server-side fetches the three
 * pages WITHOUT a session cookie. getSession() returns null on a missing cookie
 * in a single HMAC compute (no DB), and the watchlist/portfolio pages early-
 * return their sign-in shell before touching the database; scanner honours a
 * ?warm=1 short-circuit that returns before any loader runs. So every function's
 * bundle gets loaded and kept warm while Neon is never woken. Rule #1 satisfied.
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Paths whose functions we keep warm. Unauthenticated GETs to these hit no DB
// (see the file header); scanner carries ?warm=1 to short-circuit its loaders.
const WARM_PATHS = ["/watchlist", "/portfolio", "/tools/scanner?warm=1"];

// Active window: keep warm only 08:00–22:00 IST (the hours the app is actually
// used). Enforced HERE, not just on the cron-job.org schedule, so a wrong
// timezone on the pinger side can't silently widen the window — an off-hours
// ping becomes a cheap no-op. IST = UTC+5:30: shift the clock and read the hour.
const WARM_START_HOUR_IST = 8; // inclusive — first warm hour
const WARM_END_HOUR_IST = 22; // exclusive — last ping fires at 21:55, warm through 22:00
function withinActiveWindowIST(): boolean {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const hour = new Date(istMs).getUTCHours();
  return hour >= WARM_START_HOUR_IST && hour < WARM_END_HOUR_IST;
}

function authOk(req: NextRequest): boolean {
  const expected = process.env.INTRADAY_CRON_TOKEN || process.env.REVALIDATE_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const given = m?.[1] ?? req.nextUrl.searchParams.get("token") ?? "";
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

async function warm(req: NextRequest): Promise<NextResponse> {
  // Outside 08:00–22:00 IST: skip the fan-out entirely (no page warming, no cost
  // beyond this one trivial invocation). The app isn't used overnight.
  if (!withinActiveWindowIST()) {
    return NextResponse.json({ ok: true, skipped: "outside 08:00-22:00 IST" });
  }
  // Warm the deployment that received this ping (prod in practice). Same-origin
  // fetches keep us on the right region's instances.
  const origin = req.nextUrl.origin;
  const t0 = Date.now();
  const results = await Promise.allSettled(
    WARM_PATHS.map(async (p) => {
      const started = Date.now();
      // No cookies, no cache — a clean signed-out boot of the target function.
      const res = await fetch(`${origin}${p}`, {
        headers: { "user-agent": "keep-warm" },
        cache: "no-store",
        redirect: "manual",
      });
      // Drain the body so the request fully completes (function stays warm).
      await res.arrayBuffer().catch(() => undefined);
      return { path: p, status: res.status, ms: Date.now() - started };
    }),
  );
  const warmed = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { path: WARM_PATHS[i], status: 0, error: String(r.reason) },
  );
  return NextResponse.json({ ok: true, ms: Date.now() - t0, warmed });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return warm(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return warm(req);
}
