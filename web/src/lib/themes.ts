/**
 * themes.ts — the "Themes" scanner tab: a real NSE thematic index next to its
 * constituent stocks, so you can read the BEHAVIOUR of a group under one theme.
 *
 * The per-stock scanners are bottom-up (single names); Sectors/Peers roll the
 * scoring panel up to loose groups. Themes is the third lens: an ACTUAL traded
 * index (Nifty Auto, Bank, IT, …) as the benchmark line, with its published
 * constituents ranked by how they behave RELATIVE to that index — excess return
 * vs. the theme — plus the quality/value/momentum read so a name that's beating
 * the theme on fundamentals stands apart from one just riding the tide.
 *
 * Scope: NSE thematic/sector indices that have BOTH a published constituent
 * list (app.index_constituent) AND deep price history
 * (app.market_index_history, ~20y via Upstox). No synthetic baskets.
 *
 * Data:
 *   - index line + index returns  ← app.market_index_history (index OHLC)
 *   - constituents + their scores ← app.index_constituent ⋈ cluster_stocks_panel_cache
 *
 * Excess return is computed only for the fixed windows the panel cache carries
 * (1w / 1m / 1y): constituent ret minus the index's own ret over the same span.
 * That sidesteps a per-constituent price fetch entirely — both sides come from
 * two cheap app-DB queries, no golden roundtrip.
 *
 * NOTE (depth): index history is currently shallow (~1y). Once the Upstox index
 * backfill lands it deepens to ~20y; nothing here caps it — the query pulls the
 * last ~5y (matched to stock-candle depth) and the client rebases within that.
 */

import { sql } from "@/lib/db";

// The themes. `code` is our internal index_code (matches both tables);
// `label` is the short chip label; the long name comes from the history row.
export const THEME_META: readonly { code: string; label: string }[] = [
  { code: "NIFTYAUTO", label: "Auto" },
  { code: "NIFTYBANK", label: "Bank" },
  { code: "NIFTYENERGY", label: "Energy" },
  { code: "NIFTYFMCG", label: "FMCG" },
  { code: "NIFTYIT", label: "IT" },
  { code: "NIFTYMETAL", label: "Metal" },
  { code: "NIFTYPHARMA", label: "Pharma" },
  { code: "NIFTYREALTY", label: "Realty" },
  { code: "NIFTYFINSERVICE", label: "Fin Services" },
  { code: "NIFTYFINSRV2550", label: "Fin 25/50" },
  { code: "NIFTYHEALTHCARE", label: "Healthcare" },
  { code: "NIFTYCONSDUR", label: "Cons Durables" },
  { code: "NIFTYOILGAS", label: "Oil & Gas" },
  { code: "NIFTYPVTBANK", label: "Pvt Bank" },
  { code: "NIFTYPSUBANK", label: "PSU Bank" },
  { code: "NIFTYMEDIA", label: "Media" },
  { code: "NIFTYMIDSMALLHEALTH", label: "MidSm Health" },
];

const THEME_CODES = THEME_META.map((t) => t.code);

/** Fixed windows we can compute excess return for (panel-cache columns). */
export type ThemeWindow = "1w" | "1m" | "1y";

export type ThemeConstituent = {
  symbol: string;
  name: string | null;
  compositePct: number | null;
  qualityPct: number | null;
  valuationPct: number | null;
  momentumPct: number | null;
  ret1w: number | null;
  ret1m: number | null;
  ret1y: number | null;
  marketCapCr: number | null;
  price: number | null;
};

export type ThemeIndexPoint = { date: string; close: number };

export type Theme = {
  code: string;
  label: string;
  /** Full NSE name (e.g. "Nifty Auto"), from the history row. */
  displayName: string | null;
  /** Ascending index close series (last ~5y), for the rebased header line. */
  series: ThemeIndexPoint[];
  /** The index's OWN return over each window — the benchmark to beat. */
  idxRet1w: number | null;
  idxRet1m: number | null;
  idxRet1y: number | null;
  constituents: ThemeConstituent[];
};

export type ThemesData = {
  /** Panel-cache snapshot the constituent scores are from. */
  snapDate: string | null;
  /** Latest index-history date (freshness stamp; may lag the panel). */
  indexLastDate: string | null;
  themes: Theme[];
};

type PanelJoinRow = {
  index_code: string;
  symbol: string;
  company_name: string | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
  market_cap_cr: number | null;
  current_price: number | null;
};

type HistRow = {
  index_code: string;
  date: string;
  close: number | null;
  display_name: string | null;
};

// Approx trading-day offsets for each window. Index history has ~250
// trading days/yr, so these back-offsets read the close ~N days ago.
const WINDOW_OFFSET: Record<ThemeWindow, number> = { "1w": 5, "1m": 21, "1y": 250 };

