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
 *   node scripts/build-overview-from-filing.mjs --missing 25 --apply   # backfill
 *
 * THE BACKFILL MODE (--missing), AND WHY IT IS BOUNDED
 *
 * Measured 2026-10-06: 2,238 active symbols hold no overview at all, and 1,572
 * of them (70.2%) have an annual-report candidate in app.announcement. Screener
 * cannot close that gap — its cap is 800 key-insights per ROLLING 30 days,
 * about 23/day after the session probes take their share, so ~97 runs. Filings
 * are free and unmetered, so the only limits here are bandwidth, disk and the
 * Haiku bill.
 *
 * DISK IS THE REAL CONSTRAINT AND IT USED TO BE A BUG. Every candidate PDF was
 * written into one temp directory that was only removed when the whole run
 * ended. For the 14-symbol stale sweep that is nothing. Annual reports run
 * 5-50MB, so at 1,572 symbols it is tens of gigabytes and a GitHub runner
 * (~14GB free) dies part way through with a disk error that looks nothing like
 * the actual cause. Each PDF is now deleted as soon as its text is extracted.
 *
 * ATTEMPTS ARE RECORDED so a run resumes instead of restarting. This reuses
 * app.company_overview_attempt — the same table and the same retry_after the
 * Screener worker uses, because a symbol satisfied from EITHER source should
 * not be re-asked by the other. Note the table's CHECK constraint allows only
 * built/unchanged/no_input/kept_existing, so this path's richer outcomes
 * (no filing, letter only, scanned, no rows) all record as 'no_input' with the
 * specific reason in the log. That is a deliberate shortcut to avoid a
 * migration inside an already-large change; if the distinction starts
 * mattering for retry cadence, widening the constraint is the fix.
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
 * SECOND EXTRACTOR: Gemini 2.5 Flash, behind --gemini.
 *
 * Not a preference — an economics problem. The filings backlog is 1,572
 * symbols and each one sends ~23k input tokens (MAX_CHARS of report prose),
 * which on Haiku 4.5 is about $0.025 a symbol and ~$40 for the backfill.
 * Gemini 2.5 Flash's free tier covers the daily volume this job needs at zero,
 * so the whole backlog is free. The Anthropic workspace running out of credit
 * 21 symbols into the first canary is what forced the question.
 *
 * WHAT THIS DOES NOT CHANGE: the contract. Both paths send the SAME SYSTEM
 * prompt and both are parsed by the SAME parseTable. A second provider with a
 * second prompt would be a copy that never receives the next fix — the exact
 * failure CLAUDE.md section 4 names. The only provider-specific code is the
 * transport below.
 *
 * THE RISK, STATED PLAINLY: a model that drifts from the markdown-table format
 * does not error. parseTable just returns fewer rows, the run prints a
 * cheerful "-> 3 rows", and the stored overview is thinner than the Haiku one
 * would have been. That is a section 5 "renders as success" failure, so
 * --gemini is opt-in and the model used is written to company_overview.model
 * on every row. If the rows turn out worse, that column is how you find and
 * rebuild them.
 *
 * Raw REST rather than @google/genai: one fetch against a documented endpoint
 * beats adding a dependency to web/package.json for a script that is not part
 * of the web app.
 *
 * thinkingBudget 0 matters. 2.5 Flash is a thinking model and reasoning tokens
 * are drawn from maxOutputTokens, so leaving it on can consume the entire
 * budget and return an EMPTY candidate — which arrives here as "no parseable
 * table" and looks like a bad report rather than a misconfigured call.
 */
/**
 * flash-lite, not flash, and the measurement says so rather than the name.
 * Both were run over the same 10 symbols at the same 90k chars on 2026-10-06:
 * lite matched or beat 3.8-flash on all ten and produced MORE rows on eight
 * (GAIL 8->10, FUSION 8->11, FRACTAL 9->11), with no schema drift. Cost
 * ~Rs 0.29 a symbol against ~Rs 1.64 — about 5.6x cheaper AND better, which is
 * unusual enough to be worth writing down so nobody "upgrades" it back.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

/**
 * Transient statuses. 503 ("high demand") and 429 (free-tier rate limit) are
 * the normal weather on the free tier, not failures — the first live call in
 * this repo got a 503. Without a retry a bulk run would abort mid-backlog on a
 * condition that clears in seconds, and the Anthropic SDK retries these for
 * free, so the raw-fetch path has to do it by hand or it is strictly worse.
 */
