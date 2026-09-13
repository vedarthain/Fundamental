/**
 * watchlistCards.ts — the three "card detail" loaders shared by the watchlist
 * list endpoint (/api/watchlist) and the per-symbol detail endpoint
 * (/api/watchlist/extras).
 *
 * Why they live here rather than inline in the route:
 *   These used to be private helpers inside /api/watchlist/route.ts, loaded for
 *   EVERY row in the list. Measured on a 234-name watchlist that was 426KB of a
 *   697KB response (glance 329KB / 47%, verdict 97KB / 14%) — shipped for every
 *   row but consumed by the ONE row the user has selected. `verdict` was worse
 *   still: nothing on the client ever rendered it.
 *
 *   The list endpoint now runs lean (see `lean=1`) and the selected card pulls
 *   its glance rows from /api/watchlist/extras on demand. Both endpoints call
 *   the SAME functions from here so the two paths can't drift apart — the exact
 *   failure mode the Python/TS tradebook parsers spent months in.
 *
 * All three are batch-shaped (symbol[] in, Map out) and NEVER throw: a failure
 * degrades the card to "—" rather than 500-ing a whole watchlist.
 */
import "server-only";
import { sql } from "@/lib/db";
import {
  deriveGlance,
  scorecardGlanceKeys,
  type GlanceMetrics,
  type MetricKey,
  type QRow,
  type ARow,
} from "@/lib/glance";
import { buildVerdict, type StockVerdict } from "@/lib/explainer";

/** Batch-load sector-aware fundamentals for every requested symbol. Two indexed
 *  reads (quarterly + annual) regardless of list size, grouped in Node. Keyed by
 *  symbol; a symbol with no fundamentals simply won't appear. Never throws. */
export async function loadGlance(symbols: string[]): Promise<Map<string, GlanceMetrics>> {
  const out = new Map<string, GlanceMetrics>();
  if (symbols.length === 0) return out;
  try {
    const [qrows, arows] = await Promise.all([
      sql<(QRow & { symbol: string })[]>`
        SELECT symbol, period_end::text AS period_end,
               sales::float AS sales, net_profit::float AS net_profit,
               operating_profit::float AS operating_profit
          FROM app.fundamentals_quarterly
         WHERE symbol = ANY(${symbols})
         ORDER BY symbol, period_end DESC
      `,
      sql<(ARow & { symbol: string })[]>`
        SELECT symbol, period_end::text AS period_end,
               sales::float AS sales, net_profit::float AS net_profit,
               borrowings::float AS borrowings,
               equity_share_capital::float AS equity_share_capital,
               reserves::float AS reserves,
               cash_from_operating::float AS cash_from_operating,
               cash_from_investing::float AS cash_from_investing,
               operating_profit::float AS operating_profit,
               expenses::float AS expenses,
               depreciation::float AS depreciation,
               interest::float AS interest,
               profit_before_tax::float AS profit_before_tax,
               net_block::float AS net_block,
               cwip::float AS cwip,
               total_assets::float AS total_assets,
               receivables::float AS receivables,
               inventory::float AS inventory,
               cash_and_bank::float AS cash_and_bank
          FROM app.fundamentals_annual
         WHERE symbol = ANY(${symbols})
           AND period_end >= (CURRENT_DATE - INTERVAL '7 years')
         ORDER BY symbol, period_end DESC
      `,
    ]);
    const qBy = new Map<string, QRow[]>();
    for (const r of qrows) {
      const arr = qBy.get(r.symbol) ?? [];
      arr.push(r);
      qBy.set(r.symbol, arr);
    }
    const aBy = new Map<string, ARow[]>();
    for (const r of arows) {
      const arr = aBy.get(r.symbol) ?? [];
      arr.push(r);
      aBy.set(r.symbol, arr);
    }
    for (const s of symbols) {
      const q = qBy.get(s);
      const a = aBy.get(s);
      if (!q && !a) continue;
      out.set(s, deriveGlance(q ?? [], a ?? []));
    }
  } catch {
    // Non-fatal — the glance table falls back to "—".
  }
  return out;
}

/** Batch-load each symbol's per-stock verdict from app.scores. One indexed read
 *  at the latest snapshot; the persisted *_components JSONBs are flattened into
 *  the handful of metrics this stock most stands out on. Never throws. */
export async function loadVerdicts(symbols: string[]): Promise<Map<string, StockVerdict>> {
  const out = new Map<string, StockVerdict>();
  if (symbols.length === 0) return out;
  try {
    const rows = await sql<
      {
        symbol: string;
        quality_components: Record<string, number> | null;
        valuation_components: Record<string, number> | null;
        momentum_components: Record<string, number> | null;
      }[]
    >`
      SELECT symbol, quality_components, valuation_components, momentum_components
        FROM app.scores
       WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
         AND symbol = ANY(${symbols})
    `;
    for (const r of rows) {
      out.set(
        r.symbol,
        buildVerdict(r.quality_components, r.valuation_components, r.momentum_components),
      );
    }
  } catch {
    // Non-fatal — verdict cards fall back to "no standout metrics".
  }
  return out;
}

/** Batch-load each symbol's scorecard-driven fundamental rows. Reads the stock's
 *  cluster quality scorecard (the curated, weighted formula set that decides its
 *  score) and resolves the highest-weighted formulas to displayable glance
 *  metrics — so a bank shows loan-book/returns rows and a compounder shows RoCE,
 *  each from the same source of truth the score uses. Never throws. */
export async function loadScorecardKeys(symbols: string[]): Promise<Map<string, MetricKey[]>> {
  const out = new Map<string, MetricKey[]>();
  if (symbols.length === 0) return out;
  try {
    const rows = await sql<{ symbol: string; quality: Record<string, number> | null }[]>`
      SELECT c.symbol, a.quality
        FROM app.cluster_stocks_panel_cache c
        JOIN app.cluster_scorecard_active a ON a.cluster_id = c.cluster_id
       WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
         AND c.symbol = ANY(${symbols})
    `;
    for (const r of rows) {
      out.set(r.symbol, scorecardGlanceKeys(r.quality));
    }
  } catch {
    // Non-fatal — cards fall back to the sector-default metric set.
  }
  return out;
}
