/**
 * Portfolio read model — holdings → live valuation + per-instrument rollup.
 *
 * Nothing is stored valued: `app.portfolio_holding` keeps raw broker rows and
 * we DERIVE current value, day change and Q/V/M/rank overlays at read time
 * (0041_portfolio.sql). Two pricing paths:
 *
 *   • mapped equities (in our scoring universe) → re-priced from golden's
 *     latest close, with Q/V/M/rank/returns from the cache snapshot.
 *   • unmapped instruments (ETFs, gold/silver, AMC index funds) → carried at
 *     the broker's own price/value captured at import ("outside coverage").
 *
 * "Club everything per instrument": holdings of the same instrument across
 * brokers are aggregated into one line (quantity summed, blended avg cost),
 * with a per-broker breakdown kept for drill-down.
 */
import "server-only";
import { sql, golden } from "@/lib/db";
import { BROKER_LABEL, bareSymbol, type Broker } from "@/lib/portfolioImport";

export type BrokerLot = {
  broker: Broker;
  brokerLabel: string;
  quantity: number;
  avgCost: number | null;
};

export type Instrument = {
  key: string;
  symbol: string | null; // universe symbol when mapped
  name: string;
  isMapped: boolean;
  derived: boolean; // computed from trades (no broker snapshot) — "may be incomplete"
  quantity: number;
  avgCost: number | null; // blended
  invested: number;
  price: number | null; // per-share current
  currentValue: number;
  pnl: number;
  pnlPct: number | null;
  // ── Portfolio discipline overlays (rules, not market data) ──
  targetPrice: number | null; // avgCost × 1.25 (+25% profit target)
  targetHit: boolean; // live price ≥ targetPrice
  firstImported: string | null; // MIN(imported_at) across broker lots (ISO)
  monthsHeld: number | null; // months since firstImported (import-date proxy)
  overHoldLimit: boolean; // monthsHeld ≥ 4
  dayChangePct: number | null;
  dayChangeValue: number | null;
  sector: string | null;
  industry: string | null;
  category: string | null;
  q: number | null;
  v: number | null;
  m: number | null;
  composite: number | null;
  peerRank: number | null;
  peerCount: number | null;
  ret1w: number | null;
  ret1m: number | null;
  ret1y: number | null;
  brokers: BrokerLot[];
};

export type AllocSlice = { label: string; value: number };

export type Portfolio = {
  hasHoldings: boolean;
  instruments: Instrument[];
  totals: {
    invested: number;
    currentValue: number;
    pnl: number;
    pnlPct: number | null;
    dayChangeValue: number;
    dayChangePct: number | null;
    mappedValue: number;
    unmappedValue: number;
    holdingCount: number;
    mappedCount: number;
  };
  brokerAlloc: AllocSlice[];
  sectorAlloc: AllocSlice[];
  snapshotDate: string | null;
  brokers: Broker[]; // which brokers the user has imported
};

type HoldingRow = {
  broker: Broker;
  raw_symbol: string;
  isin: string | null;
  symbol: string | null;
  is_mapped: boolean;
  quantity: string; // numeric → string
  avg_cost: string | null;
  broker_ltp: string | null;
  broker_cur_value: string | null;
  broker_day_pct: string | null;
  imported_at: string | null;
};

type CacheRow = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  industry: string | null;
  maturity_tier: string | null;
  current_price: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  composite_pct: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
  peer_rank: number | null;
  peer_count: number | null;
};

const TIER_MAP: Record<string, string> = {
  veteran: "Long established",
  mature: "Established",
  mid: "Emerging",
  new: "Emerging",
};

export type CurvePoint = {
  date: string;
  value: number; // portfolio total value that day
  portfolioIdx: number; // normalised to 100 at the first snapshot
  niftyIdx: number | null; // NIFTY 500 normalised to 100 at the first snapshot
};

/**
 * Forward-only equity curve for the signed-in user + a NIFTY 500 overlay,
 * both rebased to 100 at the first snapshot. `portfolio_snapshot` accrues one
 * row per user per day from onboarding onward (the daily cron), so an equity
 * curve simply doesn't exist before the first snapshot — the UI shows an
 * "accruing from <date>" note in that case.
 */
export async function loadEquityCurve(userId: number): Promise<CurvePoint[]> {
  const snaps = await sql<{ snap_date: string; total_value: string | null }[]>`
    SELECT snap_date::text, total_value::text
      FROM app.portfolio_snapshot
     WHERE user_id = ${userId} AND total_value IS NOT NULL
     ORDER BY snap_date ASC
  `;
  if (snaps.length === 0) return [];

  const first = snaps[0].snap_date;
  const nifty = await sql<{ date: string; close: string }[]>`
    SELECT date::text, close::text
      FROM app.market_index_history
     WHERE index_code = 'NIFTY500' AND date >= ${first}
     ORDER BY date ASC
  `;
  // nearest-on-or-before NIFTY close for each snapshot date.
  const niftyByDate = nifty.map((r) => ({ date: r.date, close: Number(r.close) }));
  const niftyAt = (d: string): number | null => {
    let val: number | null = null;
    for (const r of niftyByDate) {
      if (r.date <= d) val = r.close;
      else break;
    }
    return val;
  };

  const baseVal = Number(snaps[0].total_value);
  const baseNifty = niftyAt(first);
  return snaps.map((s) => {
    const v = Number(s.total_value);
    const n = niftyAt(s.snap_date);
    return {
      date: s.snap_date,
      value: Math.round(v * 100) / 100,
      portfolioIdx: baseVal > 0 ? Math.round((v / baseVal) * 1000) / 10 : 100,
      niftyIdx: n != null && baseNifty ? Math.round((n / baseNifty) * 1000) / 10 : null,
    };
  });
}