/** Return over `offset` trading days from an ascending close series (as %). */
function retOverOffset(series: ThemeIndexPoint[], offset: number): number | null {
  const n = series.length;
  if (n < 2) return null;
  const last = series[n - 1].close;
  const i = n - 1 - offset;
  const prev = series[i >= 0 ? i : 0].close;
  if (!prev || !last) return null;
  return (last / prev - 1) * 100;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Load all themes: index line + returns, and constituents with scores.
 * Two app-DB queries; everything else is a JS rollup. Returns empty themes
 * (never throws) so the tab degrades to "no data yet" rather than 500-ing.
 */
export async function loadThemes(): Promise<ThemesData> {
  // Latest panel snapshot — the scores/returns we join constituents to.
  const snapRows = await sql<{ d: string | null }[]>`
    SELECT MAX(snapshot_date)::text AS d FROM app.cluster_stocks_panel_cache
  `;
  const snapDate = snapRows[0]?.d ?? null;

  // Constituents ⋈ panel cache (LEFT JOIN: a constituent with no score row
  // still shows, just without chips). One query for all 8 themes.
  const panelRows = snapDate
    ? await sql<PanelJoinRow[]>`
        SELECT ic.index_code,
               ic.symbol,
               p.company_name,
               p.composite_pct,
               p.quality_pct,
               p.valuation_pct,
               p.momentum_pct,
               -- panel-cache returns are stored as FRACTIONS (0.09 = +9%);
               -- scale to percent so they're apples-to-apples with the index
               -- return (retOverOffset already returns percent). See rotation.ts.
               (p.ret_1w::float8 * 100) AS ret_1w,
               (p.ret_1m::float8 * 100) AS ret_1m,
               (p.ret_1y::float8 * 100) AS ret_1y,
               p.market_cap_cr,
               p.current_price
        FROM app.index_constituent ic
        LEFT JOIN app.cluster_stocks_panel_cache p
          ON p.symbol = ic.symbol AND p.snapshot_date = ${snapDate}
        WHERE ic.index_code = ANY(${THEME_CODES})
        ORDER BY ic.index_code, p.composite_pct DESC NULLS LAST
      `
    : [];

  // Index history — last ~5y per theme (matched to stock-candle depth; the
  // client never rebases beyond what stock candles can overlay).
  const histRows = await sql<HistRow[]>`
    SELECT index_code, date::text AS date, close, display_name
    FROM app.market_index_history
    WHERE index_code = ANY(${THEME_CODES})
      AND date >= (
        SELECT COALESCE(MAX(date), CURRENT_DATE) - INTERVAL '5 years'
        FROM app.market_index_history WHERE index_code = ANY(${THEME_CODES})
      )
    ORDER BY index_code, date
  `;

  // Bucket history + constituents by index_code.
  const seriesByCode = new Map<string, ThemeIndexPoint[]>();
  const nameByCode = new Map<string, string | null>();
  let indexLastDate: string | null = null;
  for (const r of histRows) {
    const close = num(r.close);
    if (close == null) continue;
    if (!seriesByCode.has(r.index_code)) seriesByCode.set(r.index_code, []);
    seriesByCode.get(r.index_code)!.push({ date: r.date, close });
    if (r.display_name) nameByCode.set(r.index_code, r.display_name);
    if (!indexLastDate || r.date > indexLastDate) indexLastDate = r.date;
  }

  const consByCode = new Map<string, ThemeConstituent[]>();
  for (const r of panelRows) {
    if (!consByCode.has(r.index_code)) consByCode.set(r.index_code, []);
    consByCode.get(r.index_code)!.push({
      symbol: r.symbol,
      name: r.company_name,
      compositePct: num(r.composite_pct),
      qualityPct: num(r.quality_pct),
      valuationPct: num(r.valuation_pct),
      momentumPct: num(r.momentum_pct),
      ret1w: num(r.ret_1w),
      ret1m: num(r.ret_1m),
      ret1y: num(r.ret_1y),
      marketCapCr: num(r.market_cap_cr),
      price: num(r.current_price),
    });
  }

  const themes: Theme[] = THEME_META.map((meta) => {
    const series = seriesByCode.get(meta.code) ?? [];
    return {
      code: meta.code,
      label: meta.label,
      displayName: nameByCode.get(meta.code) ?? null,
      series,
      idxRet1w: retOverOffset(series, WINDOW_OFFSET["1w"]),
      idxRet1m: retOverOffset(series, WINDOW_OFFSET["1m"]),
      idxRet1y: retOverOffset(series, WINDOW_OFFSET["1y"]),
      constituents: consByCode.get(meta.code) ?? [],
    };
  });

  return { snapDate, indexLastDate, themes };
}
