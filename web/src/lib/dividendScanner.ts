/**
 * dividendScanner.ts — sector → industry → stock tree for the Dividend Scanner,
 * carrying each name's LTP, last-4-fiscal-year dividend-per-share, a trailing
 * dividend yield, and its composite percentile.
 *
 * Data reality (why FY, not quarters): the only dividend source is
 * app.fundamentals_annual.dividend_amount — the TOTAL annual dividend in ₹ crore
 * per fiscal year (Indian FY ends 31-Mar). There is NO per-announcement /
 * quarterly dividend feed and no ex-date anywhere in the DBs, so we report
 * per-share dividend by fiscal year:  DPS = dividend_amount × 1e7 ÷ shares.
 *
 * Yield is TRAILING and internally consistent with the table: the newest FY with
 * a value ÷ current LTP. LTP is the latest close from golden.price_history_1d
 * (a separate pool, so it's a second query merged in JS, keyed by bare symbol).
 *
 * Built ONCE server-side; it's small (symbols + a handful of numbers), so it
 * ships with the page — no lazy per-row fetching.
 */
import { sql, golden } from "@/lib/db";

export type DivStock = {
  symbol: string;
  name: string | null;
  sector: string;
  industry: string;
  ltp: number | null;
  dps: (number | null)[]; // aligned to DividendUniverse.fyLabels, newest FY first
  dpsYield: (number | null)[]; // %, per-FY: that year's DPS ÷ that year's price
  divYield: number | null; // %, trailing (newest non-null DPS ÷ LTP)
  composite_pct: number | null;
};
export type DivIndustry = { id: string; name: string; stocks: DivStock[] };
export type DivSector = { name: string; count: number; industries: DivIndustry[] };
export type DividendUniverse = {
  snapDate: string | null;
  fyLabels: string[]; // 4 most recent fiscal years, newest first, e.g. ["FY26", ...]
  sectors: DivSector[];
};

/** Fiscal-year label for a March-ending period_end date → "FY26". */
function fyLabel(periodEnd: string): string {
  const y = Number(periodEnd.slice(0, 4));
  return `FY${String(y % 100).padStart(2, "0")}`;
}

/** Strip golden's ".NS" so keys match the bare app symbol. */
function bare(sym: string): string {
  return sym.endsWith(".NS") ? sym.slice(0, -3) : sym;
}

const N_YEARS = 4;

