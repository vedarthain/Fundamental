#!/usr/bin/env node
/**
 * Build app.company_overview rows from the company's OWN annual report as filed
 * to BSE, instead of from Screener's Key Points wiki.
 *
 * WHY THIS EXISTS
 *
 * Screener is a secondary source that goes stale silently. Measured against
 * production on 2026-09-24, 14 stored overviews quote FY24 or earlier — four of
 * them FY22/FY23 — and one of them, BHARATFORG, is a NIFTY 500 constituent
 * rendering "Forgings (85% in FY24)" to live users.
 *
 * For all 14 the PRIMARY document was already in app.announcement: a BSE-hosted
 * Reg. 34(1) annual report, filed between 2026-06-30 and 2026-09-08, pdf_url
 * working, no authentication, no quota. BHARATFORG's (filed 2026-07-17) gives
 * the FY26 split — Commercial Vehicles 51%, Passenger Vehicles 30%, Industrial
 * 19% — and describes Defense & Aerospace, Power, Railways, Oil & Gas and
 * General Engineering sub-segments that the stored row does not contain at all.
 *
 * So the filing is fresher, richer, and free. We were paying an 80/day rate
 * limit to scrape a middleman two years behind a document we already held a
 * URL for.
 *
 * TWO TRAPS IN THE SOURCE DATA, BOTH MEASURED, BOTH HANDLED BELOW
 *
 * 1. `subcategory` DOES NOT IDENTIFY ANNUAL REPORTS. 917 symbols carry
 *    subcategory='Reg. 34 (1) Annual Report'; 2,017 match on title/headline.
 *    BHARATFORG has ZERO rows under the subcategory and yet filed its
 *    Integrated Annual Report on 2026-07-17. Selection is therefore by title
 *    match, never by subcategory.
 *
 * 2. THE FILING TITLED "Annual Report" IS OFTEN A TWO-PAGE COVER LETTER.
 *    Companies file several documents under the same title on the same day —
 *    the report itself, plus a Reg. 36(1)(b) intimation whose entire content is
 *    a web-link to the report. Picking by date alone returns the letter about
 *    a third of the time: on the first pass over these 14 symbols, ADFFOODS,
 *    AARTECH, ADOR and BHARTIHEXA all resolved to 2-3 page letters. Re-resolving
 *    to the largest candidate got real reports of 279, 314, 365 and 147 pages.
 *
 *    Hence PAGE_FLOOR: a "report" under ~40 pages is a letter, and we say so
 *    loudly rather than extracting an overview from a covering note. That
 *    failure is exactly CLAUDE.md section 5's "renders as success" — the letter
 *    parses fine, the model dutifully returns a table, and the table is about
 *    nothing.
 *
 * WHAT IS SENT TO THE MODEL
 *
 * Not the whole report. An annual report runs 130-365 pages and most of it is
 * the financial statements, which this table does not describe. The business
 * description lives in the front "Corporate Overview" section, so we take the
 * first PROSE_PAGES pages and cap the character count. Everything after that is
 * governance, remuneration tables and audited accounts — noise for this task and
 * a large token bill.
 *
 * The extraction contract (SPINE, SYSTEM, parseTable, latestFy) is IMPORTED
 * from build-company-overview.mjs, not copied. A copied prompt is a copy that
 * never receives the next fix.
 *
 * USAGE
 *   node scripts/build-overview-from-filing.mjs SYM [SYM...]     # dry run
 *   node scripts/build-overview-from-filing.mjs SYM --apply      # writes
 *   node scripts/build-overview-from-filing.mjs --stale --apply  # all stale rows
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "../web/node_modules/postgres/src/index.js";
import Anthropic from "../web/node_modules/@anthropic-ai/sdk/index.mjs";
import { SPINE, SYSTEM, parseTable, latestFy } from "./build-company-overview.mjs";

const MODEL = "claude-haiku-4-5";

/**
 * Below this many pages the PDF is a covering letter, not a report. Derived
 * from measurement, not taste: the four letters observed were 2, 3, 3 and 3
 * pages; the smallest genuine annual report in the same set was ADVANIHOTR at
 * 139. Anywhere in between separates them, and 40 leaves room for a genuinely
 * thin microcap report without readmitting a 3-page letter.
 */
const PAGE_FLOOR = 40;

