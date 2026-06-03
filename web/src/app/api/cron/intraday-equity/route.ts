/**
 * POST /api/cron/intraday-equity — refresh live equity LTPs during market
 * hours. The TypeScript port of scripts/intraday-refresh-ltp.py.
 *
 * WHY this exists (migration from GitHub Actions): the old equity intraday
 * refresh ran in .github/workflows/intraday-refresh.yml on a 30-min cron.
 * GitHub throttles sub-hourly scheduled jobs hard — we observed ~2 of 14
 * daily fires actually running, so equity prices were only sporadically
 * fresh. This route is hit by a reliable external pinger (cron-job.org)
 * instead, the same pattern that fixed the index ticks.
 *
 * WHAT it updates (and what it deliberately does NOT):
 *   - app.screener_meta.current_price            ← live read by /stock,
 *     /watchlist, /sectors, /industry, /tools, screener. These all see
 *     fresh prices immediately (subject to their own cache TTLs, which we
 *     purge below).
 *   - app.cluster_stocks_panel_cache.current_price (latest snapshot only)
 *     ← live read by /sectors and the watchlist/overview panel queries.
 *
 *   It does NOT rebuild app.market_snapshot_cache — that precomputed blob
 *   (read ONLY by /api/market/overview) is rebuilt by the daily EOD
 *   refresh-ltp pipeline. So the /market dashboard's mover *cards* show
 *   EOD prices intraday. That's acceptable: mover rankings are computed
 *   from EOD returns, not live price, so the ordering doesn't change
 *   intraday — only the displayed number would, on that one surface.
 *   (Headline indices on /market ARE live via the separate index pinger.)
 *
 * Auth + token handling mirror /api/cron/intraday-index: bearer
 * INTRADAY_CRON_TOKEN (falls back to REVALIDATE_TOKEN); a stale Upstox
 * token yields a soft 200 no-op so a missed morning reauth never trips the
 * pinger.
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { sql } from "@/lib/db";
import { fetchLtpsByKeys, UpstoxTokenError } from "@/lib/upstox";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Full-universe fetch is ~11 Upstox calls + 2 bulk UPDATEs. Give it room.
export const maxDuration = 60;

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

  try {
    // symbol ↔ instrument_key for the active universe that has an Upstox map.
    const mapping = await sql<{ symbol: string; instrument_key: string }[]>`
      SELECT i.symbol, i.instrument_key
        FROM app.upstox_instrument i
        JOIN app.universe u ON u.symbol = i.symbol AND u.is_active
    `;
    if (mapping.length === 0) {
      return NextResponse.json(
        { ok: false, reason: "no-instruments", message: "run fetch-upstox-instruments first" },
        { status: 500 },
      );
    }

    const keyToSym = new Map(mapping.map((m) => [m.instrument_key, m.symbol]));

    // Pull LTPs (batched inside the client). Soft no-op on a stale token.
    let priceByKey: Map<string, number>;
    try {
      priceByKey = await fetchLtpsByKeys(mapping.map((m) => m.instrument_key));
    } catch (e) {
      if (e instanceof UpstoxTokenError) {
        return NextResponse.json({ ok: false, reason: "token", message: e.message });
      }
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, reason: "upstox", message: msg }, { status: 502 });
    }

    // Map instrument_token → our symbol → price (parallel arrays for unnest).
    const syms: string[] = [];
    const prices: number[] = [];
    for (const [key, price] of priceByKey) {
      const sym = keyToSym.get(key);
      if (sym) { syms.push(sym); prices.push(price); }
    }

    if (syms.length === 0) {
      return NextResponse.json({ ok: false, reason: "empty", written: 0 });
    }

    // Bulk UPDATE via unnest of two parallel arrays — postgres-js sends JS
    // arrays as native Postgres arrays. One round-trip per table.
    const metaRes = await sql`
      UPDATE app.screener_meta sm
         SET current_price   = up.price,
             price_fetched_at = NOW()
        FROM unnest(${syms}::text[], ${prices}::float8[]) AS up(sym, price)
       WHERE sm.symbol = up.sym
    `;
    const panelRes = await sql`
      UPDATE app.cluster_stocks_panel_cache c
         SET current_price = up.price
        FROM unnest(${syms}::text[], ${prices}::float8[]) AS up(sym, price)
       WHERE c.symbol = up.sym
         AND c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
    `;

    // APPEND one tick per symbol so the /stock 1D chart can draw a real
    // intraday curve (current_price above is overwritten each fire and keeps
    // no shape). Same LTPs already in hand — one extra bulk INSERT, no extra
    // Upstox calls. ts defaults to now() for every row in the batch.
    await sql`
      INSERT INTO app.stock_intraday (symbol, ltp)
      SELECT sym, price
        FROM unnest(${syms}::text[], ${prices}::float8[]) AS up(sym, price)
    `;
    // Retention: keep ~one trading day. A touch over 24h so the current
    // IST-day read is never truncated at the boundary.
    await sql`
      DELETE FROM app.stock_intraday
       WHERE ts < now() - INTERVAL '26 hours'
    `;

    // Purge the live-reading surfaces so fresh prices show on the next render.
    // (Not "market"/"snapshot" — that blob is unchanged until the EOD rebuild.)
    revalidateTag("panel-cache", "default");
    revalidateTag("sectors", "default");

    return NextResponse.json({
      ok: true,
      fetched: syms.length,
      rows_screener_meta: metaRes.count ?? 0,
      rows_panel_cache: panelRes.count ?? 0,
      intraday_ticks: syms.length,
    });
  } catch (e) {
    // Surface the message so a 500 isn't an opaque empty body.
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, reason: "exception", message: msg }, { status: 500 });
  }
}
