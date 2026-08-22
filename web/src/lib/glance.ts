/**
 * glance.ts — sector-aware "fundamentals at a glance" for the watchlist.
 *
 * The watchlist shows a compact peer-comparison table grouped by industry.
 * The COLUMNS in that table depend on the stock's sector: leverage and
 * free-cash-flow are meaningful for a manufacturer but actively misleading for
 * a bank (deposits/borrowings are a lender's raw material, and lenders run
 * negative operating cash flow by design). So each sector family gets a curated
 * set of metric columns.
 *
 * This module has two halves:
 *   - deriveGlance(): server-side — turns raw quarterly + annual rows into the
 *     latest value + short trend series for every candidate metric.
 *   - metricsForSector() / METRIC_META: client-side — picks and labels the
 *     columns to render for a given sector.
 */

// ── Metric catalogue ────────────────────────────────────────────────────────
export type MetricKey =
  | "sales"
  | "net_profit"
  | "opm"
  | "npm"
  | "roe"
  | "de"
  | "fcf"
  | "cfo"
  | "networth"
  // Derived efficiency / returns / leverage — all computed from columns already
  // present in fundamentals_annual (no external fetch). These let the card show
  // the fundamentals a stock's cluster scorecard actually weights (RoCE for
  // compounders, working-capital days for asset-heavy names, etc.).
  | "roce"
  | "roa"
  | "asset_turnover"
  | "inv_days"
  | "dso"
  | "wc_days"
  | "net_debt_ebitda"
  | "capex_intensity"
  | "equity_to_assets";

/** One metric's latest value + a short chronological series for the sparkline.
 *  `yoy` is populated only for the flow metrics where a YoY read makes sense. */
export type GlanceMetric = {
  value: number | null;
  yoy: number | null;
  series: (number | null)[];
};

export type GlanceMetrics = Record<MetricKey, GlanceMetric>;

