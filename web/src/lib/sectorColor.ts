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

/**
 * Partner hue for the INDUSTRY name, one per sector index. Hand-picked rather
 * than derived as "palette[i + k]": every fixed offset eventually pairs slate
 * with grey (indices 4 and 8), which are the two hues a reader cannot tell
 * apart. Each pair below is visibly distinct at 12px.
 */
const CONTRAST_FOR = [
  PALETTE[5], // Financials blue      → amber
  PALETTE[7], // Tech violet          → gold
  PALETTE[6], // Healthcare cyan      → fuchsia
  PALETTE[4], // Consumer pink        → slate
  PALETTE[7], // Industrials slate    → gold
  PALETTE[2], // Materials amber      → cyan
  PALETTE[4], // Real Estate fuchsia  → slate
  PALETTE[1], // Energy gold          → violet
  PALETTE[6], // Diversified grey     → fuchsia
] as const;

const BY_SECTOR: Record<string, number> = {
  "Financials": 0,
  "Tech & Communication": 1,
  "Healthcare": 2,
  "Consumer": 3,
  "Industrials": 4,
  "Materials": 5,
  "Real Estate & Infra": 6,
  "Energy & Utilities": 7,
  "Diversified": 8,
};

/** Palette slot for a sector name. Unknown names hash onto the same ring rather
 *  than collapsing to a default, so a renamed sector keeps a stable colour. */
function slot(name: string | null | undefined): number {
  const key = (name ?? "").trim();
  if (!key) return 8;
  const hit = BY_SECTOR[key];
  if (hit != null) return hit;
  // FNV-1a — same string always lands on the same hue, across reloads and
  // across machines.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % PALETTE.length;
}

/** Stable hue for a sector name. */
export function sectorColor(name: string | null | undefined): string {
  return PALETTE[slot(name)];
}

/**
 * Hue for the industry name, given its SECTOR. Deliberately not the sector's own
 * colour: "Materials · Agrochemicals & Fertilizers" in one hue reads as a single
 * run of text, and the industry — the thing that changes as you page — is the
 * part worth spotting first. Still keyed to the sector, so the pairing stays
 * constant for every industry inside it.
 */
export function industryColor(sectorName: string | null | undefined): string {
  return CONTRAST_FOR[slot(sectorName)];
}

/** The same hue at low opacity, for chips and backgrounds. `pct` is a
 *  percentage of the hue mixed into transparent. */
export function sectorTint(name: string | null | undefined, pct = 12): string {
  return `color-mix(in srgb, ${sectorColor(name)} ${pct}%, transparent)`;
}
