/**
 * GET|POST /api/cron/portfolio-snapshot — accrue one portfolio_snapshot row
 * per user per day (the forward-only equity curve, 0041_portfolio.sql).
 *
 * For every user that has holdings we re-value the portfolio live (same code
 * path the /portfolio page uses) and UPSERT today's row keyed by
 * (user_id, snap_date) — so a re-run on the same day overwrites, never
 * duplicates. `snap_date` is the IST calendar date, since the market and the
 * user are in India.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; we also accept
 * REVALIDATE_TOKEN so the same external pinger that runs the other crons can
 * fire this one. No token set → 401.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sql } from "@/lib/db";
import { loadPortfolio } from "@/lib/portfolio";

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

/** Today's date in Asia/Kolkata as YYYY-MM-DD. */
function istDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

  const snapDate = istDate();
  const userRows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT user_id::text AS user_id FROM app.portfolio_holding
  `;

  let written = 0;
  const results: { userId: number; value: number }[] = [];
  for (const u of userRows) {
    const userId = Number(u.user_id);
    const pf = await loadPortfolio(userId);
    if (!pf.hasHoldings) continue;

    // Compact per-symbol breakdown for the curve / attribution.
    const holdings = pf.instruments.map((i) => ({
      k: i.symbol ?? i.key,
      m: i.isMapped,
      q: i.quantity,
      v: i.currentValue,
      p: i.pnl,
    }));

    await sql`
      INSERT INTO app.portfolio_snapshot
        (user_id, snap_date, total_value, total_cost, day_change_value, holdings)
      VALUES
        (${userId}, ${snapDate}, ${pf.totals.currentValue}, ${pf.totals.invested},
         ${pf.totals.dayChangeValue}, ${JSON.stringify(holdings)}::jsonb)
      ON CONFLICT (user_id, snap_date) DO UPDATE SET
        total_value      = EXCLUDED.total_value,
        total_cost       = EXCLUDED.total_cost,
        day_change_value = EXCLUDED.day_change_value,
        holdings         = EXCLUDED.holdings,
        created_at       = now()
    `;
    written++;
    results.push({ userId, value: pf.totals.currentValue });
  }

  return NextResponse.json({ ok: true, snapDate, users: userRows.length, written, results });
}
