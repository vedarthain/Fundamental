/**
 * GET|POST /api/cron/portfolio-snapshot — accrue one portfolio_snapshot row
 * per user per day (the forward-only equity curve, 0041_portfolio.sql).
 *
 * For every user that has holdings we re-value the portfolio live (same code
 * path the /portfolio page uses) and UPSERT the row keyed by
 * (user_id, snap_date) — so a re-run for the same price date overwrites, never
 * duplicates.
 *
 * `snap_date` IS THE PRICE DATE, NOT THE CALENDAR DATE. See run().
 *
 * SCHEDULE (web/vercel.json, which is JSON and cannot hold this comment):
 * 18:00 UTC and again 20:00 UTC, Mon–Fri. refresh-ltp — the job that puts the
 * day's close into golden — has measured 17:33–18:35 UTC completion, so the
 * first run usually has the day's bar and the second is the retry for when it
 * doesn't. The second run is free: it re-values the same price date and the
 * UPSERT overwrites. Neither time is load-bearing for correctness (the row is
 * dated by its prices, not the clock); they only decide whether a trading day
 * gets captured at all.
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

/**
 * Today's date in Asia/Kolkata as YYYY-MM-DD. FALLBACK ONLY — used when the
 * revaluation produced no price date at all (a book of entirely unmapped
 * holdings). Anything with a price date is dated by that. See run().
 */
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

  const userRows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT user_id::text AS user_id FROM app.portfolio_holding
  `;

  let written = 0;
  const results: { userId: number; snapDate: string; value: number }[] = [];
  for (const u of userRows) {
    const userId = Number(u.user_id);
    const pf = await loadPortfolio(userId);
    if (!pf.hasHoldings) continue;

    // ── The date on this row is the date of the PRICES in it ────────────────
    //
    // This used to be istDate() — the wall-clock day the job happened to run.
    // That silently mis-dated the entire equity curve for two months.
    //
    // loadPortfolio prices a mapped holding off golden's latest daily close,
    // and day_change_value is (that close − the one before it). golden does
    // not receive today's close until refresh-ltp finishes, measured at
    // ~17:50 UTC. This cron ran at 12:30 UTC. So every row stamped day D
    // actually held D−1's close and D−1's move, and the chart plotted the
    // whole book one trading day to the right of reality. Nothing could catch
    // it: the numbers were internally consistent and plausibly sized. It
    // surfaced only because the live Day-change card and the curve disagreed
    // in SIGN on 2026-09-26 (+5,532 against −16,021).
    //
    // Moving the cron later fixes today and breaks again the first time
    // anything drifts — Vercel cron drift is already +50 min in this project's
    // own logs, and 18:30 UTC rolls istDate() forward into the next IST day.
    // So the schedule is no longer load-bearing: the row is dated by the data
    // it contains. A job that runs early now overwrites the PREVIOUS price
    // date's row with a fresher valuation of that same date — correct, and
    // visibly so — instead of inventing a day.
    //
    // pf.priceAsOf is the newest date behind the LTP column (golden's close,
    // or an intraday tick when one is genuinely newer). Null only when nothing
    // in the book could be priced, in which case there is no price date to
    // use and the calendar is the honest fallback.
    const snapDate = pf.priceAsOf ?? istDate();

    // Compact per-symbol breakdown for the curve / attribution.
    //
    // sql.json(holdings), NOT `${JSON.stringify(holdings)}::jsonb` — the
    // latter binds a text parameter and the cast then stores a jsonb STRING
    // scalar, so every row written before 2026-09-26 needs `holdings#>>'{}'`
    // to read back. Same mistake as the scanner bookmarks double-encode.
    // Nothing reads this column yet, which is exactly why it went unnoticed.
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
         ${pf.totals.dayChangeValue}, ${sql.json(holdings)})
      ON CONFLICT (user_id, snap_date) DO UPDATE SET
        total_value      = EXCLUDED.total_value,
        total_cost       = EXCLUDED.total_cost,
        day_change_value = EXCLUDED.day_change_value,
        holdings         = EXCLUDED.holdings,
        created_at       = now()
    `;
    written++;
    results.push({ userId, snapDate, value: pf.totals.currentValue });
  }

  return NextResponse.json({ ok: true, users: userRows.length, written, results });
}