/** Front-of-report pages that actually describe the business. */
const PROSE_PAGES = 30;

/** Hard cap on characters sent to the model. AWL's first 25 pages alone are
 *  220k chars; the prompt does not improve past roughly this much context and
 *  the bill does. */
const MAX_CHARS = 90_000;

const UA = ["-A", "Mozilla/5.0", "-H", "Referer: https://www.bseindia.com/"];

/**
 * Candidate annual-report filings for a symbol, newest first.
 *
 * Title match, NOT subcategory — see trap 1 in the header. The window is 15
 * months so that a symbol whose AGM season has not yet arrived still resolves
 * to last year's report rather than to nothing.
 *
 * TITLE ONLY, NOT headline. Headlines are free prose and mention the annual
 * report while being about something else entirely — AARTECH's newspaper-
 * publication notice reads "completed the electronic dispatch of the Annual
 * Report", and ADOR's shareholder letter likewise. Matching those makes the
 * newest "annual report" for a symbol a document that is not one. Measured
 * cost of the restriction: 2,017 symbols -> 2,014, and 0 of the 14 stale
 * symbols lost. Measured benefit: the two false SUPERSEDED alarms this check
 * raised on its first run both disappear.
 */
async function candidates(db, symbol) {
  return db`
    SELECT id, published_at, coalesce(title, headline) AS title, pdf_url
      FROM app.announcement
     WHERE symbol = ${symbol}
       AND pdf_url IS NOT NULL
       AND title ILIKE '%annual report%'
       AND published_at > now() - interval '15 months'
     ORDER BY published_at DESC`;
}

/**
 * Download candidates newest-first and return the first that clears PAGE_FLOOR.
 *
 * It downloads rather than trusting metadata because nothing in the
 * announcement row distinguishes a 279-page report from a 2-page letter with
 * the identical title, filed the same minute. The page count is the only
 * signal, and it costs one HTTP GET to get it.
 *
 * -L is mandatory: AnnPdfOpen.aspx answers 302 to the real /xml-data/ path and
 * without it curl silently writes a 212-byte "Object moved" HTML stub that
 * pdfinfo then reports as a corrupt file.
 */
function fetchReport(cands, dir) {
  const rejected = [];
  for (const c of cands) {
    const path = join(dir, `${c.id.replace(/[^\w.-]/g, "_")}.pdf`);
    try {
      execFileSync("curl", ["-sL", ...UA, "--max-time", "120", "-o", path, c.pdf_url]);
      const info = execFileSync("pdfinfo", [path], { encoding: "utf8" });
      const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0);
      if (pages >= PAGE_FLOOR) return { ...c, path, pages, rejected };
      rejected.push(`${c.published_at.toISOString().slice(0, 10)} ${pages}pp`);
    } catch {
      rejected.push(`${c.published_at.toISOString().slice(0, 10)} unreadable`);
    }
  }
  return { rejected };
}

/**
 * Front-section text. -layout preserves the multi-column structure of a
 * designed annual report; without it the "Business segments" spread interleaves
 * into unreadable word salad.
 */
