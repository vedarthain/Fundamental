/**
 * overview-shared.mjs — the spine, the prompt, and the two parsers that every
 * company-overview builder shares.
 *
 * WHY THIS FILE EXISTS
 *
 * These four exports used to live in build-company-overview.mjs, the Screener
 * Key Points builder, and build-overview-from-filing.mjs imported them from
 * there. That was correct while Screener was the primary source and the filing
 * path was the newcomer. On 2026-10-13 the Key Points path was retired — its
 * allowance is 800 requests per rolling 30 days and it was exhausted, while the
 * filing path reads NSE/BSE annual reports for free and had already carried
 * overview coverage from 43.9% to 78.0% in a day.
 *
 * Retiring the fetch meant deleting the file that happened to own the prompt.
 * So the prompt moves here rather than being copied into the surviving builder:
 * a copied prompt is a copy that never receives the next correction, and the
 * corrections encoded below were each paid for in measured wrong output.
 *
 * WHAT BELONGS HERE: anything that defines the SHAPE of an overview — the row
 * labels, the extraction rules, how a table is read back, how its vintage is
 * dated. All of it is source-agnostic.
 *
 * WHAT DOES NOT: fetching, cookies, quotas, retry schedules, DB access. Those
 * are properties of where the text came from, and they differ per source.
 */

// NO "Brands" ROW. Three successive prompt tightenings failed to stop the
// model attributing a vendor's products to the company that merely implements
// them: Haiku gave 20MICRONS "20MCC; MinFert"; Opus gave 63MOONS 21 names from
// a source where the word "brand" never appears; and with Screener Key Points
// plus an explicit "OWNED OR SOLD BY THIS COMPANY", ADROITINFO still emitted
// "SAP HANA; Ariba; SAP C4C; Success Factors" — SAP's products, not the
// consultancy's. ~2% of companies wrong, and wrong in the most confident-
// looking way. The row is not recoverable by prompting, so it is gone.
//
// "Clientele" was added for Screener's literal "Clientele:" heading, which the
// old spine had no slot for — ADROITINFO's customers (Vicco, Supreme, Essel
// Propack) were being forced into "Markets served", which means industries.
// It stays now that filings are the source: annual reports name customers too,
// and the rule it encodes is general. Every fact a source supplies needs a slot
// or it gets misfiled into the nearest one.
export const SPINE = [
  "Core business",
  "Parent / group",
  "Business segments",
  "Products and services",
  "Markets served",
  "Clientele",
  "Trading venues",
  "Geographic presence",
  "Formerly known as",
  "Incorporated",
  "Headquarters",
];

// Rule 7 exists because it was measured: without it, Haiku emitted "Trading
// venues: NSE; BSE" for 360ONE, whose source text contains no exchange name at
// all. With it, 0 unsupported venues across 100 companies. That is the shape of
// rule that works — name the specific wrong output and forbid it. The Brands
// row is the counter-example: three rules of that shape failed to stop it, so
// the row was deleted rather than re-worded (rule 3).
//
// Haiku is NON-DETERMINISTIC here. Two identical runs over the same 100
// companies gave brandBad 8 then 10, venueBad 0 then 1, label drift 1 then 0.
// So no single audit is the rate, and app.company_overview stores the output
// rather than regenerating it per render: a wrong row gets corrected in place
// instead of re-rolled into a different wrong row.
export const SYSTEM = `You convert an Indian listed company's business description into a fixed key-value table.

ROWS — use ONLY these labels, in this order. Never invent a label, never rename one:
${SPINE.map((s) => `- ${s}`).join("\n")}

RULES:
1. OMIT any row the source text does not support. A missing row is correct; a guessed row is a defect.
2. Every value must be traceable to a span in the source. Do not add industry knowledge, do not infer from the company name, do not complete a list you think is incomplete.
3. NEVER output a "Brands" row. Brand names are not part of this table. If the text names products, put them in "Products and services".
4. "Core business" is the one exception to rule 2: synthesise a short phrase (under 12 words) describing what the company actually does.
5. "Markets served" means INDUSTRIES or END-MARKETS the company sells into ("paints", "plastics", "pharma"). Named exchanges (NSE, BSE, MCX) are NOT markets — they belong in "Trading venues".
6. "Clientele" means NAMED CUSTOMER COMPANIES the text identifies ("Vicco; Supreme Industries"). Never put an industry in "Clientele" and never put a customer's name in "Markets served".
7. "Trading venues" is ONLY for exchanges the source text explicitly names. If the text does not name an exchange, OMIT the row. Do not infer that an Indian listed company trades on NSE or BSE.
8. "Parent / group" is for an explicit parent, holding company or group affiliation stated in the text. Omit otherwise.
9. "Incorporated" takes a 4-DIGIT YEAR AND NOTHING ELSE — "1987". If the text gives no year of incorporation, OMIT the row. Group affiliation is never an answer here; it belongs in "Parent / group".
10. Where the source gives a revenue share, KEEP THE FISCAL YEAR WITH IT — "Paints (51% in FY24)", never a bare "Paints (51%)". An undated percentage is worse than no percentage.
11. Semicolon-separate multiple values inside a cell.
12. Output ONLY a markdown table with header "| Item | Details |" and separator "|---|---|". Bold the label: | **Core business** | ... |
No preamble, no notes, no trailing commentary.`;

/** "| **Label** | value |" lines -> [{label, value}], order preserved. */
export function parseTable(md) {
  const out = [];
  for (const line of md.split("\n")) {
    const g = /^\|\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (g && g[2]) out.push({ label: g[1].trim(), value: g[2].trim() });
  }
  return out;
}

/**
 * Newest fiscal year named in the emitted rows, as a 4-digit FY-end year.
 * "Paints (51% in FY24)" -> 2024. NULL when no fiscal year is named.
 *
 * Read from the EMITTED ROWS, not the source text, deliberately: it must age
 * the figures the site actually shows. A source page can mention FY27 in a
 * sentence the model correctly dropped; that does not make the rendered FY24
 * revenue split fresh.
 *
 * FY25 is the year ENDING March 2025 by Indian convention, hence 2000 + nn.
 * Both "FY24" and "FY2024" forms appear, so both parse.
 */
export function latestFy(rows) {
  let best = null;
  for (const r of rows) {
    for (const m of `${r.label} ${r.value}`.matchAll(/\bFY\s?(\d{2}|\d{4})\b/gi)) {
      const n = Number(m[1]);
      const y = m[1].length === 2 ? 2000 + n : n;
      if (y >= 1990 && y <= 2100 && (best === null || y > best)) best = y;
    }
  }
  return best;
}
