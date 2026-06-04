/**
 * POST /api/cron/intraday-index — capture a live LTP tick for the two
 * headline indices (NIFTY 50, NIFTY BANK) into app.market_index_intraday.
 *
 * Trigger: an external pinger (cron-job.org) hits this every ~10 min
 * during market hours (09:16–15:30 IST, Mon–Fri). We use an external
 * pinger rather than GitHub Actions cron because GH throttles scheduled
 * jobs hard at sub-hourly cadence (observed ~2 of 14 fires running);
 * cron-job.org fires reliably to the second. Vercel Cron isn't an option
 * on the Hobby plan (daily-only).
 *
 * Auth: bearer token compared against INTRADAY_CRON_TOKEN (falls back to
 * REVALIDATE_TOKEN so no new secret is strictly required). Constant-time
 * compare. The only thing a stolen token buys an attacker is forcing an
 * extra Upstox quote + one tiny insert — low blast radius, same posture
 * as /api/revalidate.
 *
 * Token-expired handling: if the daily Upstox login hasn't happened yet,
 * fetchIndexQuotes() throws UpstoxTokenError and we return 200 with
 * {ok:false, reason:"token"} — a SOFT no-op. This keeps the pinger from
 * treating a missing-reauth morning as a hard failure and retry-storming.
 *
 * Why this doesn't bust the /market cache: the live readout is served by
 * the separate, lightly-cached /api/market/index-live endpoint that the
 * client polls. Busting the full 1-hour /market payload every 15 min would
 * defeat the CDN caching that keeps origin transfer cheap. So this route
 * only writes the tick; the client picks it up independently.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { fetchIndexQuotes, UpstoxTokenError } from "@/lib/upstox";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authOk(req: NextRequest): boolean {
  const expected = process.env.INTRADAY_CRON_TOKEN || process.env.REVALIDATE_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const given = m?.[1] ?? req.nextUrl.searchParams.get("token") ?? "";
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Pull live LTPs. Soft no-op if the token isn't fresh for the day.
  let quotes;
  try {
    quotes = await fetchIndexQuotes();
  } catch (e) {
    if (e instanceof UpstoxTokenError) {
      // 200, not 5xx — a missed morning reauth is operator state, not a
      // pipeline failure. The pinger should treat this as "nothing to do".
      return NextResponse.json({ ok: false, reason: "token", message: e.message });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, reason: "upstox", message: msg }, { status: 502 });
  }

  if (quotes.length === 0) {
    return NextResponse.json({ ok: false, reason: "empty", written: 0 });
  }

  // Prior trading day's close per index — the baseline for "change today".
  // One small read; latest daily row per code.
  const prevRows = await sql<{ index_code: string; close: number }[]>`
    SELECT DISTINCT ON (index_code) index_code, close::float AS close
      FROM app.market_index_history
     WHERE index_code = ANY(${quotes.map((q) => q.index_code)})
     ORDER BY index_code, date DESC
  `;
  const prevClose = new Map(prevRows.map((r) => [r.index_code, r.close]));

  // Insert one tick per index. pct_change computed against prev close when
  // we have it; NULL otherwise (e.g. a brand-new index with no daily row).
  let written = 0;
  for (const q of quotes) {
    const pc = prevClose.get(q.index_code) ?? null;
    const pct = pc && pc > 0 ? ((q.ltp - pc) / pc) * 100 : null;
    await sql`
      INSERT INTO app.market_index_intraday (index_code, ts, ltp, prev_close, pct_change)
      VALUES (${q.index_code}, now(), ${q.ltp}, ${pc}, ${pct})
    `;
    written++;
  }

  // Retention cap: keep ~48h of ticks. The 1D chart reads the most-recent
  // SESSION's slice, so the full prior session must survive overnight until
  // the next 09:15 open (a 24h cap would prune the prior morning's ticks by
  // the next morning, truncating the held curve). 48h covers it; volume is
  // trivial (~26 ticks/day x 14 indices x 2 days).
  await sql`
    DELETE FROM app.market_index_intraday
     WHERE ts < now() - INTERVAL '48 hours'
  `;

  return NextResponse.json({
    ok: true,
    written,
    quotes: quotes.map((q) => ({
      code: q.index_code,
      ltp: q.ltp,
      pct: prevClose.get(q.index_code)
        ? Number((((q.ltp - prevClose.get(q.index_code)!) / prevClose.get(q.index_code)!) * 100).toFixed(2))
        : null,
    })),
  });
}