function proseOf(path) {
  const txt = execFileSync(
    "pdftotext", ["-layout", "-f", "1", "-l", String(PROSE_PAGES), path, "-"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return txt.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CHARS);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const useStale = args.includes("--stale");
  let symbols = args.filter((a) => !a.startsWith("--"));

  if (!process.env.APP_DB_URL) throw new Error("APP_DB_URL not set");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  if (apply && !/localhost|127\.0\.0\.1/.test(process.env.APP_DB_URL)
      && process.env.FUNDAMENTAL_ALLOW_REMOTE_DB !== "1") {
    throw new Error("refusing to write to a remote DB without FUNDAMENTAL_ALLOW_REMOTE_DB=1");
  }

  const db = postgres(process.env.APP_DB_URL, { max: 1, idle_timeout: 20 });
  const client = new Anthropic();

  if (useStale) {
    // Same cutoff the staleness audit uses: two fiscal years behind the last
    // completed one. Derived from the date so it can never be quietly widened
    // to make a run look clean.
    const now = new Date();
    const lastFy = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    const rows = await db`
      SELECT symbol FROM app.company_overview
       WHERE latest_fy IS NOT NULL AND latest_fy <= ${lastFy - 2}
       ORDER BY latest_fy, symbol`;
    symbols = rows.map((r) => r.symbol);
  }
  if (!symbols.length) {
    console.error("usage: node scripts/build-overview-from-filing.mjs SYM [SYM...] [--apply]\n" +
                  "       node scripts/build-overview-from-filing.mjs --stale [--apply]");
    await db.end();
    process.exit(2);
  }

  const dir = mkdtempSync(join(tmpdir(), "filing-"));
  let built = 0, noFiling = 0, letterOnly = 0, failed = 0;

  try {
    for (const symbol of symbols) {
      const meta = await db`SELECT company_name, sector FROM app.universe WHERE symbol = ${symbol}`;
      const name = meta[0]?.company_name ?? symbol;

      const cands = await candidates(db, symbol);
      if (!cands.length) {
        console.log(`${symbol.padEnd(12)} NO FILING — no annual report in app.announcement`);
        noFiling++;
        continue;
      }

      const rep = fetchReport(cands, dir);
      if (!rep.path) {
        // Loudly, not silently: this symbol has filings titled "Annual Report"
        // and every one of them is a covering letter. That is a real finding
        // about the symbol, not an error to swallow.
        console.log(`${symbol.padEnd(12)} LETTER ONLY — ${cands.length} candidate(s), none >= ${PAGE_FLOOR}pp [${rep.rejected.join(", ")}]`);
        letterOnly++;
        continue;
      }

      const text = proseOf(rep.path);
      if (text.length < 2000) {
        // A scanned/image-only report. pdftotext returns almost nothing and the
        // model would hallucinate from a table of contents.
        console.log(`${symbol.padEnd(12)} NO TEXT — ${rep.pages}pp but only ${text.length} chars extracted (scanned?)`);
        failed++;
        continue;
      }

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content: `Company: ${name}\nSector: ${meta[0]?.sector || "unknown"}\n\n` +
                   `Source: the company's own annual report as filed to BSE on ` +
                   `${rep.published_at.toISOString().slice(0, 10)}.\n\nDescription:\n${text}`,
        }],
      });
      const parsed = parseTable(res.content[0].text.trim());
      const drift = parsed.filter((p) => !SPINE.includes(p.label)).map((p) => p.label);
      const fy = latestFy(parsed);

      if (!parsed.length) {
        console.log(`${symbol.padEnd(12)} NO ROWS — model returned no parseable table`);
        failed++;
        continue;
      }

      console.log(`${symbol.padEnd(12)} ${String(rep.pages).padStart(3)}pp ` +
                  `${String(text.length).padStart(6)} chars -> ${parsed.length} rows  ` +
                  `fy=${fy ?? "-"}  filed ${rep.published_at.toISOString().slice(0, 10)}` +
                  `${drift.length ? `  [drift: ${drift.join(", ")}]` : ""}` +
                  `${rep.rejected.length ? `  (skipped ${rep.rejected.length} letter/bad)` : ""}`);

      // Dry run prints the rows themselves. A run that reports "8 rows" and
      // shows none of them cannot be judged — and this builder's whole claim is
      // that its rows beat the stored ones, which is a claim about content.
      if (!apply) for (const p of parsed) console.log(`               ${p.label}: ${p.value}`);

      if (apply) {
        await db`
          INSERT INTO app.company_overview
            (symbol, rows, source, model, source_sha256, latest_fy,
             source_filing_id, source_filing_date, generated_at)
          VALUES (${symbol}, ${db.json(parsed)}, 'filing', ${MODEL},
                  ${createHash("sha256").update(text, "utf8").digest("hex")}, ${fy},
                  ${rep.id}, ${rep.published_at}, now())
          ON CONFLICT (symbol) DO UPDATE
            SET rows = EXCLUDED.rows, source = EXCLUDED.source, model = EXCLUDED.model,
                source_sha256 = EXCLUDED.source_sha256, latest_fy = EXCLUDED.latest_fy,
                source_filing_id = EXCLUDED.source_filing_id,
                source_filing_date = EXCLUDED.source_filing_date,
                generated_at = now()`;
      }
      built++;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await db.end();
  }

  console.log(`\nbuilt=${built} no_filing=${noFiling} letter_only=${letterOnly} failed=${failed}` +
              (apply ? "" : "\nDRY RUN — nothing written. Re-run with --apply."));
  return 0;
}

main().then((c) => process.exit(c));
