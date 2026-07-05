/** Shared types + URL-param helpers for the screener. */

export type Weights = { q: number; v: number; m: number };

export type ScreenerParams = {
  clusters: string[];
  metas: string[];
  tiers: string[];
  caps: string[];
  index: IndexKey;           // single-select; "" means no index filter
  minQ: number;
  minV: number;
  minM: number;
  minC: number;
  // Range filters on raw fundamental metrics.  null = no filter on that bound.
  // Percentage inputs (roe, divYld, opm, ret12m) are stored as the USER value
  // (e.g. 15 for 15%) and converted to decimal at the SQL boundary.
  peMax:        number | null;
  pbMax:        number | null;
  roeMin:       number | null;   // %
  divYldMin:    number | null;   // %
  opmMin:       number | null;   // %
  ret12mMin:    number | null;   // %
  mcapMin:      number | null;   // ₹ Cr
  mcapMax:      number | null;   // ₹ Cr
  sort: SortParam;           // column to sort by (whitelisted)
  dir: "asc" | "desc";       // sort direction
  density: "compact" | "comfortable";  // row spacing toggle
  page: number;
  /** Rows per sector when grouped (multi-sector view).  Also used as the
   *  flat page size when a single industry is selected.  Whitelisted to
   *  10/20/50 so a malformed URL can't blow up the query. */
  perSector: 10 | 20 | 50;
};

export const PER_SECTOR_OPTIONS = [10, 20, 50] as const;
export const DEFAULT_PER_SECTOR: 10 | 20 | 50 = 20;

/** Columns the user can sort on. Whitelisted so a malformed URL param can
 * never reach the raw SQL — page.tsx maps each value to a column expression. */
export const SORT_KEYS = [
  "score", "symbol", "mcap", "ltp", "pe", "pb",
  "roe", "ret12m", "divyld", "opm",
  "npcagr", "revcagr",
  "q", "v", "m",
] as const;
export type SortParam = (typeof SORT_KEYS)[number];

export const DEFAULT_SORT: SortParam = "score";
export const DEFAULT_DIR: "asc" | "desc" = "desc";
export const DEFAULT_DENSITY: "compact" | "comfortable" = "comfortable";

/** Index membership filter on /discover. "All" = "" (no filter applied). */
export const INDEX_KEYS = ["", "nifty50", "nifty200", "nifty500"] as const;
export type IndexKey = (typeof INDEX_KEYS)[number];

export const INDEX_LABELS: Record<IndexKey, string> = {
  "":         "All",
  nifty50:    "Nifty 50",
  nifty200:   "Nifty 200",
  nifty500:   "Nifty 500",
};

/** Map an IndexKey to the boolean column on app.universe that flags membership. */
export const INDEX_COLUMNS: Record<Exclude<IndexKey, "">, string> = {
  nifty50:  "is_nifty50",
  nifty200: "is_nifty200",
  nifty500: "is_nifty500",
};

export const PRESETS: Record<string, Weights & { label: string }> = {
  balanced:    { label: "Balanced",     q: 40, v: 30, m: 30 },
  compounders: { label: "Compounders",  q: 50, v: 30, m: 20 },
  value:       { label: "Value",        q: 30, v: 50, m: 20 },
  momentum:    { label: "Momentum",     q: 30, v: 20, m: 50 },
};

export const TIERS = ["veteran", "mature", "mid", "new"] as const;
export const TIER_LABELS: Record<string, string> = {
  veteran: "Long-established",
  mature: "Established",
  mid: "Emerging",
  new: "New Listing",
};

export const MKT_CAPS = ["large_cap", "mid_cap", "small_cap", "micro_cap"] as const;
export const MKT_CAP_LABELS: Record<string, string> = {
  large_cap: "Large cap",
  mid_cap: "Mid cap",
  small_cap: "Small cap",
  micro_cap: "Micro cap",
};

export const PAGE_SIZE = 50;

export function parseParams(sp: URLSearchParams | Record<string, string | undefined>): ScreenerParams {
  const get = (k: string): string | null => {
    if (sp instanceof URLSearchParams) return sp.get(k);
    const v = sp[k];
    return v == null ? null : v;
  };
  const rawIndex = (get("index") ?? "").toLowerCase();
  const index: IndexKey = (INDEX_KEYS as readonly string[]).includes(rawIndex)
    ? (rawIndex as IndexKey)
    : "";
  const rawSort = (get("sort") ?? "").toLowerCase();
  const sort: SortParam = (SORT_KEYS as readonly string[]).includes(rawSort)
    ? (rawSort as SortParam)
    : DEFAULT_SORT;
  const rawDir = (get("dir") ?? "").toLowerCase();
  const dir: "asc" | "desc" = rawDir === "asc" ? "asc" : DEFAULT_DIR;
  const rawDensity = (get("density") ?? "").toLowerCase();
  const density: "compact" | "comfortable" = rawDensity === "compact" ? "compact" : DEFAULT_DENSITY;
  return {
    clusters: splitList(get("clusters")),
    metas: splitList(get("metas")),
    tiers: splitList(get("tiers")),
    caps: splitList(get("caps")),
    index,
    minQ: clampInt(get("minq"), 0, 100, 0),
    minV: clampInt(get("minv"), 0, 100, 0),
    minM: clampInt(get("minm"), 0, 100, 0),
    minC: clampInt(get("minc"), 0, 100, 0),
    peMax:     parseFloatOrNull(get("pemax")),
    pbMax:     parseFloatOrNull(get("pbmax")),
    roeMin:    parseFloatOrNull(get("roemin")),
    divYldMin: parseFloatOrNull(get("dymin")),
    opmMin:    parseFloatOrNull(get("opmmin")),
    ret12mMin: parseFloatOrNull(get("r12min")),
    mcapMin:   parseFloatOrNull(get("mcmin")),
    mcapMax:   parseFloatOrNull(get("mcmax")),
    sort,
    dir,
    density,
    page: Math.max(1, Number(get("page")) || 1),
    perSector: ((): 10 | 20 | 50 => {
      const raw = Number(get("ps")) || DEFAULT_PER_SECTOR;
      return (PER_SECTOR_OPTIONS as readonly number[]).includes(raw)
        ? (raw as 10 | 20 | 50)
        : DEFAULT_PER_SECTOR;
    })(),
  };
}