export async function loadDividendUniverse(): Promise<DividendUniverse> {
  const empty: DividendUniverse = { snapDate: null, fyLabels: [], sectors: [] };

  let snapDate: string | null;
  try {
    const d = await sql<{ d: string | null }[]>`
      SELECT max(snapshot_date)::text AS d FROM app.cluster_stocks_panel_cache
    `;
    snapDate = d[0]?.d ?? null;
  } catch {
    return empty;
  }
  if (!snapDate) return empty;

  // 1) The tree: sector → industry → stock, composite-desc within industry.
  type TreeRow = {
    sector: string | null;
    industry_id: string;
    industry: string | null;
    symbol: string;
    name: string | null;
    composite_pct: number | null;
  };
  let rows: TreeRow[];
  try {
    rows = await sql<TreeRow[]>`
      SELECT mc.name AS sector,
             c.id::text AS industry_id,
             c.name  AS industry,
             p.symbol,
             u.company_name AS name,
             p.composite_pct::float8 AS composite_pct
        FROM app.cluster_stocks_panel_cache p
        JOIN app.cluster c        ON c.id = p.cluster_id
        JOIN app.meta_cluster mc  ON mc.id = c.meta_cluster_id
        LEFT JOIN app.universe u  ON u.symbol = p.symbol
       WHERE p.snapshot_date = ${snapDate}::date
       ORDER BY mc.name ASC, c.name ASC, p.composite_pct DESC NULLS LAST, p.symbol ASC
    `;
  } catch {
    return empty;
  }
  if (rows.length === 0) return empty;

  const symbols = Array.from(new Set(rows.map((r) => r.symbol)));

  // 2) Per-symbol fiscal-year DPS from the annual dividend total ÷ shares.
  const dpsBySym = new Map<string, Map<string, number>>(); // symbol → (FY → DPS)
  const fySet = new Set<string>();
  try {
    const drows = await sql<
      { symbol: string; period_end: string; amt: number | null; shares: number | null }[]
    >`
      SELECT symbol,
             period_end::text AS period_end,
             dividend_amount::float8   AS amt,
             no_of_equity_shares::float8 AS shares
        FROM app.fundamentals_annual
       WHERE symbol = ANY(${symbols})
         AND dividend_amount IS NOT NULL
         AND period_end >= (CURRENT_DATE - INTERVAL '6 years')
       ORDER BY symbol, period_end DESC
    `;
    for (const r of drows) {
      if (r.amt == null || !r.shares || r.shares <= 0) continue;
      const dps = (r.amt * 1e7) / r.shares; // ₹cr → ₹, ÷ shares → ₹/share
      const fy = fyLabel(r.period_end);
      fySet.add(fy);
      let m = dpsBySym.get(r.symbol);
      if (!m) {
        m = new Map();
        dpsBySym.set(r.symbol, m);
      }
      if (!m.has(fy)) m.set(fy, dps); // newest row per FY wins (rows are desc)
    }
  } catch {
    // Dividends optional — fall through with empty maps (all cells show "—").
  }

  // The 4 most recent fiscal years present anywhere → fixed, aligned columns.
  const fyLabels = Array.from(fySet)
    .sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)))
    .slice(0, N_YEARS);

  const ns = symbols.map((s) => `${s.toUpperCase()}.NS`);

  // 3) LTP: latest close per symbol from golden (separate pool → merge in JS).
  const ltpBySym = new Map<string, number>();
  try {
    const prows = await golden<{ symbol: string; c: number | null }[]>`
      SELECT DISTINCT ON (symbol) symbol, close::float8 AS c
        FROM golden.price_history_1d
       WHERE interval = '1d'
         AND symbol = ANY(${ns})
         AND date >= CURRENT_DATE - 15
       ORDER BY symbol, date DESC
    `;
    for (const r of prows) if (r.c != null) ltpBySym.set(bare(r.symbol), r.c);
  } catch {
    // LTP optional — yield just goes null where price is missing.
  }

  // 3b) Per-FY price: the close nearest each fiscal-year end (~31 Mar) so we can
  // show a TRUE point-in-time yield in every column — that year's DPS ÷ that
  // year's own price, not today's. FY26 → target 2026-03-31; we take the last
  // trade on or just before it (20-day back-window covers the Mar-end holidays).
  const priceByFy = new Map<string, Map<string, number>>(); // symbol → (FY → price)
  const fyTargets = fyLabels.map((fy) => `${2000 + Number(fy.slice(2))}-03-31`);
  const targetToFy = new Map(fyTargets.map((t, i) => [t, fyLabels[i]]));
  try {
    const prows = await golden<{ symbol: string; target: string; c: number | null }[]>`
      SELECT DISTINCT ON (p.symbol, t.d) p.symbol, t.d::text AS target, p.close::float8 AS c
        FROM golden.price_history_1d p
        JOIN unnest(${fyTargets}::date[]) AS t(d)
          ON p.date <= t.d AND p.date > t.d - 20
       WHERE p.interval = '1d'
         AND p.symbol = ANY(${ns})
       ORDER BY p.symbol, t.d, p.date DESC
    `;
    for (const r of prows) {
      if (r.c == null) continue;
      const fy = targetToFy.get(r.target);
      if (!fy) continue;
      const key = bare(r.symbol);
      let m = priceByFy.get(key);
      if (!m) {
        m = new Map();
        priceByFy.set(key, m);
      }
      m.set(fy, r.c);
    }
  } catch {
    // Historical prices optional — per-year yields just go null where missing.
  }

  // 4) Nest into sectors[industries[stocks]], attaching dividend fields.
  const sectorMap = new Map<string, DivSector>();
  const industryMap = new Map<string, DivIndustry>();
  for (const r of rows) {
    const sName = (r.sector || "—").trim() || "—";
    const iName = (r.industry || "—").trim() || "—";
    let sector = sectorMap.get(sName);
    if (!sector) {
      sector = { name: sName, count: 0, industries: [] };
      sectorMap.set(sName, sector);
    }
    let industry = industryMap.get(r.industry_id);
    if (!industry) {
      industry = { id: r.industry_id, name: iName, stocks: [] };
      industryMap.set(r.industry_id, industry);
      sector.industries.push(industry);
    }

    const dpsMap = dpsBySym.get(r.symbol);
    const dps = fyLabels.map((fy) => dpsMap?.get(fy) ?? null);
    const ltp = ltpBySym.get(r.symbol) ?? null;
    const priceMap = priceByFy.get(r.symbol);
    const dpsYield = fyLabels.map((fy, i) => {
      const d = dps[i];
      const px = priceMap?.get(fy) ?? null;
      return d != null && px != null && px > 0 ? (d / px) * 100 : null;
    });
    const latestDps = dps.find((v) => v != null) ?? null;
    const divYield =
      latestDps != null && ltp != null && ltp > 0 ? (latestDps / ltp) * 100 : null;

    industry.stocks.push({
      symbol: r.symbol,
      name: r.name,
      sector: sName,
      industry: iName,
      ltp,
      dps,
      dpsYield,
      divYield,
      composite_pct: r.composite_pct,
    });
    sector.count += 1;
  }

  const sectors = Array.from(sectorMap.values()).sort((a, b) => b.count - a.count);

  // 5) Dividend-only names (InvITs/REITs) — a hand-curated register kept OUTSIDE
  // the scored universe (app.dividend_only + app.dividend_only_annual, no golden
  // dependency). They carry a distribution history and their own price snapshot
  // but NO composite (they aren't scored). We align them to the same fyLabels
  // and append their sector(s) at the end so they read as a distinct asset class.
  try {
    const drows = await sql<
      {
        symbol: string;
        company_name: string | null;
        sector: string;
        industry: string;
        current_price: number | null;
        period_end: string | null;
        dividend_amount: number | null;
        no_of_equity_shares: number | null;
        annual_close_price: number | null;
      }[]
    >`
      SELECT d.symbol, d.company_name, d.sector, d.industry,
             d.current_price::float8       AS current_price,
             a.period_end::text            AS period_end,
             a.dividend_amount::float8     AS dividend_amount,
             a.no_of_equity_shares::float8 AS no_of_equity_shares,
             a.annual_close_price::float8  AS annual_close_price
        FROM app.dividend_only d
        LEFT JOIN app.dividend_only_annual a ON a.symbol = d.symbol
       ORDER BY d.sector ASC, d.industry ASC, d.symbol ASC
    `;

    // symbol → { meta, (FY → {dpu, price}) }
    type DivAgg = {
      name: string | null;
      sector: string;
      industry: string;
      ltp: number | null;
      byFy: Map<string, { dpu: number | null; price: number | null }>;
    };
    const bySym = new Map<string, DivAgg>();
    for (const r of drows) {
      let agg = bySym.get(r.symbol);
      if (!agg) {
        agg = {
          name: r.company_name,
          sector: (r.sector || "—").trim() || "—",
          industry: (r.industry || "—").trim() || "—",
          ltp: r.current_price,
          byFy: new Map(),
        };
        bySym.set(r.symbol, agg);
      }
      if (r.period_end) {
        const fy = fyLabel(r.period_end);
        const units = r.no_of_equity_shares;
        const dpu =
          r.dividend_amount != null && units != null && units > 0
            ? (r.dividend_amount * 1e7) / units
            : null;
        agg.byFy.set(fy, { dpu, price: r.annual_close_price });
      }
    }

    // Nest into the same sector → industry → stock shape, composite = null.
    const doSectorMap = new Map<string, DivSector>();
    const doIndustryMap = new Map<string, DivIndustry>();
    for (const [symbol, agg] of bySym) {
      let sector = doSectorMap.get(agg.sector);
      if (!sector) {
        sector = { name: agg.sector, count: 0, industries: [] };
        doSectorMap.set(agg.sector, sector);
      }
      const indKey = `${agg.sector}|${agg.industry}`;
      let industry = doIndustryMap.get(indKey);
      if (!industry) {
        industry = { id: `divonly:${indKey}`, name: agg.industry, stocks: [] };
        doIndustryMap.set(indKey, industry);
        sector.industries.push(industry);
      }

      const dps = fyLabels.map((fy) => agg.byFy.get(fy)?.dpu ?? null);
      const dpsYield = fyLabels.map((fy, i) => {
        const d = dps[i];
        const px = agg.byFy.get(fy)?.price ?? null;
        return d != null && px != null && px > 0 ? (d / px) * 100 : null;
      });
      const latestDps = dps.find((v) => v != null) ?? null;
      const divYield =
        latestDps != null && agg.ltp != null && agg.ltp > 0 ? (latestDps / agg.ltp) * 100 : null;

      industry.stocks.push({
        symbol,
        name: agg.name,
        sector: agg.sector,
        industry: agg.industry,
        ltp: agg.ltp,
        dps,
        dpsYield,
        divYield,
        composite_pct: null,
      });
      sector.count += 1;
    }
    // Append after the scored equity sectors (they read as a separate class).
    sectors.push(...Array.from(doSectorMap.values()).sort((a, b) => b.count - a.count));
  } catch {
    // Dividend-only register is optional — absent table just means no InvITs.
  }

  return { snapDate, fyLabels, sectors };
}
