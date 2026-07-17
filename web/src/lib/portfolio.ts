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
  quantity: number;
  avgCost: number | null; // blended
  invested: number;
  price: number | null; // per-share current
  currentValue: number;
  pnl: number;
  pnlPct: number | null;
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

/** Load + value a user's portfolio, aggregated per instrument. */
export async function loadPortfolio(userId: number): Promise<Portfolio> {
  const holdings = await sql<HoldingRow[]>`
    SELECT broker, raw_symbol, isin, symbol, is_mapped, quantity::text,
           avg_cost::text, broker_ltp::text, broker_cur_value::text,
           broker_day_pct::text
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

  const mappedSyms = [...new Set(holdings.filter((h) => h.symbol).map((h) => h.symbol!))];

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
    lots: BrokerLot[];
  };
  const aggs = new Map<string, Agg>();

  for (const h of holdings) {
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

    instruments.push({
      key: a.key,
      symbol: a.symbol,
      name: c?.company_name ?? a.symbol ?? a.rawName,
      isMapped: a.isMapped,
      quantity: Math.round(a.qty * 10000) / 10000,
      avgCost: blendedAvg == null ? null : Math.round(blendedAvg * 100) / 100,
      invested: Math.round(invested * 100) / 100,
      price: price == null ? null : Math.round(price * 100) / 100,
      currentValue: Math.round(currentValue * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      pnlPct,
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