// ── time-weighted performance model ─────────────────────────────────────────
//
// A trustworthy return figure must ignore BOTH the money you add/remove AND any
// structural revaluation of the book (a holding getting re-mapped or re-priced
// between snapshots). Naively differencing `total_value` fails on both counts —
// it treats a fresh buy or a pricing correction as "return".
//
// The snapshot already stores the clean signal: `day_change_value`, the sum of
// each held position's genuine 1-day market move (day-change% × value). That is
// flow-neutral (a new buy contributes only its intraday move, never its cost)
// and revaluation-neutral (a total_value jump with no market move carries a
// ~zero day-change). So we chain daily returns straight off it:
//
//     r_t = day_change_value_t / total_value_{t-1}
//     TWR = Π(1 + r_t) − 1
//
// A TWR index (base 100) accumulates so drawdown/vol are measured on RETURN, not
// raw value. NIFTY 500 over the exact same window gives the only comparison that
// matters — alpha.
//
// HARD LIMIT: `portfolio_snapshot` is forward-only from onboarding, so TWR spans
// only from the first snapshot — NOT your full trade history. Reconstructing
// pre-onboarding value needs a transaction replay against historical prices
// (separate job). Everything here is honestly labelled "since <firstSnapshot>".
export type PerformanceStats = {
  startDate: string;
  endDate: string;
  points: number;        // number of snapshots in the series
  twrPct: number;        // time-weighted return over the window, %
  niftyPct: number | null; // NIFTY 500 total return over the same window, %
  alphaPct: number | null; // twr − nifty
  maxDrawdownPct: number;  // worst peak-to-trough on the TWR index (≤ 0)
  volPct: number | null;   // annualised stdev of daily TWR (×√252), %
  bestDayPct: number;
  worstDayPct: number;
  index: { date: string; twrIdx: number; niftyIdx: number | null }[];
};

export async function loadPerformanceStats(userId: number): Promise<PerformanceStats | null> {
  const snaps = await sql<{ snap_date: string; total_value: string | null; day_change_value: string | null }[]>`
    SELECT snap_date::text, total_value::text, day_change_value::text
      FROM app.portfolio_snapshot
     WHERE user_id = ${userId} AND total_value IS NOT NULL
     ORDER BY snap_date ASC
  `;
  if (snaps.length < 2) return null;
  const first = snaps[0].snap_date;

  // NIFTY 500 closes over the window (nearest-on-or-before per snapshot date).
  const nifty = await sql<{ date: string; close: string }[]>`
    SELECT date::text, close::text
      FROM app.market_index_history
     WHERE index_code = 'NIFTY500' AND date >= ${first}
     ORDER BY date ASC
  `;
  const niftyByDate = nifty.map((r) => ({ date: r.date, close: Number(r.close) }));
  const niftyAt = (d: string): number | null => {
    let val: number | null = null;
    for (const r of niftyByDate) {
      if (r.date <= d) val = r.close;
      else break;
    }
    return val;
  };
  const baseNifty = niftyAt(first);

  // Chain daily time-weighted sub-returns off the clean per-holding market move.
  const dailyReturns: number[] = [];
  let twrIdx = 100;
  let peak = 100;
  let maxDrawdown = 0;
  const index: PerformanceStats["index"] = [
    { date: first, twrIdx: 100, niftyIdx: baseNifty ? 100 : null },
  ];

  for (let i = 1; i < snaps.length; i++) {
    const vPrev = Number(snaps[i - 1].total_value);
    const dcv = Number(snaps[i].day_change_value ?? 0);
    // r_t = today's market move ÷ yesterday's value. Flow- and revaluation-neutral.
    const r = vPrev > 0 && Number.isFinite(dcv) ? dcv / vPrev : 0;
    dailyReturns.push(r);
    twrIdx *= 1 + r;
    if (twrIdx > peak) peak = twrIdx;
    const dd = twrIdx / peak - 1;
    if (dd < maxDrawdown) maxDrawdown = dd;
    const n = niftyAt(snaps[i].snap_date);
    index.push({
      date: snaps[i].snap_date,
      twrIdx: Math.round(twrIdx * 100) / 100,
      niftyIdx: n != null && baseNifty ? Math.round((n / baseNifty) * 10000) / 100 : null,
    });
  }

  const twrPct = twrIdx - 100; // base-100 index → % return
  const endNifty = niftyAt(snaps[snaps.length - 1].snap_date);
  const niftyPct = endNifty != null && baseNifty ? (endNifty / baseNifty - 1) * 100 : null;

  // Annualised volatility of daily TWR (×√252). Needs ≥ 2 returns.
  let volPct: number | null = null;
  if (dailyReturns.length >= 2) {
    const mean = dailyReturns.reduce((s, x) => s + x, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / (dailyReturns.length - 1);
    volPct = Math.sqrt(variance) * Math.sqrt(252) * 100;
  }

  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    startDate: first,
    endDate: snaps[snaps.length - 1].snap_date,
    points: snaps.length,
    twrPct: r1(twrPct),
    niftyPct: niftyPct != null ? r1(niftyPct) : null,
    alphaPct: niftyPct != null ? r1(twrPct - niftyPct) : null,
    maxDrawdownPct: r1(maxDrawdown * 100),
    volPct: volPct != null ? r1(volPct) : null,
    bestDayPct: dailyReturns.length ? r1(Math.max(...dailyReturns) * 100) : 0,
    worstDayPct: dailyReturns.length ? r1(Math.min(...dailyReturns) * 100) : 0,
    index,
  };
}

