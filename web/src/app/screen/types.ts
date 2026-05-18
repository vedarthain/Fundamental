export type Weights = { q: number; v: number; m: number };

export const PRESETS: Record<string, Weights & { label: string }> = {
  balanced:    { label: "Balanced",    q: 40, v: 30, m: 30 },
  compounders: { label: "Compounders", q: 50, v: 30, m: 20 },
  value:       { label: "Value",       q: 30, v: 50, m: 20 },
  momentum:    { label: "Momentum",    q: 30, v: 20, m: 50 },
};

export const PAGE_SIZE = 50;

export type ScreenParams = {
  weights: Weights;
  preset: string;
  page: number;
};

export function parseParams(sp: URLSearchParams | Record<string, string | undefined>): ScreenParams {
  const get = (k: string): string | null => {
    if (sp instanceof URLSearchParams) return sp.get(k);
    const v = sp[k]; return v == null ? null : v;
  };
  const presetKey = get("preset") ?? "balanced";
  const preset = PRESETS[presetKey] ? presetKey : "balanced";
  const base = PRESETS[preset];
  const wq = clamp(get("q"), base.q);
  const wv = clamp(get("v"), base.v);
  const wm = clamp(get("m"), base.m);
  const sum = wq + wv + wm;
  const norm: Weights = sum > 0
    ? { q: Math.round((wq / sum) * 100), v: Math.round((wv / sum) * 100), m: 100 - Math.round((wq / sum) * 100) - Math.round((wv / sum) * 100) }
    : { q: 40, v: 30, m: 30 };
  return {
    weights: norm,
    preset,
    page: Math.max(1, Number(get("page")) || 1),
  };
}

function clamp(v: string | null, fallback: number): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
}
