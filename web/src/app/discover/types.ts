/** Shared types + URL-param helpers for the screener. */

export type Weights = { q: number; v: number; m: number };

export type ScreenerParams = {
  weights: Weights;
  preset: string;
  clusters: string[];
  metas: string[];
  tiers: string[];
  caps: string[];
  minQ: number;
  minV: number;
  minM: number;
  minC: number;
  page: number;
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
  const presetKey = (get("preset") || "balanced") as keyof typeof PRESETS;
  const preset = PRESETS[presetKey] ? presetKey : "balanced";
  const wq = clampInt(get("q"), 0, 100, PRESETS[preset].q);
  const wv = clampInt(get("v"), 0, 100, PRESETS[preset].v);
  const wm = clampInt(get("m"), 0, 100, PRESETS[preset].m);
  // Renormalize so weights sum to 100 (in case of stale URL)
  const sum = wq + wv + wm;
  const norm: Weights =
    sum > 0
      ? { q: Math.round((wq / sum) * 100), v: Math.round((wv / sum) * 100), m: 100 - Math.round((wq / sum) * 100) - Math.round((wv / sum) * 100) }
      : { q: 40, v: 30, m: 30 };

  return {
    weights: norm,
    preset,
    clusters: splitList(get("clusters")),
    metas: splitList(get("metas")),
    tiers: splitList(get("tiers")),
    caps: splitList(get("caps")),
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
  if (p.preset && p.preset !== "balanced") q.set("preset", p.preset);
  if (p.weights) {
    q.set("q", String(p.weights.q));
    q.set("v", String(p.weights.v));
    q.set("m", String(p.weights.m));
  }
  if (p.clusters?.length) q.set("clusters", p.clusters.join(","));
  if (p.metas?.length) q.set("metas", p.metas.join(","));
  if (p.tiers?.length) q.set("tiers", p.tiers.join(","));
  if (p.caps?.length) q.set("caps", p.caps.join(","));
  if (p.minQ) q.set("minq", String(p.minQ));
  if (p.minV) q.set("minv", String(p.minV));
  if (p.minM) q.set("minm", String(p.minM));
  if (p.minC) q.set("minc", String(p.minC));
  if (p.page && p.page > 1) q.set("page", String(p.page));
  const s = q.toString();
  return s ? "?" + s : "";
}