function num(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
/** cache returns stored as fractions (0.339 = +33.9%) → percent, 1 dp */
function pctx(x: unknown): number | null {
  const n = num(x);
  return n == null ? null : Math.round(n * 1000) / 10;
}

/**
 * Just the mapped universe symbols a user holds — a cheap membership lookup for
 * "is this stock in my portfolio?" badges. Skips all valuation work.
 */
export async function loadPortfolioSymbols(userId: number): Promise<string[]> {
  // A symbol with hand-entered trades is represented only by its reconciled
  // 'derived' row (snapshot opening + manual trades); its raw snapshot rows are
  // suppressed (see loadPortfolio). So it counts as held iff the derived row
  // survived — i.e. it isn't fully exited. Mirror that here for the graph badge.
  const rows = await sql<{ symbol: string }[]>`
    SELECT DISTINCT h.symbol
      FROM app.portfolio_holding h
     WHERE h.user_id = ${userId} AND h.symbol IS NOT NULL
       AND (h.broker = 'derived'
            OR h.symbol NOT IN (
              SELECT symbol FROM app.portfolio_transaction
               WHERE user_id = ${userId} AND source_file = 'manual-entry'
                 AND symbol IS NOT NULL))
  `;
  return rows.map((r) => r.symbol);
}

/**
 * Held quantity per symbol for the Graph tab's "P · N sh" badge. Uses the SAME
 * reconciliation rule as loadPortfolioSymbols: a symbol with hand-entered trades
 * is represented only by its 'derived' row (snapshot opening + manual trades),
 * so its raw broker rows are suppressed to avoid double-counting; a snapshot-only
 * symbol sums its raw broker lots. This is broker-truth (what you actually hold),
 * NOT a net of the incomplete trade log.
 */
export async function loadPortfolioHeldQty(userId: number): Promise<Record<string, number>> {
  const rows = await sql<{ symbol: string; qty: number }[]>`
    SELECT h.symbol, SUM(h.quantity)::float8 AS qty
      FROM app.portfolio_holding h
     WHERE h.user_id = ${userId} AND h.symbol IS NOT NULL AND h.quantity > 0
       AND (h.broker = 'derived'
            OR h.symbol NOT IN (
              SELECT symbol FROM app.portfolio_transaction
               WHERE user_id = ${userId} AND source_file = 'manual-entry'
                 AND symbol IS NOT NULL))
     GROUP BY h.symbol
  `;
  const out: Record<string, number> = {};
  for (const r of rows) if (r.qty > 0) out[r.symbol] = Math.round(r.qty);
  return out;
}

/** One executed-trade marker for the chart tabs: buy/sell aggregated per
 *  (symbol, date, side), qty summed and price qty-weighted. `derived` flags a
 *  SYNTHETIC buy inferred from a broker snapshot that has no trade log — its
 *  date is approximated (the historical bar whose price is nearest the avg cost),
 *  so the chart renders it faintly and labels it "≈" to signal it's a guess. */
export type TradeMark = { d: string; side: "B" | "S"; price: number; qty: number; derived?: boolean };

/**
 * Real executed trades (app.portfolio_transaction) for the Graph/Themes B/S
 * markers, plus the set of symbols ever traded (drives the grey "P" state for
 * names bought-but-not-currently-held). Small per-user payload (~600 rows),
 * loaded server-side and passed straight to the client — no API/hook needed.
 */
export async function loadPortfolioTrades(
  userId: number,
): Promise<{ tradedSymbols: string[]; tradesBySymbol: Record<string, TradeMark[]> }> {
  const rows = await sql<
    { symbol: string; d: string; side: string; qty: number; price: number }[]
  >`
    SELECT symbol,
           trade_date::text AS d,
           side,
           SUM(quantity)::float8 AS qty,
           (SUM(price * quantity) / NULLIF(SUM(quantity), 0))::float8 AS price
      FROM app.portfolio_transaction
     WHERE user_id = ${userId} AND symbol IS NOT NULL
     GROUP BY symbol, trade_date, side
     ORDER BY symbol, trade_date
  `;
  // ── Split/bonus reconciliation ─────────────────────────────────────────────
  // Trades are stored RAW (as executed at the broker); golden's price_history is
  // (usually) split/bonus-ADJUSTED. Left unreconciled, a post-trade corporate
  // action makes the B/S marker label + cost basis read ~Nx the chart — e.g.
  // ECLERX's 1:1 bonus (2026-03-13) rendered an Oct-2025 buy at ₹3,970 against
  // candles near ₹1,960. We scale a trade's price by the cumulative split_factor
  // for ex-dates AFTER it, landing it in the candles' space. Quantity is left as
  // entered: avgBuyPrice weights by qty, so scaling price alone yields the correct
  // adjusted average.
  //
  // But golden's own adjustment is NOT uniform: some names (CUB, RPOWER) carry a
  // corporate_actions row that price_history never applied (a visible cliff), or a
  // spurious auto-detected one. Trusting the table blindly would over-correct those.
  // So we self-correct: golden's close ON THE TRADE DATE is the arbiter — we keep
  // whichever of {raw, raw×factor} sits closer to it. Adjusted wins where golden is
  // back-adjusted; raw wins where it isn't. This makes an inconsistent table a
  // no-op rather than a new bug.
  const caBySym = new Map<string, { ex: string; f: number }[]>();
  const cumFactor = (sym: string, date: string): number => {
    const acts = caBySym.get(sym.toUpperCase());
    if (!acts) return 1;
    let f = 1;
    for (const a of acts) if (a.ex > date) f *= a.f;
    return f;
  };
  const loadActions = async (symbols: string[]): Promise<void> => {
    const want = symbols.filter((s) => !caBySym.has(s.toUpperCase()));
    if (want.length === 0) return;
    const ns = want.map((s) => `${s.toUpperCase()}.NS`);
    // Pre-seed so symbols with no actions still count as "loaded" (skip re-query).
    for (const s of want) caBySym.set(s.toUpperCase(), caBySym.get(s.toUpperCase()) ?? []);
    const actions = await golden<{ symbol: string; ex: string; f: number }[]>`
      SELECT symbol, ex_date::text AS ex, split_factor::float8 AS f
        FROM golden.corporate_actions
       WHERE symbol = ANY(${ns}) AND split_factor > 0
    `.catch(() => [] as { symbol: string; ex: string; f: number }[]);
    for (const a of actions) {
      const bare = a.symbol.replace(/\.NS$/, "").toUpperCase();
      (caBySym.get(bare) ?? []).push({ ex: a.ex, f: a.f });
    }
  };

  // golden's on/before-date close per (symbol, date) — the reconciliation arbiter.
  // Only fetched for trades that actually have a corporate action (factor ≠ 1).
  const closeByKey = new Map<string, number>();
  const loadCloses = async (pairs: { sym: string; date: string }[]): Promise<void> => {
    const need = pairs.filter((p) => !closeByKey.has(`${p.sym.toUpperCase()}|${p.date}`));
    if (need.length === 0) return;
    const ns = need.map((p) => `${p.sym.toUpperCase()}.NS`);
    const ds = need.map((p) => p.date);
    const found = await golden<{ ns: string; td: string; close: number }[]>`
      WITH pairs AS (
        SELECT DISTINCT ns_sym, td FROM unnest(${ns}::text[], ${ds}::date[]) AS u(ns_sym, td)
      )
      SELECT DISTINCT ON (p.ns_sym, p.td)
             p.ns_sym AS ns, p.td::text AS td, ph.close::float8 AS close
        FROM pairs p
        JOIN golden.price_history ph
          ON ph.symbol = p.ns_sym AND ph.interval = '1d' AND ph.date <= p.td
       ORDER BY p.ns_sym, p.td, ph.date DESC
    `.catch(() => [] as { ns: string; td: string; close: number }[]);
    for (const r of found) {
      const bare = r.ns.replace(/\.NS$/, "").toUpperCase();
      closeByKey.set(`${bare}|${r.td}`, r.close);
    }
  };

  // Reconcile a raw price to golden's space, arbitrated by golden's own close.
  const reconcile = (sym: string, date: string, raw: number): number => {
    const f = cumFactor(sym, date);
    if (f === 1) return raw;
    const g = closeByKey.get(`${sym.toUpperCase()}|${date}`);
    if (g == null || !(g > 0)) return raw * f; // no reference → trust the actions table
    return Math.abs((raw * f) / g - 1) < Math.abs(raw / g - 1) ? raw * f : raw;
  };

  await loadActions(Array.from(new Set(rows.map((r) => r.symbol))));
  await loadCloses(
    rows.filter((r) => cumFactor(r.symbol, r.d) !== 1).map((r) => ({ sym: r.symbol, date: r.d })),
  );

  const tradesBySymbol: Record<string, TradeMark[]> = {};
  for (const r of rows) {
    (tradesBySymbol[r.symbol] ??= []).push({
      d: r.d,
      side: r.side === "sell" ? "S" : "B",
      price: reconcile(r.symbol, r.d, r.price),
      qty: Math.round(r.qty),
    });
  }

  // ── Synthetic buys for snapshot-only holdings ──────────────────────────────
  // A broker snapshot tells us WHAT is held, not WHEN it was bought — so a
  // snapshotted stock with no trade log gets a "P" badge but no B/S marker. To
  // guarantee every held name shows an entry point, we synthesise one buy: the
  // historical bar (on or before import) whose split-adjusted price is nearest
  // the avg cost. Approximate by construction (flagged `derived`); a real BUY,
  // once entered, supersedes it. We exclude a symbol only when the log actually
  // carries a buy — a windowed broker export can contain sells-only (e.g. a
  // Groww order-history slice), which would otherwise leave a held position with
  // an "S" marker but no entry point at all. Sells-only ⇒ still synthesise.
  const snapOnly = await sql<{ symbol: string; qty: number; avg: number; imp: string }[]>`
    SELECT h.symbol,
           SUM(h.quantity)::float8                                   AS qty,
           (SUM(h.avg_cost * h.quantity) / NULLIF(SUM(h.quantity), 0))::float8 AS avg,
           COALESCE(MIN(h.imported_at), CURRENT_DATE)::text          AS imp
      FROM app.portfolio_holding h
     WHERE h.user_id = ${userId} AND h.broker <> 'derived'
       AND h.symbol IS NOT NULL AND h.quantity > 0 AND h.avg_cost IS NOT NULL
       AND h.symbol NOT IN (
         SELECT DISTINCT symbol FROM app.portfolio_transaction
          WHERE user_id = ${userId} AND symbol IS NOT NULL AND side = 'buy'
       )
     GROUP BY h.symbol
  `;
  if (snapOnly.length > 0) {
    await loadActions(snapOnly.map((s) => s.symbol));
    // Broker snapshots already reflect corporate actions up to the import date;
    // golden is adjusted to today. Reconcile the residual — actions with an ex-date
    // AFTER import — arbitrated (like trades) by golden's close on the import date,
    // so the synthetic buy lands on the right candle even when golden is unadjusted.
    await loadCloses(
      snapOnly
        .filter((s) => cumFactor(s.symbol, s.imp.slice(0, 10)) !== 1)
        .map((s) => ({ sym: s.symbol, date: s.imp.slice(0, 10) })),
    );
    const snapAdj = (s: { symbol: string; imp: string; avg: number }) =>
      reconcile(s.symbol, s.imp.slice(0, 10), s.avg);
    const nsSyms = snapOnly.map((s) => `${s.symbol.toUpperCase()}.NS`);
    const targets = snapOnly.map((s) => snapAdj(s));
    const imps = snapOnly.map((s) => s.imp);
    // One batched golden query: DISTINCT ON picks, per symbol, the on/before-import
    // bar whose adjusted close is closest to the avg cost paid.
    const hits = await golden<{ symbol: string; d: string }[]>`
      WITH t AS (
        SELECT unnest(${nsSyms}::text[])   AS ns_sym,
               unnest(${targets}::float8[]) AS target,
               unnest(${imps}::date[])      AS imp
      )
      SELECT DISTINCT ON (t.ns_sym) t.ns_sym AS symbol, ph.date::text AS d
        FROM t
        JOIN golden.price_history_1d ph
          ON ph.symbol = t.ns_sym AND ph.interval = '1d'
       WHERE ph.date <= t.imp AND ph.adj_close IS NOT NULL
       ORDER BY t.ns_sym, abs(ph.adj_close - t.target) ASC
    `.catch(() => [] as { symbol: string; d: string }[]);
    const dateByNs = new Map(hits.map((h) => [h.symbol, h.d]));
    for (const s of snapOnly) {
      const d = dateByNs.get(`${s.symbol.toUpperCase()}.NS`);
      if (!d) continue; // no price history → can't place a marker
      (tradesBySymbol[s.symbol] ??= []).push({
        d,
        side: "B",
        price: snapAdj(s),
        qty: Math.round(s.qty),
        derived: true,
      });
    }
  }

  return { tradedSymbols: Object.keys(tradesBySymbol), tradesBySymbol };
}

// ─────────────────────────── booked (realized) P&L ─────────────────────────

export type RealizedLot = {
  symbol: string;
  name: string | null;
  qtySold: number;
  proceeds: number; // Σ (sell price × qty)
  costOfSold: number; // Σ (avg cost at time of sale × qty)
  realized: number; // proceeds − costOfSold
  realizedPct: number | null; // realized ÷ costOfSold
  firstBuy: string | null;
  lastSell: string | null;
};

export type RealizedPnl = {
  rows: RealizedLot[];
  totals: {
    proceeds: number;
    costOfSold: number;
    realized: number;
    realizedPct: number | null;
    winners: number;
    losers: number;
  };
};

// One realized sell, booked at the running average cost at the moment of sale.
// Emitted by the same walk that produces the per-symbol rollup, so the Booked
// P&L tab and the realized-over-time analytics can never disagree.
type SellEvent = {
  symbol: string;
  name: string | null;
  date: string;        // sell date (ISO)
  qty: number;
  proceeds: number;
  cost: number;        // avg-cost basis of the sold qty
  realized: number;    // proceeds − cost
  holdingDays: number | null; // sell date − symbol's first observed buy (proxy)
};

function daysBetween(a: string, b: string): number | null {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.max(0, Math.round((tb - ta) / 86_400_000));
}

/**
 * Booked (realized) P&L from the trade log, average-cost method. Walking each
 * symbol's transactions in order, a buy blends into the running avg cost; a sell
 * books (sell price − avg cost) × qty against that basis. Only symbols that have
 * ever been (partly) sold appear. Unrealized gains on still-open positions are
 * NOT here — those live in the Holdings table. Cost basis unknown (a sell before
 * any buy in a windowed export) contributes 0 cost, so proceeds count as pure
 * realized — flagged implicitly by realizedPct being null-safe.
 *
 * Returns the per-symbol rows + totals AND the raw sell events, so callers that
 * want a time series (loadRealizedTimeline) reuse the exact same matching.
 */
async function computeRealized(
  userId: number,
): Promise<{ rows: RealizedLot[]; totals: RealizedPnl["totals"]; events: SellEvent[] }> {
  const txns = await sql<
    { symbol: string; d: string; side: string; qty: number; price: number; name: string | null; manual: boolean }[]
  >`
    SELECT t.symbol, t.trade_date::text AS d, t.side,
           t.quantity::float8 AS qty, t.price::float8 AS price, u.company_name AS name,
           (t.source_file = 'manual-entry') AS manual
      FROM app.portfolio_transaction t
      LEFT JOIN app.universe u ON u.symbol = t.symbol
     WHERE t.user_id = ${userId} AND t.symbol IS NOT NULL
     ORDER BY t.symbol, t.trade_date ASC, t.trade_time ASC NULLS FIRST, t.id ASC
  `;

  // Broker snapshot opening lots per symbol (weighted-avg cost across brokers).
  // Mirrors derivedHoldings.ts: when a snapshotted symbol has manual trades, the
  // snapshot seeds the walk and only the MANUAL trades apply on top — so a manual
  // sell books against the snapshot's cost basis.
  const snapRows = await sql<{ symbol: string; qty: number; avg: number | null }[]>`
    SELECT symbol, quantity::float8 AS qty, avg_cost::float8 AS avg
      FROM app.portfolio_holding
     WHERE user_id = ${userId} AND broker <> 'derived' AND symbol IS NOT NULL
  `;
  const snapBySym = new Map<string, { qty: number; costSum: number; costQty: number }>();
  for (const r of snapRows) {
    let s = snapBySym.get(r.symbol);
    if (!s) { s = { qty: 0, costSum: 0, costQty: 0 }; snapBySym.set(r.symbol, s); }
    s.qty += r.qty;
    if (r.avg != null) { s.costSum += r.qty * r.avg; s.costQty += r.qty; }
  }

  type Acc = {
    name: string | null;
    qty: number; // open qty
    avg: number; // running avg cost
    qtySold: number;
    proceeds: number;
    costOfSold: number;
    firstBuy: string | null;
    lastSell: string | null;
  };
  const bySym = new Map<string, Acc>();
  const events: SellEvent[] = [];

  // Group the (already symbol-ordered) txns so we can pick a per-symbol regime.
  type TxnRow = (typeof txns)[number];
  const txnsBySym = new Map<string, TxnRow[]>();
  for (const t of txns) {
    (txnsBySym.get(t.symbol) ?? txnsBySym.set(t.symbol, []).get(t.symbol)!).push(t);
  }

  for (const [symbol, list] of txnsBySym) {
    const snap = snapBySym.get(symbol);
    const hasSnapshot = !!snap && snap.qty > 0;
    const hasManual = list.some((t) => t.manual);
    const seeded = hasSnapshot && hasManual; // snapshot + manual → seed & manual-only
    const walk = seeded ? list.filter((t) => t.manual) : list;

    const a: Acc = {
      name: list[0]?.name ?? null,
      qty: 0, avg: 0, qtySold: 0, proceeds: 0, costOfSold: 0, firstBuy: null, lastSell: null,
    };
    if (seeded && snap) {
      a.qty = snap.qty;
      a.avg = snap.costQty > 0 ? snap.costSum / snap.costQty : 0;
    }
    bySym.set(symbol, a);

    for (const t of walk) {
      if (t.side === "buy") {
        if (a.firstBuy == null) a.firstBuy = t.d;
        const next = a.qty + t.qty;
        a.avg = next > 0 ? (a.qty * a.avg + t.qty * t.price) / next : 0;
        a.qty = next;
      } else {
        // sell: book against current avg, up to the open qty (ignore oversells).
        const sold = a.qty > 0 ? Math.min(t.qty, a.qty) : 0;
        if (sold > 0) {
          const proceeds = sold * t.price;
          const cost = sold * a.avg;
          a.qtySold += sold;
          a.proceeds += proceeds;
          a.costOfSold += cost;
          a.qty -= sold;
          a.lastSell = t.d;
          events.push({
            symbol, name: a.name, date: t.d, qty: sold,
            proceeds, cost, realized: proceeds - cost,
            holdingDays: a.firstBuy ? daysBetween(a.firstBuy, t.d) : null,
          });
        }
      }
    }
  }

  const rows: RealizedLot[] = [];
  let pProceeds = 0, pCost = 0, winners = 0, losers = 0;
  for (const [symbol, a] of bySym) {
    if (a.qtySold <= 0) continue;
    const realized = a.proceeds - a.costOfSold;
    rows.push({
      symbol,
      name: a.name,
      qtySold: Math.round(a.qtySold * 10000) / 10000,
      proceeds: Math.round(a.proceeds * 100) / 100,
      costOfSold: Math.round(a.costOfSold * 100) / 100,
      realized: Math.round(realized * 100) / 100,
      realizedPct: a.costOfSold > 0 ? Math.round((realized / a.costOfSold) * 1000) / 10 : null,
      firstBuy: a.firstBuy,
      lastSell: a.lastSell,
    });
    pProceeds += a.proceeds;
    pCost += a.costOfSold;
    if (realized >= 0) winners++;
    else losers++;
  }
  rows.sort((x, y) => y.realized - x.realized);

  const realized = pProceeds - pCost;
  return {
    rows,
    totals: {
      proceeds: Math.round(pProceeds * 100) / 100,
      costOfSold: Math.round(pCost * 100) / 100,
      realized: Math.round(realized * 100) / 100,
      realizedPct: pCost > 0 ? Math.round((realized / pCost) * 1000) / 10 : null,
      winners,
      losers,
    },
    events,
  };
}

/** Public per-symbol booked P&L (drops the raw sell events). */
export async function loadRealizedPnl(userId: number): Promise<RealizedPnl> {
  const { rows, totals } = await computeRealized(userId);
  return { rows, totals };
}

// ── realized performance over time ──────────────────────────────────────────
//
// The honest "how good am I over the long run?" view. The trade log's POSITION
// history is incomplete (early buys pre-date it, some holdings have no logged
// trades), so we deliberately do NOT reconstruct a portfolio value curve from
// it. But every logged SELL that matched against a known cost basis is a real
// closed trade — those we can trust. This aggregates them into a monthly booked
// P&L series plus win-rate / hold-period / best-worst stats. Symbols sold with
// NO cost basis (proceeds booked as pure realized) are excluded from the
// return-percentage stats but still counted in monthly rupee totals.
export type RealizedTimeline = {
  months: { month: string; realized: number; proceeds: number; sells: number; winners: number; losers: number }[];
  scatter: { symbol: string; holdingDays: number; realizedPct: number; realized: number }[];
  stats: {
    closedTrades: number;      // number of sell events
    closedSymbols: number;     // distinct symbols with a booked exit
    winRate: number | null;    // % of sell events with realized ≥ 0
    avgWinPct: number | null;  // mean realizedPct of winning symbols
    avgLossPct: number | null; // mean realizedPct of losing symbols
    avgHoldDays: number | null;
    bestTrade: { symbol: string; realized: number } | null;
    worstTrade: { symbol: string; realized: number } | null;
    firstSell: string | null;
    lastSell: string | null;
  };
};

export async function loadRealizedTimeline(userId: number): Promise<RealizedTimeline | null> {
  const { rows, events } = await computeRealized(userId);
  if (events.length === 0) return null;

  // Monthly rupee buckets keyed YYYY-MM (win/loss counted per sell event).
  const byMonth = new Map<string, { realized: number; proceeds: number; sells: number; winners: number; losers: number }>();
  for (const e of events) {
    const m = e.date.slice(0, 7);
    const b = byMonth.get(m) ?? { realized: 0, proceeds: 0, sells: 0, winners: 0, losers: 0 };
    b.realized += e.realized;
    b.proceeds += e.proceeds;
    b.sells += 1;
    if (e.realized >= 0) b.winners += 1; else b.losers += 1;
    byMonth.set(m, b);
  }
  const months = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, b]) => ({
      month,
      realized: Math.round(b.realized * 100) / 100,
      proceeds: Math.round(b.proceeds * 100) / 100,
      sells: b.sells,
      winners: b.winners,
      losers: b.losers,
    }));

  // Per-symbol hold-period vs return scatter (needs a real cost basis + span).
  const scatter = rows
    .filter((r) => r.realizedPct != null && r.firstBuy && r.lastSell)
    .map((r) => ({
      symbol: r.symbol,
      holdingDays: daysBetween(r.firstBuy!, r.lastSell!) ?? 0,
      realizedPct: r.realizedPct!,
      realized: r.realized,
    }));

  const wins = rows.filter((r) => r.realizedPct != null && r.realized >= 0);
  const losses = rows.filter((r) => r.realizedPct != null && r.realized < 0);
  const sellWins = events.filter((e) => e.realized >= 0).length;
  const holdDays = scatter.map((s) => s.holdingDays);
  const sorted = [...rows].sort((a, b) => b.realized - a.realized);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

  return {
    months,
    scatter,
    stats: {
      closedTrades: events.length,
      closedSymbols: rows.length,
      winRate: events.length ? Math.round((sellWins / events.length) * 1000) / 10 : null,
      avgWinPct: r1(mean(wins.map((r) => r.realizedPct!))),
      avgLossPct: r1(mean(losses.map((r) => r.realizedPct!))),
      avgHoldDays: holdDays.length ? Math.round(mean(holdDays)!) : null,
      bestTrade: sorted.length ? { symbol: sorted[0].symbol, realized: sorted[0].realized } : null,
      worstTrade: sorted.length ? { symbol: sorted[sorted.length - 1].symbol, realized: sorted[sorted.length - 1].realized } : null,
      firstSell: events.reduce((min, e) => (e.date < min ? e.date : min), events[0].date),
      lastSell: events.reduce((max, e) => (e.date > max ? e.date : max), events[0].date),
    },
  };
}

