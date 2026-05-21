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
  page: number;
};

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
  veteran: "Long-term Compounder",
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
    page: Math.max(1, Number(get("page")) || 1),
  };
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
  if (p.page && p.page > 1) q.set("page", String(p.page));
  const s = q.toString();
  return s ? "?" + s : "";
}
