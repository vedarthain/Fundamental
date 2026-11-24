import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { loadPersistenceForSymbols } from "@/lib/persistence";
import {
  loadPortfolioSymbols,
  loadHeldPositions,
  loadSnapshotDerivedBuys,
  loadCurrentLegBuyDates,
  type TradeMark,
} from "@/lib/portfolio";
import { loadQuotes, loadCloseAsOf, rescaleWindow } from "@/lib/watchlistQuote";
import { type GlanceMetrics, type MetricKey } from "@/lib/glance";
import { type StockVerdict } from "@/lib/explainer";
import { loadGlance, loadVerdicts, loadScorecardKeys } from "@/lib/watchlistCards";

export const MAX_WATCHLIST_SYMBOLS = 1000;

export type WatchRow = {
  symbol: string;
  company_name: string | null;
  sector_name: string | null;
  industry_name: string | null;
  maturity_tier: string;
  market_cap_category: string | null;
  listing_date: string | null;
  market_cap_cr: number | null;
  current_price: number | null;
  price_fetched_at: string | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_1y: number | null;
  ret_3y: number | null;
  ret_5y: number | null;
  ret_10y: number | null;
  ret_all: number | null;
  raw_delta: number | null;
  cluster_avg_delta: number | null;
  cluster_adjusted: number | null;
  snaps_improving: number;
  added_at: string | null;
  close_on_add: number | null;
  close_on_add_date: string | null;
  note: string | null;
  ltp: number | null;
  ret_1d: number | null;
  prev_close: number | null;
  high_52w: number | null;
  low_52w: number | null;
  from_high_pct: number | null;
  from_low_pct: number | null;
  vol: number | null;
  avg_vol_30d: number | null;
  rel_vol: number | null;
  turnover_cr: number | null;
  delivery_pct: number | null;
  ltp_date: string | null;
  stale: boolean;
  intraday_px: number | null;
  intraday_ist_date: string | null;
  eff_ltp: number | null;
  eff_ret_1d: number | null;
  eod_ltp: number | null;
  eod_ret_1d: number | null;
  px_live: boolean;
  held: boolean;
  traded: boolean;
  held_qty: number | null;
  avg_cost: number | null;
  pos_pnl_pct: number | null;
  bought_on: string | null;
  trades: TradeMark[];
  glance: GlanceMetrics | null;
  verdict: StockVerdict | null;
  glance_keys: MetricKey[];
};

type WatchMeta = {
  added_at: string | null;
  close_on_add: number | null;
  close_on_add_date: string | null;
  note: string | null;
};

async function loadRows(symbols: string[]): Promise<WatchRow[]> {
  if (symbols.length === 0) return [];
  return sql<WatchRow[]>`
    SELECT
      c.symbol,
      c.company_name,
      mc.name        AS sector_name,
      cl.name        AS industry_name,
      c.maturity_tier,
      u.market_cap_category,
      u.listing_date::text    AS listing_date,
      c.market_cap_cr::float  AS market_cap_cr,
      c.current_price::float  AS current_price,
      sm.price_fetched_at::text AS price_fetched_at,
      c.composite_pct::float  AS composite_pct,
      c.quality_pct::float    AS quality_pct,
      c.valuation_pct::float  AS valuation_pct,
      c.momentum_pct::float   AS momentum_pct,
      sm.current_price::float AS intraday_px,
      (sm.price_fetched_at AT TIME ZONE 'Asia/Kolkata')::date::text AS intraday_ist_date
    FROM app.cluster_stocks_panel_cache c
    JOIN app.cluster cl ON cl.id = c.cluster_id
    JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
    LEFT JOIN app.universe u ON u.symbol = c.symbol
    LEFT JOIN app.screener_meta sm ON sm.symbol = c.symbol
    WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND c.symbol = ANY(${symbols})

    UNION ALL

    SELECT
      u.symbol,
      u.company_name,
      mc.name        AS sector_name,
      cl.name        AS industry_name,
      COALESCE(u.maturity_tier, 'unknown') AS maturity_tier,
      u.market_cap_category,
      u.listing_date::text    AS listing_date,
      sm.market_cap_cr::float AS market_cap_cr,
      sm.current_price::float AS current_price,
      sm.price_fetched_at::text AS price_fetched_at,
      NULL::float AS composite_pct,
      NULL::float AS quality_pct,
      NULL::float AS valuation_pct,
      NULL::float AS momentum_pct,
      sm.current_price::float AS intraday_px,
      (sm.price_fetched_at AT TIME ZONE 'Asia/Kolkata')::date::text AS intraday_ist_date
    FROM app.universe u
    LEFT JOIN app.cluster_assignment ca ON ca.symbol = u.symbol
    LEFT JOIN app.cluster cl ON cl.id = ca.cluster_id
    LEFT JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
    LEFT JOIN app.screener_meta sm ON sm.symbol = u.symbol
    WHERE u.symbol = ANY(${symbols})
      AND u.is_active
      AND NOT EXISTS (
        SELECT 1 FROM app.cluster_stocks_panel_cache c2
         WHERE c2.symbol = u.symbol
           AND c2.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      )
  `;
}

