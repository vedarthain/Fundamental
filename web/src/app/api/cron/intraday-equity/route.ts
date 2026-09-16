/**
 * POST /api/cron/intraday-equity — refresh live equity LTPs during market
 * hours. The TypeScript port of scripts/intraday-refresh-ltp.py.
 *
 * WHY this exists (migration from GitHub Actions): the old equity intraday
 * refresh ran in .github/workflows/intraday-refresh.yml on a 30-min cron.
 * GitHub throttles sub-hourly scheduled jobs hard — we observed ~2 of 14
 * daily fires actually running, so equity prices were only sporadically
 * fresh. This route is hit by a reliable external pinger (cron-job.org)
 * instead.
 *
 * WHAT it updates:
 *   - app.screener_meta.current_price            ← live read by /stock,
 *     /watchlist, /sectors, /industry, /tools, screener. These all see
 *     fresh prices immediately (subject to their own cache TTLs, which we
 *     purge below).
 *   - app.cluster_stocks_panel_cache.current_price (latest snapshot only)
 *     ← live read by /sectors and the watchlist panel queries.
 *   - app.etf_price.ltp                          ← the ONLY price source for
 *     ETFs and index funds, read by /portfolio's "Others" tab. These are not
 *     in app.universe (nothing to score), so the universe join below cannot
 *     reach them; before this they had no price feed at all and /portfolio
 *     carried them at the value printed on the broker CSV, frozen at import.
 *
 * This is now the ONLY Upstox intraday pinger — the index-tick pinger and the
 * /market dashboard it fed were retired; /indices is EOD-only.
 *
 * Auth: bearer INTRADAY_CRON_TOKEN (falls back to REVALIDATE_TOKEN); a stale
 * Upstox token yields a soft 200 no-op so a missed morning reauth never trips
 * the pinger.
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { sql } from "@/lib/db";
import { fetchLtpsByKeys, UpstoxTokenError } from "@/lib/upstox";
import { withinPingerWindow } from "@/lib/marketHours";
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

  // Market-hours guard FIRST — before any DB access. Off-hours fires no-op
  // here so they never wake Neon (the biggest lever on compute-hours, since
  // the Launch plan's autosuspend can't go below 5 min).
  if (!withinPingerWindow()) {
    return NextResponse.json({ ok: false, reason: "closed" });
  }

  try {
    // symbol ↔ instrument_key for the active universe that has an Upstox map.
    const mapping = await sql<{ symbol: string; instrument_key: string }[]>`
      SELECT i.symbol, i.instrument_key
        FROM app.upstox_instrument i
        JOIN app.universe u ON u.symbol = i.symbol AND u.is_active
    `;
    // …plus every UNSCORED instrument somebody actually holds (ETFs, index
    // funds). These are not in app.universe by design — no fundamentals, no
    // cluster, no score — so the join above can never reach them, and before
    // this they had no price source at all: /portfolio carried them at the
    // value printed on the broker CSV, frozen at import. 2.36L of my own book,
    // drifting silently.
    //
    // Two resolution paths because brokers disagree about what they export.
    // Groww gives a fund name and an ISIN ("MOTILALAMC - MOCAPITAL" /
    // INF247L01EV3); Upstox and Zerodha give the bare NSE ticker and no ISIN.
    // ISIN first since it is an identifier rather than a label, then the
    // ticker. Together they resolve 26/26 of mine — which is why there is no
    // fund-name normaliser here, and must not be one: matching ETFs by name is
    // guesswork when the ISIN is sitting right there.
    //
    // Scoped to instruments somebody holds rather than every ETF on the
    // exchange, so this stays at tens of extra LTPs, not thousands.
    const heldEtfs = await sql<{ symbol: string; instrument_key: string }[]>`
      SELECT DISTINCT i.symbol, i.instrument_key
        FROM app.portfolio_holding h
        JOIN app.upstox_instrument i
          ON i.isin = h.isin
          OR i.symbol = upper(trim(h.raw_symbol))
       WHERE h.is_mapped = false
         AND h.quantity > 0
    `;
    if (mapping.length === 0) {
      return NextResponse.json(
        { ok: false, reason: "no-instruments", message: "run fetch-upstox-instruments first" },
        { status: 500 },
      );
    }

    const keyToSym = new Map(mapping.map((m) => [m.instrument_key, m.symbol]));
    // ETF keys minus anything already in the universe set — a held instrument
    // that IS scored belongs to the equity path and must not be written twice.
    const etfKeyToSym = new Map(
      heldEtfs
        .filter((e) => !keyToSym.has(e.instrument_key))
        .map((e) => [e.instrument_key, e.symbol] as const),
    );

    // Pull LTPs (batched inside the client). Soft no-op on a stale token.
    // One combined fetch: the batching is per-request inside the client, so
    // folding the ETF keys in here costs at most one extra Upstox call rather
    // than a second round of the whole batch.
    let priceByKey: Map<string, number>;
    try {
      priceByKey = await fetchLtpsByKeys([
        ...mapping.map((m) => m.instrument_key),
        ...etfKeyToSym.keys(),
      ]);
    } catch (e) {
      if (e instanceof UpstoxTokenError) {
        return NextResponse.json({ ok: false, reason: "token", message: e.message });
      }
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, reason: "upstox", message: msg }, { status: 502 });
    }

    // Map instrument_token → our symbol → price (parallel arrays for unnest).
    // keyToSym only holds universe keys, so ETF ticks can't leak into the
    // equity arrays and reach app.screener_meta — they're split out below.
    const syms: string[] = [];
    const prices: number[] = [];
    const etfSyms: string[] = [];
    const etfKeys: string[] = [];
    const etfPrices: number[] = [];
    for (const [key, price] of priceByKey) {
      const sym = keyToSym.get(key);
      if (sym) { syms.push(sym); prices.push(price); continue; }
      const etf = etfKeyToSym.get(key);
      // ltp > 0 is a CHECK on app.etf_price; a zero/absent tick means "no
      // trade", which must leave the previous price standing rather than
      // overwrite it with a nonsense number.
      if (etf && price > 0) { etfSyms.push(etf); etfKeys.push(key); etfPrices.push(price); }
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

    // ETFs / index funds held by somebody but not in the scored universe.
    // Upsert rather than update: unlike screener_meta there is no pre-existing
    // row to update — a newly imported ETF has to create its own.
    let etfRes = 0;
    if (etfSyms.length) {
      const r = await sql`
        INSERT INTO app.etf_price (symbol, instrument_key, ltp, fetched_at)
        SELECT sym, key, price, NOW()
          FROM unnest(${etfSyms}::text[], ${etfKeys}::text[], ${etfPrices}::float8[])
               AS up(sym, key, price)
        ON CONFLICT (symbol) DO UPDATE
           SET ltp = EXCLUDED.ltp,
               instrument_key = EXCLUDED.instrument_key,
               fetched_at = EXCLUDED.fetched_at
      `;
      etfRes = r.count ?? 0;
    }

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
      rows_etf_price: etfRes,
      intraday_ticks: syms.length,
    });
  } catch (e) {
    // Surface the message so a 500 isn't an opaque empty body.
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, reason: "exception", message: msg }, { status: 500 });
  }
}
