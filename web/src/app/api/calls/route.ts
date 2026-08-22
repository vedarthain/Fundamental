/**
 * /api/calls — per-user Buy/Sell "calls" (see db/migrations/0057_stock_call).
 *
 *   GET    — list the signed-in user's calls with a freshly-computed LTP and
 *            raw % move since the anchor.
 *   POST   — body { symbol, side: "B" | "S" } — make (or re-anchor) a call. The
 *            server snapshots the current price so the anchor is trustworthy.
 *   DELETE — ?symbol=SYM — clear the call (back to the neutral/greyed state).
 *
 * All three require a session; signed-out callers get 401. Prices come from
 * golden.price_history (the same source the rest of the app trusts) — the
 * client never supplies a price, so a call can't be back-dated or fudged.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql, golden } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type CallSide = "B" | "S";
export type StockCall = {
  symbol: string;
  company_name: string | null;
  side: CallSide;
  anchor_date: string;
  anchor_price: number;
  /** Fresh latest close from golden. Null if the quote couldn't be read. */
  ltp: number | null;
  /** Raw price move from anchor → LTP, in percent. Null when ltp is null. */
  pct_move: number | null;
  /** When the call was cleared (closed). Null = still active. Cleared calls
   *  leave the Buy/Sell lists but persist as history. */
  cleared_at: string | null;
  /** Price snapshot at clear time. Null for active calls (or no quote). */
  cleared_price: number | null;
  /** Realized raw move anchor → cleared_price, %. Null unless cleared w/ price. */
  cleared_pct: number | null;
};