function parseFloatOrNull(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function splitList(s: string | null): string[] {
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function clampInt(v: string | null, min: number, max: number, fallback: number): number {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function paramsToQuery(p: Partial<ScreenerParams>): string {
  const q = new URLSearchParams();
  if (p.clusters?.length) q.set("clusters", p.clusters.join(","));
  if (p.metas?.length) q.set("metas", p.metas.join(","));
  if (p.tiers?.length) q.set("tiers", p.tiers.join(","));
  if (p.caps?.length) q.set("caps", p.caps.join(","));
  if (p.index) q.set("index", p.index);
  if (p.minQ) q.set("minq", String(p.minQ));
  if (p.minV) q.set("minv", String(p.minV));
  if (p.minM) q.set("minm", String(p.minM));
  if (p.minC) q.set("minc", String(p.minC));
  if (p.peMax     != null) q.set("pemax",  String(p.peMax));
  if (p.pbMax     != null) q.set("pbmax",  String(p.pbMax));
  if (p.roeMin    != null) q.set("roemin", String(p.roeMin));
  if (p.divYldMin != null) q.set("dymin",  String(p.divYldMin));
  if (p.opmMin    != null) q.set("opmmin", String(p.opmMin));
  if (p.ret12mMin != null) q.set("r12min", String(p.ret12mMin));
  if (p.mcapMin   != null) q.set("mcmin",  String(p.mcapMin));
  if (p.mcapMax   != null) q.set("mcmax",  String(p.mcapMax));
  if (p.sort && p.sort !== DEFAULT_SORT) q.set("sort", p.sort);
  if (p.dir && p.dir !== DEFAULT_DIR) q.set("dir", p.dir);
  if (p.density && p.density !== DEFAULT_DENSITY) q.set("density", p.density);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  if (p.perSector && p.perSector !== DEFAULT_PER_SECTOR) q.set("ps", String(p.perSector));
  const s = q.toString();
  return s ? "?" + s : "";
}

/** Pre-built filter combinations users can apply with one click.
 *  Quick way to surface "compounder" / "value" / "growth" stocks without
 *  having to manually configure 5+ filters every time.
 *  Each preset clears the existing min/range filters before applying its own
 *  so they don't accumulate from a previous session.
 */
export const FILTER_PRESETS: Record<string, {
  label: string;
  description: string;
  filters: Partial<ScreenerParams>;
}> = {
  compounders: {
    label: "Compounders",
    description: "Long-term quality: ROE ≥ 18%, op margin ≥ 15%, Q-score ≥ 70",
    filters: {
      roeMin: 18, opmMin: 15, minQ: 70,
      // Reset other filters
      peMax: null, pbMax: null, divYldMin: null, ret12mMin: null,
      mcapMin: null, mcapMax: null, minV: 0, minM: 0, minC: 0,
    },
  },
  value: {
    label: "Value",
    description: "Cheap with floor: P/E ≤ 20, ROE ≥ 12%, V-score ≥ 70",
    filters: {
      peMax: 20, roeMin: 12, minV: 70,
      pbMax: null, divYldMin: null, opmMin: null, ret12mMin: null,
      mcapMin: null, mcapMax: null, minQ: 0, minM: 0, minC: 0,
    },
  },
  growth: {
    label: "Growth",
    description: "Momentum + earnings: 12M return ≥ 15%, M-score ≥ 70",
    filters: {
      ret12mMin: 15, minM: 70,
      peMax: null, pbMax: null, roeMin: null, divYldMin: null, opmMin: null,
      mcapMin: null, mcapMax: null, minQ: 0, minV: 0, minC: 0,
    },
  },
  dividend: {
    label: "Dividend",
    description: "Income with quality: yield ≥ 3%, ROE ≥ 12%",
    filters: {
      divYldMin: 3, roeMin: 12,
      peMax: null, pbMax: null, opmMin: null, ret12mMin: null,
      mcapMin: null, mcapMax: null, minQ: 0, minV: 0, minM: 0, minC: 0,
    },
  },
  quality_value: {
    label: "Quality + Value",
    description: "Quality ≥ 55 AND Valuation ≥ 55 within peer cluster — strong businesses at fair prices",
    filters: {
      minQ: 55, minV: 55,
      peMax: null, pbMax: null, roeMin: null, divYldMin: null, opmMin: null, ret12mMin: null,
      mcapMin: null, mcapMax: null, minM: 0, minC: 0,
    },
  },
};
