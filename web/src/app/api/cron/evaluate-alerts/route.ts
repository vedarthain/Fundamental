/**
 * GET|POST /api/cron/evaluate-alerts — daily re-evaluation of ring-1 portfolio
 * alerts for every user with holdings (see lib/alerts.ts + 0051_alerts.sql).
 *
 * Idempotent by construction: evaluateAlerts opens new episodes, leaves open
 * ones untouched, and retires cleared ones — so a same-day re-run is a noop.
 * Scheduled after the market's EOD prices land (bhavcopy top-up) so the
 * day-change and price rules see the latest close.
 *
 * Auth mirrors the other crons: `Authorization: Bearer $CRON_SECRET` (also
 * accepts REVALIDATE_TOKEN for the shared external pinger). No token → 401.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sql } from "@/lib/db";
import { evaluateAlerts } from "@/lib/alerts";

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

  const userRows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT user_id::text AS user_id FROM app.portfolio_holding
  `;

  let triggered = 0;
  let resolved = 0;
  const results: { userId: number; triggered: number; resolved: number }[] = [];
  for (const u of userRows) {
    const userId = Number(u.user_id);
    const r = await evaluateAlerts(userId);
    triggered += r.triggered;
    resolved += r.resolved;
    results.push({ userId, ...r });
  }

  return NextResponse.json({ ok: true, users: userRows.length, triggered, resolved, results });
}