/** Latest daily close per symbol from golden, keyed by bare NSE symbol. */
async function latestCloseBySymbol(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (symbols.length === 0) return out;
  const symbolsNS = symbols.map((s) => `${s}.NS`);
  try {
    const rows = await golden<{ symbol: string; close: number }[]>`
      SELECT symbol, close FROM (
        SELECT REPLACE(symbol, '.NS', '') AS symbol,
               close::float AS close,
               row_number() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
          FROM golden.price_history
         WHERE interval = '1d' AND symbol = ANY(${symbolsNS})
           -- Newest close, however slightly stale. A generous (but still
           -- index-bounded) window so a holiday gap, a thin-trading stretch, or
           -- a lagging local golden dump doesn't leave a symbol un-anchorable.
           AND date >= CURRENT_DATE - 45
      ) t WHERE rn = 1 AND close > 0
    `;
    for (const r of rows) out.set(r.symbol, r.close);
  } catch {
    /* golden unreachable (e.g. local dev) — leave prices empty */
  }
  return out;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const rows = await sql<
    {
      symbol: string;
      company_name: string | null;
      side: CallSide;
      anchor_date: string;
      anchor_price: number;
      cleared_at: string | null;
      cleared_price: number | null;
    }[]
  >`
    SELECT c.symbol,
           u.company_name,
           c.side,
           c.anchor_date::text AS anchor_date,
           c.anchor_price::float AS anchor_price,
           c.cleared_at::text AS cleared_at,
           c.cleared_price::float AS cleared_price
      FROM app.stock_call c
      LEFT JOIN app.universe u ON u.symbol = c.symbol
     WHERE c.user_id = ${session.userId}
     -- Active calls first (by recency), then cleared history (by clear time).
     ORDER BY c.cleared_at IS NOT NULL, COALESCE(c.cleared_at, c.updated_at) DESC
  `;

  const ltpBySym = await latestCloseBySymbol(rows.map((r) => r.symbol));
  const calls: StockCall[] = rows.map((r) => {
    const ltp = ltpBySym.get(r.symbol) ?? null;
    const pct_move =
      ltp != null && r.anchor_price > 0
        ? ((ltp - r.anchor_price) / r.anchor_price) * 100
        : null;
    // Realized move for a cleared call: anchor → the price we snapshotted when
    // it was cleared (what you'd have captured), independent of today's LTP.
    const cleared_pct =
      r.cleared_price != null && r.anchor_price > 0
        ? ((r.cleared_price - r.anchor_price) / r.anchor_price) * 100
        : null;
    return { ...r, ltp, pct_move, cleared_pct };
  });
  return NextResponse.json({ calls });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  let payload: { symbol?: unknown; side?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const symbol = typeof payload.symbol === "string" ? payload.symbol.toUpperCase().trim() : "";
  const side = payload.side === "B" || payload.side === "S" ? payload.side : null;
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  if (!side) return NextResponse.json({ error: "side must be 'B' or 'S'" }, { status: 400 });

  // Symbol must be a live universe equity.
  const uni = await sql<{ symbol: string; company_name: string | null }[]>`
    SELECT symbol, company_name FROM app.universe
     WHERE is_active AND symbol = ${symbol} LIMIT 1
  `;
  if (uni.length === 0)
    return NextResponse.json({ error: `"${symbol}" isn't a tracked NSE equity` }, { status: 400 });

  // Snapshot the anchor price server-side. No quote → refuse (an anchorless call
  // can't be scored).
  const ltpBySym = await latestCloseBySymbol([symbol]);
  const anchorPrice = ltpBySym.get(symbol) ?? null;
  if (anchorPrice == null)
    return NextResponse.json({ error: "no recent price to anchor this call" }, { status: 422 });

  // Upsert: re-tagging overwrites side and re-anchors date + price. Re-tagging a
  // *cleared* call reactivates it — clear cleared_at/cleared_price back to NULL.
  await sql`
    INSERT INTO app.stock_call (user_id, symbol, side, anchor_date, anchor_price)
    VALUES (${session.userId}, ${symbol}, ${side}, CURRENT_DATE, ${anchorPrice})
    ON CONFLICT (user_id, symbol) DO UPDATE
      SET side = EXCLUDED.side,
          anchor_date = EXCLUDED.anchor_date,
          anchor_price = EXCLUDED.anchor_price,
          cleared_at = NULL,
          cleared_price = NULL,
          updated_at = now()
  `;
  const call: StockCall = {
    symbol,
    company_name: uni[0].company_name,
    side,
    anchor_date: new Date().toISOString().slice(0, 10),
    anchor_price: anchorPrice,
    ltp: anchorPrice,
    pct_move: 0,
    cleared_at: null,
    cleared_price: null,
    cleared_pct: null,
  };
  return NextResponse.json({ call }, { status: 201 });
}

/**
 * PATCH — clear (close) an active call, keeping it as history. Body { symbol }.
 * Stamps cleared_at + snapshots cleared_price (the realized exit) so the call
 * drops out of the Buy/Sell lists but survives in the Cleared section. This is
 * the "I acted on this call" action — distinct from DELETE, which purges the
 * row entirely (cancel a mis-tag / remove from history).
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  let payload: { symbol?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const symbol = typeof payload.symbol === "string" ? payload.symbol.toUpperCase().trim() : "";
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });

  // Snapshot the exit price (best-effort — clearing still succeeds without one).
  const ltpBySym = await latestCloseBySymbol([symbol]);
  const clearedPrice = ltpBySym.get(symbol) ?? null;

  const rows = await sql<{ id: number }[]>`
    UPDATE app.stock_call
       SET cleared_at = now(),
           cleared_price = ${clearedPrice},
           updated_at = now()
     WHERE user_id = ${session.userId}
       AND symbol = ${symbol}
       AND cleared_at IS NULL
    RETURNING id
  `;
  if (rows.length === 0)
    return NextResponse.json({ error: "no active call to clear" }, { status: 404 });

  return NextResponse.json({ ok: true, cleared_price: clearedPrice });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const symbol = (req.nextUrl.searchParams.get("symbol") || "").toUpperCase().trim();
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });

  await sql`
    DELETE FROM app.stock_call
     WHERE user_id = ${session.userId} AND symbol = ${symbol}
  `;
  return NextResponse.json({ ok: true });
}
