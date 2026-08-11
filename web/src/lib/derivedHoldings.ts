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
 * EXCEPTION — hand-entered trades: a MANUAL entry is a deliberate correction, so
 * it layers on top of the snapshot. When a snapshotted symbol has manual trades,
 * we seed the walk with the snapshot as an opening lot and apply the manual
 * trades on top; the resulting derived row supersedes the snapshot in the read
 * model (loadPortfolio suppresses the raw snapshot rows for such symbols).
 * Imported tradebooks still defer to the snapshot (they can overlap its lots).
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
  // Real broker snapshot rows for this symbol (everything except our synthetic
  // 'derived'). A symbol may be snapshotted at several brokers → sum them into a
  // single opening lot with a weighted-average cost.
  const snapRows = await db<{ qty: number; avg: number | null; imported_at: string | null }[]>`
    SELECT quantity::float8 AS qty, avg_cost::float8 AS avg, imported_at::text AS imported_at
      FROM app.portfolio_holding
     WHERE user_id = ${userId} AND broker <> 'derived' AND symbol = ${symbol}
  `;
  const hasSnapshot = snapRows.length > 0;

  // All transactions for this symbol, tagged with whether they're hand-entered.
  const txns = await db<(Txn & { manual: boolean })[]>`
    SELECT side, trade_date::text AS d, quantity::float8 AS qty, price::float8 AS price,
           (source_file = 'manual-entry') AS manual
      FROM app.portfolio_transaction
     WHERE user_id = ${userId} AND symbol = ${symbol}
     ORDER BY trade_date ASC, trade_time ASC NULLS FIRST, id ASC
  `;
  const hasManual = txns.some((t) => t.manual);

  // SNAPSHOT WINS — UNLESS the user hand-entered trades for this symbol. A manual
  // entry is a deliberate correction, so it layers on top of the snapshot (below).
  // Imported tradebooks still defer: a date-windowed export can overlap the
  // snapshot's lots and would double-count if applied on top.
  if (hasSnapshot && !hasManual) {
    await db`
      DELETE FROM app.portfolio_holding
       WHERE user_id = ${userId} AND broker = 'derived' AND raw_symbol = ${symbol}
    `;
    return;
  }

  // Average-cost walk. When a snapshot exists we seed an opening lot from it and
  // apply ONLY the manual trades on top (imported trades defer to the snapshot).
  // With no snapshot we walk every trade (pure derived).
  let qty = 0;
  let avg = 0; // cost basis per share
  let firstDate: string | null = null;
  if (hasSnapshot) {
    let sQty = 0, sCostSum = 0, sCostQty = 0, sDate: string | null = null;
    for (const r of snapRows) {
      sQty += r.qty;
      if (r.avg != null) { sCostSum += r.qty * r.avg; sCostQty += r.qty; }
      if (r.imported_at && (sDate == null || r.imported_at < sDate)) sDate = r.imported_at;
    }
    qty = sQty;
    avg = sCostQty > 0 ? sCostSum / sCostQty : 0;
    firstDate = sDate;
  }
  const walk = hasSnapshot ? txns.filter((t) => t.manual) : txns;
  for (const t of walk) {
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
