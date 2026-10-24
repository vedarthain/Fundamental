/**
 * The derived half of the Verdict tab — reader for app.stock_evidence_sheet.
 *
 * A sheet is what the peer scan measured for a symbol nobody has written a
 * verdict for: rendered by template from the same evidence pack, by
 * build/verdicts/lib/sheet.py, loaded by scripts/evidence-sheet-load.py. See
 * db/migrations/0088_stock_evidence_sheet.sql for why it is a separate table
 * and why it deliberately has no verdict/confidence/trigger_text column.
 *
 * WHY THIS FILE IS NOT IN lib/verdict.ts
 *
 * Same reason 0088 is not a `kind` column. Three queries in lib/verdict.ts read
 * app.stock_verdict with no kind filter and mean "hand-written verdict" by it.
 * A sheet reader living in that file is one autocomplete away from being joined
 * into loadVerdictChips, which is how "384 verdicts" silently becomes "3,157".
 *
 * WHY THERE IS NO DRIFT COMPARISON HERE
 *
 * lib/verdict.ts compares a verdict's frozen evidence against live metrics
 * because a verdict's prose cannot be re-derived. A sheet can: it is a pure
 * function of (pack, template), so the honest response to a stale sheet is to
 * rebuild it, not to annotate it. Staleness is therefore enforced upstream, by
 * the coverage.evidence_sheets_current assertion in
 * etl/src/fundamental_etl/coverage.py, and the panel shows snapshot_date so a
 * reader can see which snapshot they are looking at. A drift table here would
 * invite the reader to mentally correct a row that should simply not exist.
 *
 * Fails soft on a missing table, same as loadVerdict, so a clone without 0088
 * renders the empty state rather than a 500.
 */

import { sql } from "@/lib/db";

/**
 * One row of the peer-rank table, as sheet.render_table emits it.
 *
 * `rank` and `of` are STRINGS, not numbers — "15th" and "34". They arrive
 * pre-formatted because check_sheet.py traces every rendered numeric token back
 * to a pack field, and re-deriving an ordinal in TypeScript would put a number
 * on the page that no provenance check ever saw. Do not "fix" these to numbers.
 */
export type SheetRankRow = {
  metric: string;
  label: string;
  value: string;
  rank: string | null;
  of: string | null;
  note: string | null;
};

/**
 * A stored block. Prose blocks carry `text`; the ranks block carries `rows`.
 * They are one union rather than two arrays because `blocks` is stored in
 * display order and splitting it here would let the panel reorder what the
 * generator decided — the order is part of the rendered artefact.
 */
export type SheetBlock = {
  title: string;
  text?: string;
  cohort_n?: number | null;
  rows?: SheetRankRow[];
};

export type EvidenceSheetData = {
  symbol: string;
  generatedAt: string;
  snapshotDate: string | null;
  priceAsof: string | null;
  blocks: SheetBlock[];
  /** metric key -> why it was not shown. See 0088's comment on the column. */
  withheld: Record<string, string>;
  generator: string;
  packSha: string;
};

type RawSheet = {
  generated_at: Date;
  blocks: unknown;
  withheld: unknown;
  snapshot_date: Date | null;
  price_asof: Date | null;
  generator: string;
  pack_sha: string;
};

function isoDate(d: Date | null): string | null {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

/**
 * Newest sheet for a symbol, or null when none has been rendered.
 *
 * Returns only the newest: the table keeps history by PK (symbol,
 * generated_at) so two rows show what moved, but that is a forensic question
 * and the tab answers "what does the data say now". Nothing is averaged
 * across rows.
 *
 * Callers must not call this when a hand-written verdict exists — see the
 * precedence comment in app/stock/[symbol]/page.tsx. A verdict shown beside a
 * sheet invites the reader to average an opinion against a template.
 */
export async function loadEvidenceSheet(symbol: string): Promise<EvidenceSheetData | null> {
  const upper = symbol.toUpperCase();

  let rows: RawSheet[] = [];
  try {
    rows = await sql<RawSheet[]>`
      SELECT generated_at, blocks, withheld, snapshot_date, price_asof,
             generator, pack_sha
        FROM app.stock_evidence_sheet
       WHERE symbol = ${upper}
       ORDER BY generated_at DESC
       LIMIT 1
    `;
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const r = rows[0];
  const blocks = Array.isArray(r.blocks) ? (r.blocks as SheetBlock[]) : [];
  // The table's CHECK constraint refuses an empty blocks array, so this can
  // only be a shape change in the loader. Treat it as no sheet rather than
  // render a heading over nothing: an empty panel reads as a failure, and the
  // empty state at least says who writes these.
  if (blocks.length === 0) return null;

  const withheld =
    r.withheld && typeof r.withheld === "object" && !Array.isArray(r.withheld)
      ? (r.withheld as Record<string, string>)
      : {};

  return {
    symbol: upper,
    generatedAt: new Date(r.generated_at).toISOString(),
    snapshotDate: isoDate(r.snapshot_date),
    priceAsof: isoDate(r.price_asof),
    blocks,
    withheld,
    generator: r.generator,
    packSha: r.pack_sha,
  };
}