async function loadMeta(
  userId: number,
  symbols: string[],
): Promise<Map<string, WatchMeta>> {
  const out = new Map<string, WatchMeta>();
  if (symbols.length === 0) return out;
  const rows = await sql<
    { symbol: string; added_at: string; close_on_add: number | null; close_on_add_date: string | null; note: string | null }[]
  >`
    SELECT symbol,
           added_at::text          AS added_at,
           close_on_add::float     AS close_on_add,
           close_on_add_date::text AS close_on_add_date,
           note
      FROM app.user_watchlist
     WHERE user_id = ${userId}
       AND symbol = ANY(${symbols})
  `;
  for (const r of rows) {
    out.set(r.symbol, {
      added_at: r.added_at,
      close_on_add: r.close_on_add,
      close_on_add_date: r.close_on_add_date,
      note: r.note,
    });
  }
  return out;
}

async function loadSnapshotDate(): Promise<string | null> {
  const rows = await sql<{ snapshot_date: string | null }[]>`
    SELECT MAX(snapshot_date)::text AS snapshot_date FROM app.cluster_stocks_panel_cache
  `;
  return rows[0]?.snapshot_date ?? null;
}

export async function loadUserWatchlistSymbols(
  userId: number,
  savedOnly = false,
): Promise<{ symbols: string[]; heldFromList: string[] | null }> {
  const wl = await sql<{ symbol: string }[]>`
    SELECT symbol FROM app.user_watchlist
     WHERE user_id = ${userId}
     ORDER BY added_at DESC
     LIMIT ${MAX_WATCHLIST_SYMBOLS}
  `;
  const base = wl.map((r) => r.symbol);
  if (savedOnly) {
    return { symbols: base, heldFromList: null };
  }
  const [held, callSyms] = await Promise.all([
    loadPortfolioSymbols(userId).catch(() => [] as string[]),
    sql<{ symbol: string }[]>`
      SELECT DISTINCT symbol FROM app.stock_call
       WHERE user_id = ${userId} AND cleared_at IS NULL
    `.catch(() => [] as { symbol: string }[]),
  ]);
  const extra = [
    ...held.map((s) => s.toUpperCase()),
    ...callSyms.map((r) => r.symbol.toUpperCase()),
  ];
  const symbols = Array.from(new Set([...base, ...extra])).slice(0, MAX_WATCHLIST_SYMBOLS);
  return { symbols, heldFromList: held };
}

