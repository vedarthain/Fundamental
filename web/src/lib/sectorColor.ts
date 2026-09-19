/**
 * sectorColor — the two hues the scanner breadcrumb is written in.
 *
 * ONE HUE FOR EVERY SECTOR, by choice. This file used to hold nine hues, one
 * per meta-cluster, so that the tint answered "am I still inside Materials"
 * while paging. That was dropped deliberately: nine hues cycling as you page
 * read as noise rather than as a code, and the sector name is right there in
 * words. The colour's remaining job is smaller and it does it better — separate
 * the two halves of "Sector · Industry" so the line doesn't read as one run of
 * text, and mark both halves as the breadcrumb rather than as body copy.
 *
 * The consequence, stated plainly so nobody re-derives it as a bug: the hue no
 * longer carries information. Every sector is teal and every industry is purple.
 * If you ever want the sector family legible at a glance again, this is the file
 * to put the nine-hue palette back into, and `git log` has it.
 *
 * WHY THESE TWO. Teal is Healthcare's old hue, picked by eye out of the nine.
 * Purple sits far from it on the wheel, so the two halves separate at 12px.
 * Neither is green or red: every surface that renders these names also renders
 * returns in --color-delta-up / --color-delta-down, and a green sector label
 * beside a red price move reads as a signal it isn't. Both are mid-dark, so they
 * clear 4.5:1 on the light paper background without going muddy.
 *
 * The functions still take a sector name. They ignore it, but the call sites
 * read correctly and putting a palette back is a one-file change.
 */

/* The name parameters below are intentionally unused: the signatures are kept so
   call sites still read `sectorColor(activeSectorName)` and so restoring a real
   per-sector palette stays a one-file change. Dropping the parameters would make
   every call site a type error and turn that restoration into a refactor. */
/* eslint-disable @typescript-eslint/no-unused-vars */

/** Teal — was Healthcare's slot in the old nine-hue palette. */
const SECTOR_HUE = "#0891B2";

/** Purple. Far enough from teal that "Healthcare · Pharmaceuticals" reads as two
 *  things rather than one long phrase. */
const INDUSTRY_HUE = "#7C3AED";

/** Hue for a sector name. Constant — see the header. */
export function sectorColor(_name?: string | null): string {
  return SECTOR_HUE;
}

/** Hue for an industry name, given its sector. Constant — see the header. */
export function industryColor(_sectorName?: string | null): string {
  return INDUSTRY_HUE;
}

/** The sector hue at low opacity, for chips and backgrounds. `pct` is a
 *  percentage of the hue mixed into transparent. */
export function sectorTint(_name?: string | null, pct = 12): string {
  return `color-mix(in srgb, ${SECTOR_HUE} ${pct}%, transparent)`;
}
