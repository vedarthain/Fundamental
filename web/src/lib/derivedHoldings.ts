/**
 * Transaction-derived holdings.
 *
 * A position the user hasn't given us a broker snapshot for can still be shown
 * by COMPUTING it from their trades (manual entries + uploaded tradebooks). We
 * store that as a synthetic broker='derived' row in app.portfolio_holding
 * (0050_portfolio_manual_trades.sql), recomputed from scratch on every trade
 * change so it can never drift.
 *
 * SNAPSHOT WINS (Deb's rule): if a real broker snapshot exists for the symbol,
 * NO derived row is kept — the snapshot is the accurate current quantity, and a
 * date-windowed tradebook could otherwise miss pre-window lots. Derived rows
 * fill gaps only, and the UI flags them as "from trades — may be incomplete".
 *
 * Cost basis = average-cost method: a buy blends into the running avg; a sell
 * reduces quantity at the current avg. Net qty ≤ 0 ⇒ position flat ⇒ no row.
 * imported_at is set to the FIRST trade date, so "held for" reflects the real
 * holding period (unlike snapshots, which only know "tracked since import").
 */
import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/db";

// Accepts either the pool (`sql`) or a transaction handle (`tx`).
type Db = postgres.Sql | postgres.TransactionSql;

type Txn = { side: string; d: string; qty: number; price: number };

/**
 * Rebuild the derived portfolio_holding row for one (user, symbol) from that
 * user's transactions. No-op-safe and idempotent. Enforces snapshot-wins.
 */
export async function recomputeDerivedHolding(
  db: Db,
  userId: number,
  symbol: string,
): Promise<void> {
  // Snapshot wins: a real broker already reports this symbol → drop any derived
  // row and stop. (Real brokers are everything except our synthetic 'derived'.)
  const snap = await db<{ one: number }[]>`
    SELECT 1 AS one FROM app.portfolio_holding
     WHERE user_id = ${userId} AND broker <> 'derived' AND symbol = ${symbol}
     LIMIT 1
  `;
  if (snap.length > 0) {
    await db`
      DELETE FROM app.portfolio_holding
       WHERE user_id = ${userId} AND broker = 'derived' AND raw_symbol = ${symbol}
    `;
    return;
  }

  const txns = await db<Txn[]>`
    SELECT side, trade_date::text AS d, quantity::float8 AS qty, price::float8 AS price
      FROM app.portfolio_transaction
     WHERE user_id = ${userId} AND symbol = ${symbol}
     ORDER BY trade_date ASC, trade_time ASC NULLS FIRST, id ASC
  `;

  // Average-cost walk.
  let qty = 0;
  let avg = 0; // cost basis per share
  let firstDate: string | null = null;
  for (const t of txns) {
    if (firstDate == null) firstDate = t.d;
    if (t.side === "buy") {
      const next = qty + t.qty;
      avg = next > 0 ? (qty * avg + t.qty * t.price) / next : 0;
      qty = next;
    } else {
      qty -= t.qty; // sell: avg unchanged
    }
  }
  qty = Math.round(qty * 10000) / 10000;

  if (qty <= 0) {
    await db`
      DELETE FROM app.portfolio_holding
       WHERE user_id = ${userId} AND broker = 'derived' AND raw_symbol = ${symbol}
    `;
    return;
  }

  const isinRow = await db<{ isin: string | null }[]>`
    SELECT isin FROM app.universe WHERE symbol = ${symbol} LIMIT 1
  `;
  const isin = isinRow[0]?.isin ?? null;
  // Cost unknown (e.g. first trade in a windowed export is a sell) → NULL, not 0.
  const avgCost = avg > 0 ? Math.round(avg * 10000) / 10000 : null;
  const importedAt = firstDate ?? new Date().toISOString().slice(0, 10);

  // Derived rows always reference universe symbols → is_mapped=true, so the read
  // model re-prices them live from golden (same path as real broker holdings).
  await db`
    INSERT INTO app.portfolio_holding
      (user_id, broker, raw_symbol, isin, symbol, is_mapped, quantity, avg_cost, source_batch, imported_at)
    VALUES
      (${userId}, 'derived', ${symbol}, ${isin}, ${symbol}, true, ${qty}, ${avgCost},
       gen_random_uuid(), ${importedAt})
    ON CONFLICT (user_id, broker, raw_symbol) DO UPDATE
      SET quantity   = EXCLUDED.quantity,
          avg_cost   = EXCLUDED.avg_cost,
          isin       = EXCLUDED.isin,
          symbol     = EXCLUDED.symbol,
          is_mapped  = true,
          imported_at = EXCLUDED.imported_at
  `;
}

/** Recompute derived holdings for many symbols (e.g. after a bulk import). */
export async function recomputeDerivedHoldings(
  db: Db,
  userId: number,
  symbols: string[],
): Promise<void> {
  for (const s of [...new Set(symbols)]) {
    await recomputeDerivedHolding(db, userId, s);
  }
}

/** Convenience wrapper for callers that just have the pool. */
export const recompute = (userId: number, symbol: string) =>
  recomputeDerivedHolding(sql, userId, symbol);
