/**
 * sectorColor — one stable hue per meta-cluster (sector).
 *
 * WHY SECTOR AND NOT INDUSTRY. The thing being colour-coded on screen is an
 * industry name ("Agrochemicals & Fertilizers"), but the colour is keyed to its
 * SECTOR ("Materials"). There are ~49 industries and nine sectors; 49 hues are
 * not distinguishable from one another, so a per-industry palette would encode
 * no information — it would just be decoration that changes every time you page.
 * Nine are learnable, and the useful question while paging the scanner is "am I
 * still in Materials", which is exactly what a sector tint answers.
 *
 * PALETTE CONSTRAINTS. No greens and no reds: every surface that renders these
 * names also renders returns in --color-delta-up / --color-delta-down, and a
 * green sector label sitting beside a red price move reads as a signal it isn't.
 * Hues are mid-dark (600-weight range) so they clear 4.5:1 on the light paper
 * background without going muddy.
 *
 * Unknown names fall through to a hash over the same palette rather than to a
 * default grey: a sector renamed in app.meta_cluster should still be tinted
 * consistently from the first render, not silently lose its colour.
 */

/** Nine hues, deliberately non-adjacent so neighbours in display_order don't
 *  land on neighbouring hues. Order here is display_order from app.meta_cluster. */
const PALETTE = [
  "#2563EB", // blue
  "#7C3AED", // violet
  "#0891B2", // cyan
  "#DB2777", // pink
  "#475569", // slate
  "#B45309", // amber
  "#C026D3", // fuchsia
  "#CA8A04", // gold
  "#64748B", // grey
] as const;

const BY_SECTOR: Record<string, string> = {
  "Financials": PALETTE[0],
  "Tech & Communication": PALETTE[1],
  "Healthcare": PALETTE[2],
  "Consumer": PALETTE[3],
  "Industrials": PALETTE[4],
  "Materials": PALETTE[5],
  "Real Estate & Infra": PALETTE[6],
  "Energy & Utilities": PALETTE[7],
  "Diversified": PALETTE[8],
};

/** Stable hue for a sector name. Null/unknown names still get a colour. */
export function sectorColor(name: string | null | undefined): string {
  const key = (name ?? "").trim();
  if (!key) return PALETTE[8];
  const hit = BY_SECTOR[key];
  if (hit) return hit;
  // FNV-1a over the name — same string always lands on the same hue, across
  // reloads and across machines.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PALETTE[(h >>> 0) % PALETTE.length];
}

/** The same hue at low opacity, for chips and backgrounds. `pct` is a
 *  percentage of the hue mixed into transparent. */
export function sectorTint(name: string | null | undefined, pct = 12): string {
  return `color-mix(in srgb, ${sectorColor(name)} ${pct}%, transparent)`;
}