export async function loadWatchlistData(opts: {
  symbols: string[];
  userId: number | null;
  lean?: boolean;
  heldFromList?: string[] | null;
}): Promise<{ rows: WatchRow[]; snapshot_date: string | null }> {
  const { symbols, userId, lean = false, heldFromList = null } = opts;
  if (symbols.length === 0) {
    return { rows: [], snapshot_date: await loadSnapshotDate().catch(() => null) };
  }

  const sessionP = userId
    ? Promise.all([
        heldFromList != null
          ? Promise.resolve(heldFromList)
          : loadPortfolioSymbols(userId).catch(() => [] as string[]),
        sql<{ symbol: string; d: string; side: string; price: number; qty: number }[]>`
          SELECT symbol,
                 trade_date::text AS d,
                 side,
                 (SUM(price * quantity) / NULLIF(SUM(quantity), 0))::float8 AS price,
                 SUM(quantity)::float8 AS qty
            FROM app.portfolio_transaction
           WHERE user_id = ${userId} AND symbol IS NOT NULL
           GROUP BY symbol, trade_date, side
           ORDER BY symbol, trade_date
        `.catch(() => [] as { symbol: string; d: string; side: string; price: number; qty: number }[]),
        loadHeldPositions(userId).catch(() => ({}) as Record<string, { qty: number; avgCost: number | null }>),
        loadCurrentLegBuyDates(userId).catch(() => ({}) as Record<string, string>),
      ])
    : Promise.resolve(null);

  const sortedKey = [...symbols].sort().join(",");
  const cachedRows = unstable_cache(
    async (syms: string[]) => loadRows(syms),
    ["watchlist:rows:v1", sortedKey],
    { revalidate: 300, tags: ["panel-cache", "watchlist-data"] },
  );
  const cachedSnapDate = unstable_cache(
    () => loadSnapshotDate(),
    ["watchlist:snapdate:v1"],
    { revalidate: 3600, tags: ["panel-cache"] },
  );
  const cachedPersistence = unstable_cache(
    async (syms: string[]) => Array.from((await loadPersistenceForSymbols(syms)).entries()),
    ["watchlist:persistence:v1", sortedKey],
    { revalidate: 3600, tags: ["panel-cache"] },
  );

  const [rows, snapshotDate, persistenceEntries, quotes, meta, glance, verdicts, scorecardKeys, sessionData] = await Promise.all([
    cachedRows(symbols),
    cachedSnapDate(),
    cachedPersistence(symbols),
    loadQuotes(symbols, lean),
    userId ? loadMeta(userId, symbols) : Promise.resolve(new Map<string, WatchMeta>()),
    lean ? Promise.resolve(new Map<string, GlanceMetrics>()) : loadGlance(symbols),
    lean ? Promise.resolve(new Map<string, StockVerdict>()) : loadVerdicts(symbols),
    lean ? Promise.resolve(new Map<string, MetricKey[]>()) : loadScorecardKeys(symbols),
    sessionP,
  ]);
  const persistence = new Map(persistenceEntries);

  let heldSet = new Set<string>();
  const tradedSet = new Set<string>();
  let positions: Record<string, { qty: number; avgCost: number | null }> = {};
  const tradesBySym: Record<string, TradeMark[]> = {};
  const boughtOn = new Map<string, string>();
  if (sessionData) {
    const [held, txRows, posMap, legStart] = sessionData;
    heldSet = new Set(held.map((s) => s.toUpperCase()));
    positions = posMap;
    for (const t of txRows) {
      const key = t.symbol.toUpperCase();
      if (t.side === "buy") {
        tradedSet.add(key);
        const cur = boughtOn.get(key);
        if (!cur || t.d < cur) boughtOn.set(key, t.d);
      }
      (tradesBySym[key] ??= []).push({
        d: t.d,
        side: t.side === "sell" ? "S" : "B",
        price: t.price,
        qty: t.qty,
      });
    }
    const snapNeeded: string[] = [];
    for (const [key, p] of Object.entries(posMap)) {
      if (tradesBySym[key]?.length) continue;
      const d = legStart[key];
      if (!d || p.avgCost == null) {
        snapNeeded.push(key);
        continue;
      }
      tradesBySym[key] = [{ d, side: "B", price: p.avgCost, qty: p.qty }];
    }
    const watchSet = new Set(symbols.map((s) => s.toUpperCase()));
    const snapScope = snapNeeded.filter((k) => watchSet.has(k));
    if (snapScope.length > 0) {
      const derived = await loadSnapshotDerivedBuys(userId!, snapScope).catch(
        () => ({}) as Record<string, TradeMark[]>,
      );
      for (const [key, marks] of Object.entries(derived)) {
        if (!tradesBySym[key]) tradesBySym[key] = marks;
      }
    }
  }

  if (userId) {
    const needsHeal = [...meta.entries()]
      .filter(([, m]) => m.close_on_add == null && m.added_at)
      .map(([symbol, m]) => ({ symbol, date: (m.added_at as string).slice(0, 10) }));
    if (needsHeal.length > 0) {
      void (async () => {
        try {
          const healed = await loadCloseAsOf(needsHeal);
          const upSyms: string[] = [];
          const upCloses: number[] = [];
          const upDates: string[] = [];
          for (const { symbol } of needsHeal) {
            const h = healed.get(symbol);
            if (!h) continue;
            upSyms.push(symbol);
            upCloses.push(h.close);
            upDates.push(h.date);
          }
          if (upSyms.length > 0) {
            await sql`
              UPDATE app.user_watchlist AS w
                 SET close_on_add = v.cl, close_on_add_date = v.dt
                FROM unnest(${upSyms}::text[], ${upCloses}::numeric[], ${upDates}::date[])
                     AS v(sym, cl, dt)
               WHERE w.user_id = ${userId} AND w.symbol = v.sym
                 AND w.close_on_add IS NULL
            `.catch(() => {});
          }
        } catch {}
      })();
    }
  }

  for (const row of rows) {
    const p = persistence.get(row.symbol);
    row.raw_delta         = p?.raw_delta         ?? null;
    row.cluster_avg_delta = p?.cluster_avg_delta ?? null;
    row.cluster_adjusted  = p?.cluster_adjusted  ?? null;
    row.snaps_improving   = p?.snaps_improving   ?? 0;

    const q = quotes.get(row.symbol);
    row.ltp           = q?.ltp           ?? null;
    row.ret_1d        = q?.ret_1d        ?? null;
    row.prev_close    = q?.prev_close    ?? null;
    const asFrac = (val: number | null | undefined) => (val == null ? null : val / 100);
    row.ret_1w        = asFrac(q?.ret_1w);
    row.ret_1m        = asFrac(q?.ret_1m);
    row.ret_3m        = asFrac(q?.ret_3m);
    row.ret_1y        = asFrac(q?.ret_1y);
    row.ret_3y        = asFrac(q?.ret_3y);
    row.ret_5y        = asFrac(q?.ret_5y);
    row.ret_10y       = asFrac(q?.ret_10y);
    row.ret_all       = asFrac(q?.ret_all);
    row.high_52w      = q?.high_52w      ?? null;
    row.low_52w       = q?.low_52w       ?? null;
    row.from_high_pct = q?.from_high_pct ?? null;
    row.from_low_pct  = q?.from_low_pct  ?? null;
    row.vol           = q?.vol           ?? null;
    row.avg_vol_30d   = q?.avg_vol_30d   ?? null;
    row.rel_vol       = q?.rel_vol       ?? null;
    row.turnover_cr   = q?.turnover_cr   ?? null;
    row.delivery_pct  = q?.delivery_pct  ?? null;
    row.ltp_date      = q?.ltp_date      ?? null;
    row.stale         = q?.stale         ?? false;

    const tick = row.intraday_px;
    const useTick =
      tick != null && tick > 0 &&
      row.intraday_ist_date != null &&
      (row.ltp_date == null || row.intraday_ist_date > row.ltp_date);
    row.eod_ltp = row.ltp;
    row.eod_ret_1d = row.ret_1d;
    if (useTick) {
      row.ret_1d =
        row.eod_ltp != null && row.eod_ltp !== 0
          ? Math.round((tick / row.eod_ltp - 1) * 1000) / 10
          : null;
      row.prev_close = row.eod_ltp;
      row.ret_1w = rescaleWindow(row.ret_1w, row.eod_ltp, tick, 1);
      row.ret_1m = rescaleWindow(row.ret_1m, row.eod_ltp, tick, 1);
      row.ret_1y = rescaleWindow(row.ret_1y, row.eod_ltp, tick, 1);
      row.ltp = tick;
      row.ltp_date = row.intraday_ist_date;
      row.stale = false;
    }
    row.px_live = useTick;
    row.eff_ltp = row.ltp;
    row.eff_ret_1d = row.ret_1d;

    row.held          = heldSet.has(row.symbol);
    row.traded        = row.held || tradedSet.has(row.symbol);
    row.bought_on     = boughtOn.get(row.symbol) ?? null;
    row.trades        = tradesBySym[row.symbol] ?? [];
    const posn        = positions[row.symbol];
    row.held_qty      = posn ? posn.qty : null;
    row.avg_cost      = posn ? posn.avgCost : null;
    row.pos_pnl_pct   =
      posn && posn.avgCost != null && posn.avgCost > 0 && row.ltp != null
        ? Math.round(((row.ltp - posn.avgCost) / posn.avgCost) * 1000) / 10
        : null;

    const m = meta.get(row.symbol);
    row.added_at          = m?.added_at          ?? null;
    row.close_on_add      = m?.close_on_add      ?? null;
    row.close_on_add_date = m?.close_on_add_date ?? null;
    row.note              = m?.note              ?? null;

    if (lean) {
      const bag = row as unknown as Record<string, unknown>;
      delete bag.glance;
      delete bag.verdict;
      delete bag.glance_keys;
    } else {
      row.glance = glance.get(row.symbol) ?? null;
      row.verdict = verdicts.get(row.symbol) ?? null;
      row.glance_keys = scorecardKeys.get(row.symbol) ?? [];
    }
  }

  return { rows, snapshot_date: snapshotDate };
}