const GEMINI_RETRY = new Set([429, 500, 502, 503, 504]);

/**
 * NOT EVERY MODEL ACCEPTS thinkingConfig. Measured 2026-10-06:
 * gemini-3.8-flash requires thinkingBudget 0 to avoid spending the whole
 * output budget on reasoning, while gemini-3.5-flash-lite rejects the same
 * field outright with a bare `400 Request contains an invalid argument` that
 * names neither the field nor the reason. Sending it unconditionally makes
 * every lite model look broken; omitting it unconditionally makes 3.8-flash
 * silently return empty candidates. So it is sent, and dropped on the one
 * status that means "you sent something I do not take".
 */
let thinkingSupported = true;

async function geminiTable(system, user, attempt = 0) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set (required by --gemini)");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2000,
          ...(thinkingSupported ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    },
  );
  if (!res.ok) {
    if (res.status === 400 && thinkingSupported) {
      thinkingSupported = false;
      console.log(`  gemini 400 with thinkingConfig; ${GEMINI_MODEL} does not take it, retrying without`);
      return geminiTable(system, user, attempt);
    }
    if (GEMINI_RETRY.has(res.status) && attempt < 4) {
      const wait = 2 ** attempt * 2000;
      console.log(`  gemini ${res.status}, retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      return geminiTable(system, user, attempt + 1);
    }
    throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = await res.json();
  return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

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
const MAX_CHARS = Number(process.env.OVERVIEW_MAX_CHARS || 90_000);

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
      // A rejected candidate is dead weight the moment we know its page count.
      // Under --missing there can be several per symbol and 1,572 symbols.
      rmSync(path, { force: true });
    } catch {
      rejected.push(`${c.published_at.toISOString().slice(0, 10)} unreadable`);
      rmSync(path, { force: true });
    }
  }
  return { rejected };
}

/**
 * Symbols with NO overview row that have an annual-report candidate.
 *
 * The EXISTS clause is the point: selecting "has no overview" alone returns
 * 2,238 symbols of which 666 can never be served from a filing, so a bounded
 * run would spend most of its slots re-discovering that and the backfill would
 * crawl. Filtering here means --missing 25 attempts 25 symbols that can
 * plausibly succeed.
 *
 * NIFTY 500 CONSTITUENTS GO FIRST. Measured 2026-10-06: 263 of the 497 active
 * Nifty 500 names had no overview at all — over half the most-viewed universe
 * rendering an empty panel — and 246 of those are reachable from a filing. A
 * bounded run costs the same either way, so ordering by index membership fixes
 * the panels people actually look at first. Alphabetical ordering is what left
 * app.company_overview full of symbols starting A, B and C.
 *
 * Membership comes from app.index_constituent, NOT app.universe.is_nifty500 —
 * that column is 0 for every row in production and nothing populates it, so a
 * filter on it silently matches nothing. is_nifty50 and is_nifty200 are filled;
 * is_nifty500 is the section 5 failure in its purest form.
 *
 * retry_after is honoured so a second run resumes rather than re-attempting
 * the symbols the first one just failed on — without it, every run would walk
 * the same alphabetical prefix forever, which is precisely how this table
 * ended up full of symbols starting with A, B and C.
 */
async function missingWithFilings(db, limit) {
  return db`
    SELECT u.symbol
      FROM app.universe u
      LEFT JOIN app.company_overview o  ON o.symbol = u.symbol
      LEFT JOIN app.company_overview_attempt a ON a.symbol = u.symbol
     WHERE u.is_active
       AND o.symbol IS NULL
       AND (a.retry_after IS NULL OR a.retry_after <= now())
       AND EXISTS (
             SELECT 1 FROM app.announcement an
              WHERE an.symbol = u.symbol
                AND an.pdf_url IS NOT NULL
                AND an.title ILIKE '%annual report%'
                AND an.published_at > now() - interval '15 months')
     ORDER BY (NOT EXISTS (SELECT 1 FROM app.index_constituent c
                            WHERE c.symbol = u.symbol AND c.index_code = 'NIFTY500')),
              a.retry_after NULLS FIRST, u.symbol
     LIMIT ${limit}`;
}

/**
 * Record the attempt so the next run skips this symbol for a while.
 *
 * Mirrors build-company-overview.mjs's RETRY_DAYS rather than inventing a
 * second cadence: a company description changes about once a year, and a
 * symbol with no usable filing today will most plausibly have one after the
 * next AGM season.
 */
const FILING_RETRY_DAYS = { built: 180, no_input: 90 };

async function recordAttempt(db, symbol, outcome) {
  const days = FILING_RETRY_DAYS[outcome] ?? 90;
  await db`
    INSERT INTO app.company_overview_attempt
      (symbol, last_attempt_at, last_outcome, attempts, retry_after)
    VALUES (${symbol}, now(), ${outcome}, 1, now() + ${`${days} days`}::interval)
    ON CONFLICT (symbol) DO UPDATE
      SET last_attempt_at = now(),
          last_outcome    = EXCLUDED.last_outcome,
          attempts        = app.company_overview_attempt.attempts + 1,
          retry_after     = EXCLUDED.retry_after`;
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
  const useGemini = args.includes("--gemini");
  const activeModel = useGemini ? GEMINI_MODEL : MODEL;
  const missingIdx = args.indexOf("--missing");
  const missingN = missingIdx === -1 ? 0 : Number(args[missingIdx + 1]);
  if (missingIdx !== -1 && !(missingN > 0)) {
    throw new Error("--missing needs a positive count, e.g. --missing 25");
  }
  // The count that follows --missing is an argument, not a symbol.
  const countIdx = missingIdx === -1 ? -1 : missingIdx + 1;
  let symbols = args.filter((a, i) => !a.startsWith("--") && i !== countIdx);

  if (!process.env.APP_DB_URL) throw new Error("APP_DB_URL not set");
  // Only the key for the extractor actually in use. Demanding both would make
  // --gemini unusable on a machine that has no Anthropic credit — which is the
  // situation --gemini exists for.
  if (useGemini) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  } else if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  if (apply && !/localhost|127\.0\.0\.1/.test(process.env.APP_DB_URL)
      && process.env.FUNDAMENTAL_ALLOW_REMOTE_DB !== "1") {
    throw new Error("refusing to write to a remote DB without FUNDAMENTAL_ALLOW_REMOTE_DB=1");
  }

  const db = postgres(process.env.APP_DB_URL, { max: 1, idle_timeout: 20 });
  const client = useGemini ? null : new Anthropic();

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
  if (missingN) {
    const rows = await missingWithFilings(db, missingN);
    symbols = rows.map((r) => r.symbol);
    // Not an error. A drained queue is the steady state this job is aiming at,
    // and exiting 2 for it would turn success into a red cron run forever.
    if (!symbols.length) {
      console.log("queue empty — no symbol is both overview-less and retry-due.");
      await db.end();
      return 0;
    }
  }
  if (!symbols.length) {
    console.error("usage: node scripts/build-overview-from-filing.mjs SYM [SYM...] [--apply]\n" +
                  "       node scripts/build-overview-from-filing.mjs --stale [--apply]\n" +
                  "       node scripts/build-overview-from-filing.mjs --missing N [--apply]");
    await db.end();
    process.exit(2);
  }

  const dir = mkdtempSync(join(tmpdir(), "filing-"));
  let built = 0, noFiling = 0, letterOnly = 0, failed = 0;
  let apiErrors = 0, aborted = false;

  // Every exit from a symbol records an attempt, so a run resumes where the
  // last one stopped. Writing it only on success would leave the failures
  // retry_after-less and every run would re-walk the same alphabetical prefix —
  // the exact way app.company_overview filled up with A, B and C.
  const done = async (sym, outcome) => { if (apply) await recordAttempt(db, sym, outcome); };

  // BSE is a free host we are not a customer of, and a bulk run hits it with
  // one multi-megabyte GET per candidate. A second between symbols costs ~26
  // minutes over the whole 1,572-symbol backlog and is the difference between
  // a polite client and a scraper that gets blocked.
  const PAUSE_MS = 1000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    let first = true;
    for (const symbol of symbols) {
      if (!first) await sleep(PAUSE_MS);
      first = false;
      const meta = await db`SELECT company_name, sector FROM app.universe WHERE symbol = ${symbol}`;
      const name = meta[0]?.company_name ?? symbol;

      const cands = await candidates(db, symbol);
      if (!cands.length) {
        console.log(`${symbol.padEnd(12)} NO FILING — no annual report in app.announcement`);
        noFiling++;
        await done(symbol, "no_input");
        continue;
      }

      const rep = fetchReport(cands, dir);
      if (!rep.path) {
        // Loudly, not silently: this symbol has filings titled "Annual Report"
        // and every one of them is a covering letter. That is a real finding
        // about the symbol, not an error to swallow.
        console.log(`${symbol.padEnd(12)} LETTER ONLY — ${cands.length} candidate(s), none >= ${PAGE_FLOOR}pp [${rep.rejected.join(", ")}]`);
        letterOnly++;
        await done(symbol, "no_input");
        continue;
      }

      // Extract, then drop the file immediately. Holding it until the run ends
      // is what made this unable to scale past a few dozen symbols.
      const text = proseOf(rep.path);
      rmSync(rep.path, { force: true });
      if (text.length < 2000) {
        // A scanned/image-only report. pdftotext returns almost nothing and the
        // model would hallucinate from a table of contents.
        console.log(`${symbol.padEnd(12)} NO TEXT — ${rep.pages}pp but only ${text.length} chars extracted (scanned?)`);
        failed++;
        await done(symbol, "no_input");
        continue;
      }

      // Identical user message on both paths. If the two extractors are ever
      // compared, the only variable must be the model.
      const prompt = `Company: ${name}\nSector: ${meta[0]?.sector || "unknown"}\n\n` +
                     `Source: the company's own annual report as filed to BSE on ` +
                     `${rep.published_at.toISOString().slice(0, 10)}.\n\nDescription:\n${text}`;

      // A PROVIDER ERROR IS NOT A FACT ABOUT THE SYMBOL. Out of credit, a 500,
      // an expired key — none of those say anything about this company's
      // filing, so no attempt is recorded and retry_after is left alone. The
      // first canary died here with a raw stack trace when the Anthropic
      // workspace ran dry at symbol 22; as a nightly cron that is a loud issue
      // raised against a healthy pipeline, which is how alerts stop being read.
      let raw;
      try {
        if (useGemini) {
          raw = await geminiTable(SYSTEM, prompt);
        } else {
          const res = await client.messages.create({
            model: MODEL,
            max_tokens: 1500,
            system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: prompt }],
          });
          raw = res.content[0].text.trim();
        }
        apiErrors = 0;
      } catch (e) {
        apiErrors++;
        console.log(`${symbol.padEnd(12)} API ERROR — ${String(e.message).slice(0, 160)}`);
        // Three in a row is not a hiccup. Billing and auth failures repeat
        // forever, and walking the rest of the queue to fail identically wastes
        // the run and makes the log useless. Exit 4 says "provider, not data".
        if (apiErrors >= 3) {
          console.log(`\nABORTING — ${apiErrors} consecutive provider errors. Nothing is wrong with the queue.`);
          aborted = true;
          break;
        }
        continue;
      }
      const parsed = parseTable(raw);
      const drift = parsed.filter((p) => !SPINE.includes(p.label)).map((p) => p.label);
      const fy = latestFy(parsed);

      if (!parsed.length) {
        console.log(`${symbol.padEnd(12)} NO ROWS — model returned no parseable table`);
        failed++;
        await done(symbol, "no_input");
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
          VALUES (${symbol}, ${db.json(parsed)}, 'filing', ${activeModel},
                  ${createHash("sha256").update(text, "utf8").digest("hex")}, ${fy},
                  ${rep.id}, ${rep.published_at}, now())
          ON CONFLICT (symbol) DO UPDATE
            SET rows = EXCLUDED.rows, source = EXCLUDED.source, model = EXCLUDED.model,
                source_sha256 = EXCLUDED.source_sha256, latest_fy = EXCLUDED.latest_fy,
                source_filing_id = EXCLUDED.source_filing_id,
                source_filing_date = EXCLUDED.source_filing_date,
                generated_at = now()`;
        await done(symbol, "built");
      }
      built++;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await db.end();
  }

  console.log(`\nbuilt=${built} no_filing=${noFiling} letter_only=${letterOnly} failed=${failed}` +
              (aborted ? "  [ABORTED on provider errors]" : "") +
              (apply ? "" : "\nDRY RUN — nothing written. Re-run with --apply."));
  // 4, not 1: the rows built before the abort are good and the queue is intact.
  // Same reasoning as the Screener worker's exit 3 — conflating "the provider
  // is down" with "the job is broken" produces an alert nobody reads.
  return aborted ? 4 : 0;
}

main().then((c) => process.exit(c));
