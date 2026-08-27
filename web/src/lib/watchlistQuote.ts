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
  vol: number | null; // latest session volume (shares)
  avg_vol_30d: number | null; // ~30 trading-day average volume
  rel_vol: number | null; // latest / avg (1.0 = normal; 2.0 = 2× typical)
  turnover_cr: number | null; // latest volume × close, in ₹ crore
  delivery_pct: number | null; // most recent non-null delivery %, conviction proxy
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

/** Close (split-adjusted) as of the NEAREST trading day on-or-before a given
 *  date, per symbol. Used to self-heal watchlist rows whose close_on_add was
 *  null because golden lagged at add-time — now that golden has backfilled, we
 *  can recover the close for the original add date. Keyed by bare symbol; a
 *  symbol with no bar within a 30-day lookback simply won't appear. */
export async function loadCloseAsOf(
  pairs: { symbol: string; date: string }[],
): Promise<Map<string, { close: number; date: string }>> {
  const out = new Map<string, { close: number; date: string }>();
  const clean = pairs.filter((p) => p.symbol && p.date);
  if (clean.length === 0) return out;
  // Query both spellings (bare + .NS) so golden's index is usable regardless of
  // how the symbol is stored; each candidate carries its own as-of date.
  const syms: string[] = [];
  const asof: string[] = [];
  for (const p of clean) {
    const b = bare(p.symbol);
    syms.push(`${b}.NS`, b);
    asof.push(p.date, p.date);
  }
  try {
    const rows = await golden<{ symbol: string; c: string; d: string }[]>`
      SELECT DISTINCT ON (ph.symbol) ph.symbol,
             COALESCE(ph.adj_close, ph.close)::text AS c,
             ph.date::text AS d
        FROM unnest(${syms}::text[], ${asof}::date[]) AS q(sym, asof)
        JOIN golden.price_history ph
          ON ph.symbol = q.sym AND ph.interval = '1d'
         AND COALESCE(ph.adj_close, ph.close) IS NOT NULL
         AND ph.date <= q.asof
         AND ph.date >  q.asof - 30
       ORDER BY ph.symbol, ph.date DESC
    `;
    for (const r of rows) out.set(bare(r.symbol), { close: Number(r.c), date: r.d });
  } catch {
    // Non-fatal — unhealed rows simply keep their null close_on_add.
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
    const [last2, hilo, vols] = await Promise.all([
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
      // Volume context: latest session volume + turnover-basis close, the
      // ~30-trading-day average volume (≈45 calendar days), and the most
      // recent non-null delivery %. delivery_pct is only ~40% populated in
      // golden, so we FILTER to the latest day that actually has it.
      golden<{
        symbol: string;
        vol: string | null;
        close: string | null;
        avgvol: string | null;
        delpct: string | null;
      }[]>`
        SELECT symbol,
               (array_agg(volume ORDER BY date DESC))[1]::text AS vol,
               (array_agg(close  ORDER BY date DESC))[1]::text AS close,
               AVG(volume)::text AS avgvol,
               (array_agg(delivery_pct ORDER BY date DESC)
                  FILTER (WHERE delivery_pct IS NOT NULL))[1]::text AS delpct
        FROM golden.price_history
        WHERE interval = '1d' AND volume IS NOT NULL
          AND symbol = ANY(${cands})
          AND date >= CURRENT_DATE - 45
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
    const vol = new Map<string, number>();
    const rawClose = new Map<string, number>();
    const avgVol = new Map<string, number>();
    const delPct = new Map<string, number>();
    for (const r of vols) {
      const k = bare(r.symbol);
      if (r.vol != null) vol.set(k, Number(r.vol));
      if (r.close != null) rawClose.set(k, Number(r.close));
      if (r.avgvol != null) avgVol.set(k, Number(r.avgvol));
      if (r.delpct != null) delPct.set(k, Number(r.delpct));
    }

    for (const s of bareSyms) {
      const ltp = last.get(s) ?? null;
      const pc = prev.get(s) ?? null;
      const h = hi.get(s) ?? null;
      const l = lo.get(s) ?? null;
      const ret1d = ltp != null && pc != null && pc !== 0 ? Math.round((ltp / pc - 1) * 1000) / 10 : null;
      const fromHigh = ltp != null && h != null && h !== 0 ? Math.round((ltp / h - 1) * 1000) / 10 : null;
      const fromLow = ltp != null && l != null && l !== 0 ? Math.round((ltp / l - 1) * 1000) / 10 : null;
      const v = vol.get(s) ?? null;
      const av = avgVol.get(s) ?? null;
      const rc = rawClose.get(s) ?? null;
      const relVol = v != null && av != null && av !== 0 ? Math.round((v / av) * 100) / 100 : null;
      // Turnover uses the raw (unadjusted) close × actual shares traded — the
      // real ₹ that changed hands. 1 crore = 1e7.
      const turnoverCr = v != null && rc != null ? Math.round((v * rc) / 1e7 * 10) / 10 : null;
      out.set(s, {
        ltp,
        prev_close: pc,
        ret_1d: ret1d,
        high_52w: h,
        low_52w: l,
        from_high_pct: fromHigh,
        from_low_pct: fromLow,
        vol: v,
        avg_vol_30d: av,
        rel_vol: relVol,
        turnover_cr: turnoverCr,
        delivery_pct: delPct.get(s) ?? null,
      });
    }
  } catch {
    // Non-fatal — return whatever we built (likely empty); UI shows "—".
  }
  return out;
}