// Raw rows as loaded from the DB (newest-first per symbol).
export type QRow = {
  period_end: string;
  sales: number | null;
  net_profit: number | null;
  operating_profit: number | null;
};
export type ARow = {
  period_end: string;
  sales: number | null;
  net_profit: number | null;
  borrowings: number | null;
  equity_share_capital: number | null;
  reserves: number | null;
  cash_from_operating: number | null;
  cash_from_investing: number | null;
  // Extra columns pulled for the derived efficiency / returns / leverage series.
  operating_profit: number | null;
  expenses: number | null;
  depreciation: number | null;
  interest: number | null;
  profit_before_tax: number | null;
  net_block: number | null;
  cwip: number | null;
  total_assets: number | null;
  receivables: number | null;
  inventory: number | null;
  cash_and_bank: number | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Build the full metric set for one symbol from its raw annual rows
 *  (passed newest-first). Every glance series is ANNUAL — flow metrics
 *  (sales, profit, margins) as well as balance-sheet / returns / cash metrics.
 *  The watchlist's "Quarterly" toggle is fed separately from the extras API's
 *  quarterly results; glance is the "Yearly" source of truth.
 *
 *  `_qNewestFirst` is accepted for call-site compatibility but no longer used
 *  (flow used to be quarterly here; it's now annual). */
export function deriveGlance(_qNewestFirst: QRow[], aNewestFirst: ARow[]): GlanceMetrics {
  const a = aNewestFirst.slice(0, 8);
  const ac = [...a].reverse(); // oldest → newest for sparklines

  const eq = (r: ARow) => (r.equity_share_capital ?? 0) + (r.reserves ?? 0);
  // FCF ≈ operating cash − capex; capex proxied by the investing OUTFLOW
  // (negative cfi). If cfi is positive we assume no capex drag that year.
  const fcfOf = (r: ARow) =>
    r.cash_from_operating != null && r.cash_from_investing != null
      ? Math.round(r.cash_from_operating + Math.min(0, r.cash_from_investing))
      : null;

  // Flow series (annual)
  const salesSeries = ac.map((r) => r.sales);
  const npSeries = ac.map((r) => r.net_profit);
  const opmSeries = ac.map((r) =>
    r.sales && r.sales !== 0 && r.operating_profit != null ? r1((r.operating_profit / r.sales) * 100) : null,
  );
  const npmSeries = ac.map((r) =>
    r.sales && r.sales !== 0 && r.net_profit != null ? r1((r.net_profit / r.sales) * 100) : null,
  );
  // Returns / leverage / cash series (annual)
  const roeSeries = ac.map((r) => (eq(r) > 0 && r.net_profit != null ? r1((r.net_profit / eq(r)) * 100) : null));
  const deSeries = ac.map((r) => (eq(r) > 0 && r.borrowings != null ? r2(r.borrowings / eq(r)) : null));
  const fcfSeries = ac.map(fcfOf);
  const cfoSeries = ac.map((r) => r.cash_from_operating);
  const nwSeries = ac.map((r) => (eq(r) > 0 ? Math.round(eq(r)) : null));

  // ── Derived efficiency / returns / leverage (annual) ──────────────────────
  // EBIT ≈ PBT + interest (matches how Screener computes RoCE); EBITDA ≈
  // operating_profit (Screener's "Operating Profit" is already pre-depreciation
  // and pre-interest). Every input is a populated fundamentals_annual column.
  const ebitOf = (r: ARow) =>
    r.profit_before_tax != null && r.interest != null ? r.profit_before_tax + r.interest : null;
  const capEmployedOf = (r: ARow) => {
    const ce = eq(r) + (r.borrowings ?? 0);
    return ce > 0 ? ce : null;
  };
  const roceSeries = ac.map((r) => {
    const e = ebitOf(r);
    const ce = capEmployedOf(r);
    return e != null && ce != null ? r1((e / ce) * 100) : null;
  });
  const roaSeries = ac.map((r) =>
    r.total_assets && r.total_assets > 0 && r.net_profit != null ? r1((r.net_profit / r.total_assets) * 100) : null,
  );
  const assetTurnSeries = ac.map((r) =>
    r.total_assets && r.total_assets > 0 && r.sales != null ? r2(r.sales / r.total_assets) : null,
  );
  // Inventory days over cost base (expenses ≈ COGS proxy).
  const invDaysSeries = ac.map((r) =>
    r.expenses && r.expenses > 0 && r.inventory != null ? Math.round((r.inventory / r.expenses) * 365) : null,
  );
  const dsoSeries = ac.map((r) =>
    r.sales && r.sales > 0 && r.receivables != null ? Math.round((r.receivables / r.sales) * 365) : null,
  );
  // Working-capital days ≈ (receivables + inventory) / sales — a directional
  // cash-conversion read; payables aren't a clean column so this is gross of them.
  const wcDaysSeries = ac.map((r) =>
    r.sales && r.sales > 0 && r.receivables != null && r.inventory != null
      ? Math.round(((r.receivables + r.inventory) / r.sales) * 365)
      : null,
  );
  const netDebtEbitdaSeries = ac.map((r) => {
    const ebitda = r.operating_profit;
    if (ebitda == null || ebitda <= 0) return null;
    const netDebt = (r.borrowings ?? 0) - (r.cash_and_bank ?? 0);
    return r2(netDebt / ebitda);
  });
  const equityToAssetsSeries = ac.map((r) =>
    r.total_assets && r.total_assets > 0 ? r1((eq(r) / r.total_assets) * 100) : null,
  );
  // Capex intensity — capex ≈ Δ(net_block + cwip) + depreciation, over sales.
  // Needs the prior year, so the oldest point is null.
  const capexIntensitySeries = ac.map((r, i) => {
    if (i === 0) return null;
    const p = ac[i - 1];
    if (r.net_block == null || p.net_block == null || r.depreciation == null || !r.sales || r.sales <= 0) return null;
    const capex = r.net_block - p.net_block + r.depreciation + ((r.cwip ?? 0) - (p.cwip ?? 0));
    return capex > 0 ? r1((capex / r.sales) * 100) : 0;
  });

  // YoY for the two headline flow metrics: latest full year vs the prior year
  // (rows 0 and 1 in the newest-first array). Guard sign flips.
  const latestA = a[0];
  const priorA = a[1];
  const yoy = (now: number | null | undefined, then: number | null | undefined): number | null => {
    if (now == null || then == null || then <= 0) return null;
    return r1((now / then - 1) * 100);
  };

  const last = <T,>(xs: (T | null)[]): T | null => {
    for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return xs[i] as T;
    return null;
  };

  return {
    sales: { value: latestA?.sales ?? null, yoy: yoy(latestA?.sales, priorA?.sales), series: salesSeries },
    net_profit: { value: latestA?.net_profit ?? null, yoy: yoy(latestA?.net_profit, priorA?.net_profit), series: npSeries },
    opm: { value: last(opmSeries), yoy: null, series: opmSeries },
    npm: { value: last(npmSeries), yoy: null, series: npmSeries },
    roe: { value: last(roeSeries), yoy: null, series: roeSeries },
    de: { value: last(deSeries), yoy: null, series: deSeries },
    fcf: { value: last(fcfSeries), yoy: null, series: fcfSeries },
    cfo: { value: last(cfoSeries), yoy: null, series: cfoSeries },
    networth: { value: last(nwSeries), yoy: null, series: nwSeries },
    roce: { value: last(roceSeries), yoy: null, series: roceSeries },
    roa: { value: last(roaSeries), yoy: null, series: roaSeries },
    asset_turnover: { value: last(assetTurnSeries), yoy: null, series: assetTurnSeries },
    inv_days: { value: last(invDaysSeries), yoy: null, series: invDaysSeries },
    dso: { value: last(dsoSeries), yoy: null, series: dsoSeries },
    wc_days: { value: last(wcDaysSeries), yoy: null, series: wcDaysSeries },
    net_debt_ebitda: { value: last(netDebtEbitdaSeries), yoy: null, series: netDebtEbitdaSeries },
    capex_intensity: { value: last(capexIntensitySeries), yoy: null, series: capexIntensitySeries },
    equity_to_assets: { value: last(equityToAssetsSeries), yoy: null, series: equityToAssetsSeries },
  };
}

// ── Presentation config (client) ────────────────────────────────────────────
export type MetricFormat = "cr" | "pct" | "ratio" | "days";

export const METRIC_META: Record<MetricKey, { label: string; format: MetricFormat; inverse?: boolean; help: string }> = {
  sales:      { label: "Revenue",   format: "cr",    help: "Annual revenue (latest full year), with YoY growth." },
  net_profit: { label: "Net profit", format: "cr",   help: "Annual net profit, with YoY growth." },
  opm:        { label: "OPM",       format: "pct",   help: "Operating margin — operating profit ÷ revenue." },
  npm:        { label: "NPM",       format: "pct",   help: "Net margin — net profit ÷ revenue." },
  roe:        { label: "ROE",       format: "pct",   help: "Return on equity (annual) — net profit ÷ net worth." },
  de:         { label: "D/E",       format: "ratio", inverse: true, help: "Debt-to-equity (annual). Lower is safer." },
  fcf:        { label: "FCF",       format: "cr",    help: "Free cash flow (annual, estimated): operating cash − capex." },
  cfo:        { label: "Op. cash",  format: "cr",    help: "Operating cash flow (annual)." },
  networth:   { label: "Net worth", format: "cr",    help: "Shareholders' equity (annual): share capital + reserves." },
  roce:            { label: "ROCE",        format: "pct",   help: "Return on capital employed — EBIT ÷ (equity + debt)." },
  roa:             { label: "ROA",         format: "pct",   help: "Return on assets — net profit ÷ total assets." },
  asset_turnover:  { label: "Asset turn",  format: "ratio", help: "Asset turnover — sales ÷ total assets. Higher = more sales per rupee of assets." },
  inv_days:        { label: "Inventory days", format: "days", inverse: true, help: "Inventory ÷ cost base × 365. Lower = leaner." },
  dso:             { label: "Debtor days", format: "days",  inverse: true, help: "Receivables ÷ sales × 365. Lower = faster collection." },
  wc_days:         { label: "Working-cap days", format: "days", inverse: true, help: "(Receivables + inventory) ÷ sales × 365. Lower = less capital tied up." },
  net_debt_ebitda: { label: "Net debt/EBITDA", format: "ratio", inverse: true, help: "(Borrowings − cash) ÷ EBITDA. Lower = less leveraged." },
  capex_intensity: { label: "Capex intensity", format: "pct", inverse: true, help: "Capex ÷ sales. Lower = less reinvestment drag on cash." },
  equity_to_assets:{ label: "Equity/assets", format: "pct",  help: "Shareholders' equity ÷ total assets. Higher = bigger cushion." },
};

/** Map a scorecard quality formula_name to the glance metric it displays, or
 *  null when the formula has no clean value+series (composites, thresholds,
 *  consistency scores, ratio drivers) — those belong in the judgment strip, not
 *  as a value row. Strict 1:1 so the row label matches the driving formula. */
export function scorecardMetricKey(formula: string): MetricKey | null {
  const f = formula;
  if (f.startsWith("op_margin") || f.startsWith("ebitda_margin")) return "opm";
  if (f.startsWith("rev_cagr")) return "sales";
  if (f.startsWith("np_cagr")) return "net_profit";
  if (f === "debt_equity") return "de";
  if (f.startsWith("roe_excess") || /^roe_(3y|5y|7y|latest)$/.test(f)) return "roe";
  if (f.startsWith("book_value_cagr")) return "networth";
  if (f.startsWith("roce")) return "roce";
  if (f === "roa_3y") return "roa";
  if (f === "asset_turnover") return "asset_turnover";
  if (f === "inv_days") return "inv_days";
  if (f === "dso") return "dso";
  if (f === "wc_days") return "wc_days";
  if (f === "net_debt_ebitda") return "net_debt_ebitda";
  if (f.startsWith("capex_intensity")) return "capex_intensity";
  if (f === "equity_to_assets") return "equity_to_assets";
  return null;
}

/** Turn a cluster's quality scorecard ({formula: weight}) into the ordered,
 *  de-duplicated metric rows to show — highest-weighted formulas first, keeping
 *  only those that resolve to a displayable value+series. */
export function scorecardGlanceKeys(quality: Record<string, number> | null | undefined, max = 6): MetricKey[] {
  if (!quality) return [];
  const entries = Object.entries(quality).sort((a, b) => b[1] - a[1]);
  const out: MetricKey[] = [];
  const seen = new Set<MetricKey>();
  for (const [formula] of entries) {
    const k = scorecardMetricKey(formula);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Column set + a one-line rationale, chosen by sector family. Financials drop
 *  OPM/D-E/FCF (misleading for lenders) and relabel revenue as "Income". */
export function metricsForSector(sector: string | null): {
  keys: MetricKey[];
  salesLabel: string;
  note: string;
} {
  const s = (sector ?? "").toLowerCase();
  if (s.includes("financ")) {
    return {
      keys: ["sales", "net_profit", "npm", "roe", "networth"],
      salesLabel: "Total income",
      note: "Lenders — leverage & cash-flow ratios omitted (deposits/borrowings are their raw material). Asset quality (GNPA / CASA / NIM) is not in the dataset and not shown.",
    };
  }
  if (s.includes("real estate") || s.includes("infra")) {
    return {
      keys: ["sales", "net_profit", "opm", "de", "cfo"],
      salesLabel: "Revenue",
      note: "Capital-intensive — read Debt/Equity as a structural level, not an alarm.",
    };
  }
  if (s.includes("energy") || s.includes("utilit")) {
    return {
      keys: ["sales", "net_profit", "opm", "roe", "de"],
      salesLabel: "Revenue",
      note: "Asset-heavy — steady debt is normal; watch margins and returns.",
    };
  }
  // Industrials, Materials, Consumer, Healthcare, Tech, Diversified
  return {
    keys: ["sales", "net_profit", "opm", "npm", "roe", "fcf"],
    salesLabel: "Revenue",
    note: "",
  };
}

/** Format a metric value for display. */
export function fmtMetric(v: number | null, fmt: MetricFormat): string {
  if (v == null) return "—";
  if (fmt === "pct") return `${v.toFixed(1)}%`;
  if (fmt === "ratio") return v.toFixed(2);
  if (fmt === "days") return `${Math.round(v)} d`;
  // cr — compact large numbers to "L Cr" (lakh crore)
  if (Math.abs(v) >= 100_000) return `₹${(v / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L Cr`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}
