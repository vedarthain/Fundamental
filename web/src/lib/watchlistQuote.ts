/**
 * watchlistQuote.ts — live-ish price context for watchlist rows, from golden.
 *
 * The panel cache (app.cluster_stocks_panel_cache) carries a WEEKLY snapshot
 * price and scores. The watchlist wants a fresher read: the latest daily close
 * (LTP), the prior close (for a 1-day % move), and the 52-week high/low so the
 * row can show how far the stock sits below its high / above its low.
 *
 * All prices are split-adjusted (COALESCE(adj_close, close)) so they agree with
 * the stock-page chart and the All-stocks table. The 52W high/low are computed
 * from the adjusted-close series (not intraday high/low), which is split-safe
 * and consistent with LTP — a pre-split intraday high would otherwise dwarf the
 * adjusted price and read as a nonsense "down 95% from high".
 *
 * golden symbols carry a ".NS" suffix; watchlist symbols are bare. We query for
 * both spellings so the index is used, then key the result by the bare symbol.
 */
import { golden } from "@/lib/db";

export type Quote = {
  ltp: number | null; // latest adjusted close
  prev_close: number | null; // prior session's adjusted close
  ret_1d: number | null; // percent, last vs prev
  high_52w: number | null;
  low_52w: number | null;
  from_high_pct: number | null; // signed %: (ltp/high - 1)*100, ≤0
  from_low_pct: number | null; // signed %: (ltp/low - 1)*100, ≥0
};

function bare(sym: string): string {
  return sym.endsWith(".NS") ? sym.slice(0, -3) : sym;
}

/** Latest close + its trading date per symbol — captured at add-time so the
 *  watchlist can show "closed at ₹X on <date> when you added it". Keyed by bare
 *  symbol. Never throws; missing symbols simply won't appear in the map. */
export async function loadCloseOnAdd(
  symbols: string[],
): Promise<Map<string, { close: number; date: string }>> {
  const out = new Map<string, { close: number; date: string }>();
  const bareSyms = Array.from(new Set(symbols.map(bare))).filter(Boolean);
  if (bareSyms.length === 0) return out;
  const cands = [...bareSyms, ...bareSyms.map((s) => `${s}.NS`)];
  try {
    const rows = await golden<{ symbol: string; c: string; d: string }[]>`
      SELECT DISTINCT ON (symbol) symbol,
             COALESCE(adj_close, close)::text AS c,
             date::text AS d
      FROM golden.price_history
      WHERE interval = '1d' AND COALESCE(adj_close, close) IS NOT NULL
        AND symbol = ANY(${cands})
        AND date >= CURRENT_DATE - 16
      ORDER BY symbol, date DESC
    `;
    for (const r of rows) out.set(bare(r.symbol), { close: Number(r.c), date: r.d });
  } catch {
    // Non-fatal — the row just gets a null close_on_add.
  }
  return out;
}

/** Load quote context for a set of bare NSE symbols. Never throws — a golden
 *  hiccup yields an empty map and the UI renders "—". */
export async function loadQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  const bareSyms = Array.from(new Set(symbols.map(bare))).filter(Boolean);
  if (bareSyms.length === 0) return out;
  // Query both spellings so golden's index is usable regardless of suffix.
  const cands = [...bareSyms, ...bareSyms.map((s) => `${s}.NS`)];

  try {
    const [last2, hilo] = await Promise.all([
      golden<{ symbol: string; c: string; rn: string }[]>`
        SELECT symbol, c, rn FROM (
          SELECT symbol, COALESCE(adj_close, close)::text AS c,
                 row_number() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
          FROM golden.price_history
          WHERE interval = '1d' AND COALESCE(adj_close, close) IS NOT NULL
            AND symbol = ANY(${cands})
            AND date >= CURRENT_DATE - 16
        ) t WHERE rn <= 2
      `,
      golden<{ symbol: string; hi: string; lo: string }[]>`
        SELECT symbol,
               MAX(COALESCE(adj_close, close))::text AS hi,
               MIN(COALESCE(adj_close, close))::text AS lo
        FROM golden.price_history
        WHERE interval = '1d' AND COALESCE(adj_close, close) IS NOT NULL
          AND symbol = ANY(${cands})
          AND date >= CURRENT_DATE - 365
        GROUP BY symbol
      `,
    ]);

    const last = new Map<string, number>();
    const prev = new Map<string, number>();
    for (const r of last2) {
      const k = bare(r.symbol);
      if (Number(r.rn) === 1) last.set(k, Number(r.c));
      else prev.set(k, Number(r.c));
    }
    const hi = new Map<string, number>();
    const lo = new Map<string, number>();
    for (const r of hilo) {
      hi.set(bare(r.symbol), Number(r.hi));
      lo.set(bare(r.symbol), Number(r.lo));
    }

    for (const s of bareSyms) {
      const ltp = last.get(s) ?? null;
      const pc = prev.get(s) ?? null;
      const h = hi.get(s) ?? null;
      const l = lo.get(s) ?? null;
      const ret1d = ltp != null && pc != null && pc !== 0 ? Math.round((ltp / pc - 1) * 1000) / 10 : null;
      const fromHigh = ltp != null && h != null && h !== 0 ? Math.round((ltp / h - 1) * 1000) / 10 : null;
      const fromLow = ltp != null && l != null && l !== 0 ? Math.round((ltp / l - 1) * 1000) / 10 : null;
      out.set(s, {
        ltp,
        prev_close: pc,
        ret_1d: ret1d,
        high_52w: h,
        low_52w: l,
        from_high_pct: fromHigh,
        from_low_pct: fromLow,
      });
    }
  } catch {
    // Non-fatal — return whatever we built (likely empty); UI shows "—".
  }
  return out;
}