/** Load + value a user's portfolio, aggregated per instrument. */
export async function loadPortfolio(userId: number): Promise<Portfolio> {
  const holdings = await sql<HoldingRow[]>`
    SELECT broker, raw_symbol, isin, symbol, is_mapped, quantity::text,
           avg_cost::text, broker_ltp::text, broker_cur_value::text,
           broker_day_pct::text, imported_at::text
      FROM app.portfolio_holding
     WHERE user_id = ${userId}
  `;

  if (holdings.length === 0) {
    return {
      hasHoldings: false,
      instruments: [],
      totals: {
        invested: 0, currentValue: 0, pnl: 0, pnlPct: null, dayChangeValue: 0,
        dayChangePct: null, mappedValue: 0, unmappedValue: 0, holdingCount: 0, mappedCount: 0,
      },
      brokerAlloc: [],
      sectorAlloc: [],
      snapshotDate: null,
      brokers: [],
    };
  }

  // Symbols the user has hand-entered trades for. Each such symbol is reconciled
  // into a single synthetic 'derived' row (snapshot opening lot + manual trades,
  // see derivedHoldings.ts); we suppress its raw broker snapshot rows below so
  // the position isn't double-counted. A fully-exited symbol has no derived row
  // and its snapshot stays suppressed → it drops off Holdings, as expected.
  const manualRows = await sql<{ symbol: string }[]>`
    SELECT DISTINCT symbol FROM app.portfolio_transaction
     WHERE user_id = ${userId} AND source_file = 'manual-entry' AND symbol IS NOT NULL
  `;
  const manualSymbols = new Set(manualRows.map((r) => r.symbol));
  const visibleHoldings = holdings.filter(
    (h) => h.broker === "derived" || !h.symbol || !manualSymbols.has(h.symbol),
  );

  const mappedSyms = [...new Set(visibleHoldings.filter((h) => h.symbol).map((h) => h.symbol!))];

  // Scores + sector/industry from the latest cache snapshot.
  const cacheRows = mappedSyms.length
    ? await sql<CacheRow[]>`
        WITH ranked AS (
          SELECT p.symbol, p.cluster_id, p.maturity_tier, p.current_price,
                 p.quality_pct, p.valuation_pct, p.momentum_pct, p.composite_pct,
                 p.ret_1w, p.ret_1m, p.ret_1y,
                 RANK() OVER (PARTITION BY p.cluster_id, p.maturity_tier
                              ORDER BY p.composite_pct DESC NULLS LAST) AS peer_rank,
                 COUNT(*) OVER (PARTITION BY p.cluster_id, p.maturity_tier) AS peer_count
          FROM app.cluster_stocks_panel_cache p
          WHERE p.snapshot_date = (SELECT max(snapshot_date) FROM app.cluster_stocks_panel_cache)
        )
        SELECT r.symbol, u.company_name,
               mc.name AS sector, c.name AS industry, r.maturity_tier,
               r.current_price, r.quality_pct, r.valuation_pct, r.momentum_pct,
               r.composite_pct, r.ret_1w, r.ret_1m, r.ret_1y,
               r.peer_rank, r.peer_count
          FROM ranked r
          JOIN app.universe u ON u.symbol = r.symbol
          LEFT JOIN app.cluster c ON c.id = r.cluster_id
          LEFT JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
         WHERE r.symbol = ANY(${mappedSyms})
      `
    : [];
  const cache = new Map<string, CacheRow>();
  for (const r of cacheRows) cache.set(r.symbol, r);

  // Live price + 1D from golden: latest two closes per mapped symbol.
  const gsyms = mappedSyms.map((s) => s + ".NS");
  const gp = gsyms.length
    ? await golden<{ symbol: string; close: string; rn: string }[]>`
        SELECT symbol, close::text AS close, rn FROM (
          SELECT symbol, close,
                 row_number() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
          FROM golden.price_history_1d
          WHERE symbol = ANY(${gsyms}) AND close IS NOT NULL
        ) t WHERE rn <= 2
      `
    : [];
  const gLast = new Map<string, number>();
  const gPrev = new Map<string, number>();
  for (const g of gp) {
    const bare = g.symbol.endsWith(".NS") ? g.symbol.slice(0, -3) : g.symbol;
    if (Number(g.rn) === 1) gLast.set(bare, Number(g.close));
    else gPrev.set(bare, Number(g.close));
  }

  const snapRow = await sql<{ d: string | null }[]>`
    SELECT max(snapshot_date)::text AS d FROM app.cluster_stocks_panel_cache
  `;
  const snapshotDate = snapRow[0]?.d ?? null;

  // ── Aggregate per instrument. Key: universe symbol (mapped) else isin
  //    (unmapped-with-isin, e.g. Groww ETFs) else bare symbol. ──
  type Agg = {
    key: string;
    symbol: string | null;
    isMapped: boolean;
    rawName: string;
    qty: number;
    costSum: number; // Σ qty*avgCost
    costQty: number; // Σ qty where avgCost known (for blended)
    brokerCurValueSum: number; // Σ broker current value (unmapped fallback)
    brokerDayValueSum: number; // Σ broker day-change value (unmapped fallback)
    firstImported: number | null; // MIN(imported_at) epoch ms across lots
    lots: BrokerLot[];
  };
  const aggs = new Map<string, Agg>();

  for (const h of visibleHoldings) {
    const key = h.symbol ?? h.isin ?? bareSymbol(h.raw_symbol);
    const qty = Number(h.quantity) || 0;
    const avgCost = num(h.avg_cost);
    let a = aggs.get(key);
    if (!a) {
      a = {
        key,
        symbol: h.symbol,
        isMapped: h.is_mapped,
        rawName: bareSymbol(h.raw_symbol),
        qty: 0, costSum: 0, costQty: 0,
        brokerCurValueSum: 0, brokerDayValueSum: 0,
        firstImported: null,
        lots: [],
      };
      aggs.set(key, a);
    }
    a.qty += qty;
    if (avgCost != null) {
      a.costSum += qty * avgCost;
      a.costQty += qty;
    }
    const bcv = num(h.broker_cur_value);
    if (bcv != null) a.brokerCurValueSum += bcv;
    const bdp = num(h.broker_day_pct);
    // day-change value ≈ curValue * pct/(100+pct) — but broker gives % on
    // current, so day value = curValue - curValue/(1+pct/100).
    if (bcv != null && bdp != null) {
      const prevVal = bcv / (1 + bdp / 100);
      a.brokerDayValueSum += bcv - prevVal;
    }
    if (h.imported_at) {
      const t = Date.parse(h.imported_at);
      if (!Number.isNaN(t)) a.firstImported = a.firstImported == null ? t : Math.min(a.firstImported, t);
    }
    a.lots.push({
      broker: h.broker,
      brokerLabel: BROKER_LABEL[h.broker],
      quantity: qty,
      avgCost,
    });
  }

  const instruments: Instrument[] = [];
  for (const a of aggs.values()) {
    const c = a.symbol ? cache.get(a.symbol) : undefined;
    const derived = a.lots.every((l) => l.broker === "derived");
    const blendedAvg = a.costQty > 0 ? a.costSum / a.costQty : null;
    const invested = a.costSum; // Σ qty*avgCost across brokers

    let price: number | null;
    let currentValue: number;
    let dayChangePct: number | null;
    let dayChangeValue: number | null;

    if (a.isMapped) {
      // golden close first (freshest), then cache price.
      price = a.symbol ? gLast.get(a.symbol) ?? c?.current_price ?? null : null;
      currentValue = price != null ? a.qty * price : a.brokerCurValueSum;
      const last = a.symbol ? gLast.get(a.symbol) : undefined;
      const prev = a.symbol ? gPrev.get(a.symbol) : undefined;
      if (last != null && prev != null && prev !== 0) {
        dayChangePct = Math.round((last / prev - 1) * 1000) / 10;
        dayChangeValue = a.qty * (last - prev);
      } else {
        dayChangePct = null;
        dayChangeValue = null;
      }
    } else {
      // carried at broker value.
      currentValue = a.brokerCurValueSum;
      price = a.qty > 0 ? currentValue / a.qty : null;
      dayChangeValue = a.brokerDayValueSum || null;
      dayChangePct =
        currentValue - a.brokerDayValueSum !== 0
          ? Math.round((a.brokerDayValueSum / (currentValue - a.brokerDayValueSum)) * 1000) / 10
          : null;
    }

    const pnl = currentValue - invested;
    const pnlPct = invested > 0 ? Math.round((pnl / invested) * 1000) / 10 : null;

    // +25% profit target off blended avg cost. Only meaningful for mapped
    // equities where we have a live price to compare against.
    const targetPrice = blendedAvg != null ? Math.round(blendedAvg * 1.25 * 100) / 100 : null;
    const targetHit = targetPrice != null && price != null && price >= targetPrice;

    // Holding period ≈ months since first import. NOTE: broker exports carry no
    // purchase date, and re-importing a broker resets imported_at — so this
    // measures "tracked since", not true buy date. Honest proxy, flagged in UI.
    const firstImported = a.firstImported == null ? null : new Date(a.firstImported).toISOString();
    const monthsHeld = a.firstImported == null
      ? null
      : Math.round(((Date.now() - a.firstImported) / (1000 * 60 * 60 * 24 * 30.44)) * 10) / 10;
    const overHoldLimit = monthsHeld != null && monthsHeld >= 4;

    instruments.push({
      key: a.key,
      symbol: a.symbol,
      name: c?.company_name ?? a.symbol ?? a.rawName,
      isMapped: a.isMapped,
      derived,
      quantity: Math.round(a.qty * 10000) / 10000,
      avgCost: blendedAvg == null ? null : Math.round(blendedAvg * 100) / 100,
      invested: Math.round(invested * 100) / 100,
      price: price == null ? null : Math.round(price * 100) / 100,
      currentValue: Math.round(currentValue * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      pnlPct,
      targetPrice,
      targetHit,
      firstImported,
      monthsHeld,
      overHoldLimit,
      dayChangePct,
      dayChangeValue: dayChangeValue == null ? null : Math.round(dayChangeValue * 100) / 100,
      sector: c?.sector ?? null,
      industry: c?.industry ?? null,
      category: c ? TIER_MAP[c.maturity_tier ?? ""] ?? (c.maturity_tier || null) : null,
      q: num(c?.quality_pct),
      v: num(c?.valuation_pct),
      m: num(c?.momentum_pct),
      composite: num(c?.composite_pct),
      peerRank: c?.peer_rank == null ? null : Math.round(Number(c.peer_rank)),
      peerCount: c?.peer_count == null ? null : Math.round(Number(c.peer_count)),
      ret1w: pctx(c?.ret_1w),
      ret1m: pctx(c?.ret_1m),
      ret1y: pctx(c?.ret_1y),
      brokers: a.lots.sort((x, y) => y.quantity - x.quantity),
    });
  }

  instruments.sort((a, b) => b.currentValue - a.currentValue);

  // ── Totals + allocations ──
  let invested = 0, currentValue = 0, dayChangeValue = 0, mappedValue = 0, unmappedValue = 0;
  const brokerVal = new Map<Broker, number>();
  const sectorVal = new Map<string, number>();
  for (const ins of instruments) {
    invested += ins.invested;
    currentValue += ins.currentValue;
    if (ins.dayChangeValue != null) dayChangeValue += ins.dayChangeValue;
    if (ins.isMapped) mappedValue += ins.currentValue;
    else unmappedValue += ins.currentValue;
    const secKey = ins.isMapped ? ins.sector ?? "Uncategorised" : "ETFs & funds (unscored)";
    sectorVal.set(secKey, (sectorVal.get(secKey) ?? 0) + ins.currentValue);
    // split broker allocation by each lot's share of current value
    const totalLotQty = ins.brokers.reduce((s, l) => s + l.quantity, 0) || 1;
    for (const l of ins.brokers) {
      const share = (l.quantity / totalLotQty) * ins.currentValue;
      brokerVal.set(l.broker, (brokerVal.get(l.broker) ?? 0) + share);
    }
  }
  const pnl = currentValue - invested;
  const prevValue = currentValue - dayChangeValue;

  const brokers = [...new Set(holdings.map((h) => h.broker))];

  return {
    hasHoldings: true,
    instruments,
    totals: {
      invested: Math.round(invested * 100) / 100,
      currentValue: Math.round(currentValue * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      pnlPct: invested > 0 ? Math.round((pnl / invested) * 1000) / 10 : null,
      dayChangeValue: Math.round(dayChangeValue * 100) / 100,
      dayChangePct: prevValue > 0 ? Math.round((dayChangeValue / prevValue) * 1000) / 10 : null,
      mappedValue: Math.round(mappedValue * 100) / 100,
      unmappedValue: Math.round(unmappedValue * 100) / 100,
      holdingCount: instruments.length,
      mappedCount: instruments.filter((i) => i.isMapped).length,
    },
    brokerAlloc: [...brokerVal.entries()]
      .map(([b, v]) => ({ label: BROKER_LABEL[b], value: Math.round(v * 100) / 100 }))
      .sort((a, b) => b.value - a.value),
    sectorAlloc: [...sectorVal.entries()]
      .map(([s, v]) => ({ label: s, value: Math.round(v * 100) / 100 }))
      .sort((a, b) => b.value - a.value),
    snapshotDate,
    brokers,
  };
}
