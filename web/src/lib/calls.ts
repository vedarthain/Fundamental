/**
 * Per-user Buy/Sell "calls" — the shared read path (see db/migrations/0057_stock_call).
 *
 * Lives here rather than in /api/calls so the route and the /dashboard zone
 * compute the anchor → LTP move from the same query. Two copies of this would
 * drift the moment one of them changed its staleness window, and a call's %
 * move disagreeing with itself across two screens is worse than either number.
 *
 * Prices come from golden.price_history — the client never supplies one, so a
 * call cannot be back-dated or fudged.
 */
import "server-only";
import { sql, golden } from "@/lib/db";

export type CallSide = "B" | "S";

export type StockCall = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  industry: string | null;
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
export async function latestCloseBySymbol(symbols: string[]): Promise<Map<string, number>> {
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

/** Every call for a user: active first by recency, then cleared history. */
export async function loadCalls(userId: number): Promise<StockCall[]> {
  const rows = await sql<
    {
      symbol: string;
      company_name: string | null;
      sector: string | null;
      industry: string | null;
      side: CallSide;
      anchor_date: string;
      anchor_price: number;
      cleared_at: string | null;
      cleared_price: number | null;
    }[]
  >`
    SELECT c.symbol,
           u.company_name,
           u.sector,
           u.industry,
           c.side,
           c.anchor_date::text AS anchor_date,
           c.anchor_price::float AS anchor_price,
           c.cleared_at::text AS cleared_at,
           c.cleared_price::float AS cleared_price
      FROM app.stock_call c
      LEFT JOIN app.universe u ON u.symbol = c.symbol
     WHERE c.user_id = ${userId}
     -- Active calls first (by recency), then cleared history (by clear time).
     ORDER BY c.cleared_at IS NOT NULL, COALESCE(c.cleared_at, c.updated_at) DESC
  `;

  const ltpBySym = await latestCloseBySymbol(rows.map((r) => r.symbol));
  return rows.map((r) => {
    const ltp = ltpBySym.get(r.symbol) ?? null;
    const pct_move =
      ltp != null && r.anchor_price > 0 ? ((ltp - r.anchor_price) / r.anchor_price) * 100 : null;
    // Realized move for a cleared call: anchor → the price we snapshotted when
    // it was cleared (what you'd have captured), independent of today's LTP.
    const cleared_pct =
      r.cleared_price != null && r.anchor_price > 0
        ? ((r.cleared_price - r.anchor_price) / r.anchor_price) * 100
        : null;
    return { ...r, ltp, pct_move, cleared_pct };
  });
}
