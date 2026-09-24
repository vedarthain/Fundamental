/**
 * build-company-overview — fill app.company_overview for a set of symbols.
 *
 * Pipeline per symbol:
 *   1. Screener /wiki/company/{id}/commentary/v2/  (the "Read More" Key Points)
 *   2. fall back to app.universe.business_summary  (yfinance prose) if absent
 *   3. one Haiku call -> fixed-spine key/value rows
 *   4. upsert, fingerprinted by sha256 of the exact input text
 *
 * WHY SCREENER FIRST. Measured on 10 symbols: Key Points averages ~3,470 chars
 * against yfinance's ~1,290, and carries facts yfinance simply does not have —
 * segment revenue shares ("Tobacco 93% in Q1 FY25"), parent group ("part of the
 * KK Modi Group"), brands grouped by category, clientele. Every fabrication in
 * the 100-company audit traced to thin input, not to the model: ADROITINFO's
 * brands came out as `ARIBA; SAP C4C; Success Factors` because yfinance's prose
 * never says those are SAP's products and Adroit is the consultancy. Key Points
 * says so explicitly ("Next Generation Products: Ariba, CRM, SRM, SAP C4C").
 * Better input fixes more than a better model does.
 *
 * WHY THE FINGERPRINT. source_sha256 is what stops this from being a seed-once
 * table. A symbol whose input text is unchanged is skipped; a symbol whose text
 * moved is rebuilt. Without it the first run is also the last one, which is
 * CLAUDE.md section 5's standing failure.
 *
 * SCREENER IS A SHARED RESOURCE. This repo already leans on it for
 * classification, shareholding and the profile blurb. The throttle below is
 * deliberate and was tuned by being rate-limited: at ~1s/page Screener returned
 * "Too many requests" after 8 symbols. 2.5s between the page and the wiki hit,
 * 3s between symbols, and a 20s backoff on a 429 body.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a
 *   node scripts/build-company-overview.mjs SYM1 SYM2 ...
 *   node scripts/build-company-overview.mjs --file syms.txt [--force]
 *   node scripts/build-company-overview.mjs --queue 80        # daily worker
 *   node scripts/build-company-overview.mjs --queue 80 --dry-run
 *   node scripts/build-company-overview.mjs --audit           # staleness sweep
 *
 * Writes to APP_DB_URL. Local by default; pointing it at Neon is the same
 * deliberate act as any other remote write.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "../web/node_modules/postgres/src/index.js";
import Anthropic from "../web/node_modules/@anthropic-ai/sdk/index.mjs";

const MODEL = "claude-haiku-4-5";
// NO "Brands" ROW. Three successive prompt tightenings failed to stop the
// model attributing a vendor's products to the company that merely implements
// them: Haiku gave 20MICRONS "20MCC; MinFert"; Opus gave 63MOONS 21 names from
// a source where the word "brand" never appears; and with Screener Key Points
// plus an explicit "OWNED OR SOLD BY THIS COMPANY", ADROITINFO still emitted
// "SAP HANA; Ariba; SAP C4C; Success Factors" — SAP's products, not the
// consultancy's. ~2% of companies wrong, and wrong in the most confident-
// looking way. The row is not recoverable by prompting, so it is gone.
//
// "Clientele" is new. Key Points carries a literal "Clientele:" heading and
// the old spine had no slot for it, so ADROITINFO's customers (Vicco, Supreme,
// Essel Propack) were forced into "Markets served", which means industries.
// Every fact the richer source supplies needs a slot or it gets misfiled into
// the nearest one.
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

// Rule 7 (was rule 6) exists because it was measured: without it, Haiku
// emitted "Trading venues: NSE; BSE" for 360ONE, whose source text contains no
// exchange name at all. With it, 0 unsupported venues across 100 companies.
// That is the shape of rule that works — name the specific wrong output and
// forbid it. The Brands row is the counter-example: three rules of that shape
// failed to stop it, so the row was deleted rather than re-worded (rule 3).
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

const UA = { "User-Agent": "Mozilla/5.0" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function cookieHeader() {
  const sid = process.env.SCREENER_SESSIONID;
  const csrf = process.env.SCREENER_CSRFTOKEN;
  if (!sid || !csrf) return null;
  return `sessionid=${sid}; csrftoken=${csrf}`;
}

/** Strip Screener's wiki HTML to readable text, keeping list/heading breaks. */
function cleanWiki(html) {
  let t = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<li[^>]*>/gi, "\n- ").replace(/<(h2|h3|p)[^>]*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ").replace(/\[\s*edit\s*\]/gi, "");
  t = t.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&rsquo;/g, "'");
  t = t.replace(/[ \t]+/g, " ");
  return t.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

/**
 * Screener's Key Points endpoint enforces a HARD DAILY QUOTA, not a rate limit.
 * Past it, /wiki/company/{id}/commentary/v2/ returns HTTP 200 with a 381-byte
 * stub whose text is:
 *
 *   "We allow 80 key-insights per day. This is to prevent users from copying
 *    and distributing them."
 *
 * Sleeping does not clear it. It resets daily.
 *
 * WHY THIS CONSTANT EXISTS AS A SEPARATE, EXPLICIT CHECK. The first 100-symbol
 * run got Key Points for 81 companies and then silently fell back to yfinance
 * prose for the remaining 19 — because the stub contains no "Too many
 * requests" and no data-url, and the original code returned null in that case,
 * which is the SAME value it returns for "this company genuinely has no wiki
 * page". A quota wall was therefore indistinguishable from an absent page, and
 * the run printed a clean `built=100` while writing 19 rows from worse input.
 * ALANKIT went from 2,901 chars of Key Points to 1,762 chars of yfinance.
 *
 * That is CLAUDE.md §5 exactly: a failure that renders as success. So the
 * sentinel below is a THIRD return value, distinct from null, and the caller
 * aborts on it rather than degrading.
 */
const QUOTA_MARKER = /key-insights per day/i;
const QUOTA = Symbol("screener-daily-quota-exhausted");

/**
 * THE FOURTH RETURN VALUE: the session is dead.
 *
 * MEASURED 2026-09-24, same request with two cookies:
 *
 *   garbage cookie -> 20,236 bytes, a FULL HTML PAGE: "Register - Screener …
 *                     Home Screens Tools Login …"
 *   real cookie    ->  5,779 bytes, an HTML FRAGMENT: "About [edit]
 *                     Incorporated in 1986, Aban Offshore is in the business…"
 *
 * The commentary endpoint does not 401 and does not redirect visibly. It
 * returns the registration page with HTTP 200. After cleanWiki() strips the
 * tags that page still yields well over 600 characters of navigation text, so
 * the length gate below passes it, Haiku is handed a login form, and the row
 * is written as source='screener_keypoints' with ZERO extracted rows and
 * retry_after six months out. That is not hypothetical: it happened on the
 * first test of the queue worker and put 4 empty rows into production.
 *
 * WHY THIS MARKER AND NOT A LENGTH OR A TITLE. The endpoint is an XHR
 * fragment — a correct response contains no <html> element and no Django CSRF
 * field. Their presence means we were served a page instead of a fragment,
 * which is true for the login page, the register page and any future
 * interstitial, without needing to enumerate them.
 */
const LOGGED_OUT_MARKER = /<html|csrfmiddlewaretoken|auth-partition/i;
const LOGGED_OUT = Symbol("screener-session-expired");
/** Screener's stated allowance. Used only to size a run, never to trust. */
export const SCREENER_DAILY_KEYPOINTS = 80;

async function fetchKeyPoints(symbol, cookie) {
  if (!cookie) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const pageUrl = `https://www.screener.in/company/${symbol}/consolidated/`;
    const page = await fetch(pageUrl, { headers: { ...UA, cookie }, redirect: "follow" });
    const html = await page.text();
    if (html.includes("Too many requests")) { await sleep(20000); continue; }
    const m = html.match(/data-url="(\/wiki\/company\/\d+\/commentary\/v2\/)"/);
    if (!m) return null;                       // no wiki page for this company
    // Checked on the COMPANY page too, not only the wiki fragment: a dead
    // session can still expose the data-url while refusing the fragment.
    await sleep(2500);
    const wiki = await fetch("https://www.screener.in" + m[1], {
      headers: { ...UA, cookie, "X-Requested-With": "XMLHttpRequest", Referer: pageUrl },
    });
    const wtext = await wiki.text();
    if (wtext.includes("Too many requests")) { await sleep(20000); continue; }
    // Both checked BEFORE the length test. The quota stub is 381 bytes and
    // would fall through the >= 600 gate into a null return; the logged-out
    // page is 20,236 bytes and would sail OVER it into a bogus success. Length
    // separates neither — only the markers do.
    if (QUOTA_MARKER.test(wtext)) return QUOTA;
    if (LOGGED_OUT_MARKER.test(wtext)) return LOGGED_OUT;
    const cleaned = cleanWiki(wtext);
    // Below this it is a stub page ("About" + a one-liner), not worth preferring
    // over yfinance prose. Observed real Key Points run 2,700-5,800 chars.
    return cleaned.length >= 600 ? cleaned : null;
  }
  return null;
}

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
 * the figures the site actually shows. A Key Points page can mention FY27 in a
 * sentence the model correctly dropped; that does not make the rendered
 * FY24 revenue split fresh.
 *
 * FY25 is the year ENDING March 2025 by Indian convention, hence 2000 + nn.
 * Both "FY24" and "FY2024" appear in Screener prose, so both parse.
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

async function extract(client, row, text) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Company: ${row.company_name}\nSector: ${row.sector || "unknown"}\n\nDescription:\n${text}`,
    }],
  });
  return parseTable(res.content[0].text.trim());
}

/**
 * Indian fiscal years end 31 March. In September 2026 the last COMPLETED
 * fiscal year is FY26 (ended 2026-03-31); FY27 is in progress.
 */
function lastCompletedFy(now = new Date()) {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 3 ? y : y - 1; // month 3 == April
}

/**
 * How long to wait before asking about a symbol again, keyed by what happened
 * last time. Rationale for each window lives in migration 0076; the short
 * version is that a company description changes about once a year and the
 * Screener allowance is 80/day, so re-asking sooner buys nothing and costs the
 * backfill.
 */
const RETRY_DAYS = { built: 180, unchanged: 45, no_input: 90, kept_existing: 90 };

/**
 * Pick the next `n` symbols for the daily worker.
 *
 * ORDER, AND WHY IT IS THIS ORDER
 *
 * 1. Symbols with NO overview row at all come first. Measured on prod
 *    2026-09-24: 178 of 2,591 symbols have a row, so 2,413 have nothing and a
 *    user visiting any of them sees an empty panel. A missing row is a visible
 *    hole; a 45-day-old row is not.
 * 2. Within that, least-recently-attempted first (never-attempted first of
 *    all), so the queue sweeps rather than re-chewing the same head.
 *
 * `retry_after` is what stops this from being a queue that cannot drain — see
 * migration 0076. Without it the 451 symbols with neither a Screener wiki page
 * nor yfinance prose would consume the entire allowance every night, forever.
 */
async function selectQueue(db, n) {
  return (await db`
    SELECT u.symbol
      FROM app.universe u
      LEFT JOIN app.company_overview o         ON o.symbol = u.symbol
      LEFT JOIN app.company_overview_attempt a ON a.symbol = u.symbol
     WHERE u.is_active
       AND (a.retry_after IS NULL OR a.retry_after <= now())
     ORDER BY (o.symbol IS NOT NULL),
              a.retry_after NULLS FIRST,
              u.symbol
     LIMIT ${n}`).map((r) => r.symbol);
}

/**
 * Record that a symbol was attempted, whatever the outcome.
 *
 * Called for every symbol the loop actually fetched — including the ones that
 * produced nothing. That is the entire point: a failure that leaves no trace
 * is a symbol the queue will re-serve tomorrow.
 */
async function recordAttempt(db, symbol, outcome) {
  const days = RETRY_DAYS[outcome];
  await db`
    INSERT INTO app.company_overview_attempt
           (symbol, last_attempt_at, last_outcome, attempts, retry_after)
    VALUES (${symbol}, now(), ${outcome}, 1, now() + (${days} || ' days')::interval)
    ON CONFLICT (symbol) DO UPDATE
          SET last_attempt_at = now(),
              last_outcome    = EXCLUDED.last_outcome,
              attempts        = app.company_overview_attempt.attempts + 1,
              retry_after     = EXCLUDED.retry_after`;
}

/**
 * The staleness sweep. Exits 1 when any stored overview quotes a fiscal year
 * more than one full year behind the last completed one.
 *
 * WHY THIS IS NOT IN dq.py OR coverage.py. Both modules argue against exactly
 * the check this would be there: dq.py's _MAX_COUNT_ASSERTIONS is empty on
 * purpose ("a ceiling is only defensible for a quantity with no healthy value
 * of zero"), and coverage.py's buckets are a partition of SCORING coverage
 * whose status list is a CHECK constraint in migration 0068 — a different
 * partition does not belong in it. So the sweep lives beside the thing it
 * audits, and reports names rather than a number.
 *
 * THE CUTOFF IS NOT TUNED. It is derived from today's date: one full fiscal
 * year of grace after the last completed one. FY25 in Sept 2026 is a company
 * that simply has not reported yet; FY24 is a wiki page a human abandoned.
 *
 * IT FAILS ON THE ORIGINATING BUG. 20MICRONS stores latest_fy = 2024 against
 * a cutoff of 2025 and trips this today. That was the requirement — a check
 * that cannot fail on the case that motivated it is decoration (CLAUDE.md §5).
 */
async function audit(db) {
  // One full fiscal year of grace AFTER the last completed one. In Sept 2026
  // the last completed FY is 26, so FY25 is merely "not reported yet" and FY24
  // is abandoned. Derived from the date, never edited.
  const cutoff = lastCompletedFy() - 2;
  const rows = await db`
    SELECT symbol, latest_fy, source, generated_at::date AS built
      FROM app.company_overview
     WHERE latest_fy IS NOT NULL AND latest_fy <= ${cutoff}
     ORDER BY latest_fy, symbol`;
  const total = await db`SELECT count(*)::int AS n FROM app.company_overview`;
  const undated = await db`
    SELECT count(*)::int AS n FROM app.company_overview WHERE latest_fy IS NULL`;

  // SECOND STALENESS ROUTE, FOR source='filing' ONLY.
  //
  // WHY IT IS NEEDED: the FY-string test above can only fail on a row whose
  // prose names a fiscal year. Filing-sourced rows frequently name none —
  // BHARATFORG's annual report states its revenue split as a CHART, so
  // pdftotext hands the model detached labels and numbers and the model
  // correctly declines to pair them (prompt rule 2). The row is excellent and
  // its latest_fy is NULL. Under the FY test alone, every such row would be
  // permanently exempt from staleness — a check that cannot fail, which is the
  // precise defect CLAUDE.md section 5 exists to prevent, introduced by the
  // very change that was supposed to fix staleness.
  //
  // So filing rows are aged against the thing they were built from: a stored
  // overview is stale the moment a NEWER annual report exists for that symbol.
  // That has no dependence on prose, no cutoff to tune, and no healthy NULL.
  //
  // MATCH ON title ONLY, never headline — and this is not cosmetic. On its
  // first run this check reported AARTECH and ADOR superseded; both were
  // newspaper/shareholder notices whose HEADLINE prose happened to say "the
  // Annual Report". Neither is a report, so neither rebuild would ever clear
  // the alarm and the check would have cried wolf on every run until someone
  // stopped reading it. Must stay identical to candidates() in
  // build-overview-from-filing.mjs: if the builder and the auditor disagree
  // about what an annual report is, the auditor can demand a rebuild the
  // builder will never satisfy.
  const superseded = await db`
    SELECT o.symbol,
           o.source_filing_date::date AS used,
           max(a.published_at)::date  AS newest
      FROM app.company_overview o
      JOIN app.announcement a ON a.symbol = o.symbol
     WHERE o.source = 'filing'
       AND a.pdf_url IS NOT NULL
       AND a.title ILIKE '%annual report%'
     GROUP BY o.symbol, o.source_filing_date
    HAVING max(a.published_at) > o.source_filing_date + interval '1 day'`;

  console.log(`stored=${total[0].n}  undated=${undated[0].n}  stale=${rows.length}  ` +
              `superseded=${superseded.length}  (cutoff: FY<=${cutoff})`);
  for (const r of rows) {
    console.log(`  STALE  ${r.symbol.padEnd(12)} FY${String(r.latest_fy).slice(2)}  ${r.source}  built ${r.built.toISOString().slice(0, 10)}`);
  }
  for (const r of superseded) {
    console.log(`  SUPERSEDED  ${r.symbol.padEnd(12)} built from ${r.used.toISOString().slice(0, 10)}  newer filing ${r.newest.toISOString().slice(0, 10)}`);
  }
  // `undated` is reported, never failed on: a company whose description names
  // no fiscal year is normal, not stale. Failing on it would make the check
  // cry wolf, which is the only way a check truly dies.
  //
  // The 1-day grace in the HAVING is not slack. Companies file the report and
  // its covering letter minutes apart under the same title, and the builder
  // deliberately picks the LARGER document — which is sometimes the earlier
  // timestamp. Without the grace, every correctly-built row would report itself
  // superseded by its own covering letter on the day it was built.
  await db.end();
  process.exit(rows.length || superseded.length ? 1 : 0);
}

// SPINE / SYSTEM / parseTable / latestFy are exported so the filings-based
// builder (build-overview-from-filing.mjs) uses the SAME table contract rather
// than a copy of it. A copied prompt is a copy that never receives the next
// fix — exactly how the watchlist buy marker drifted from the portfolio's.
// That import means this module is now LOADED, not just run, so the CLI below
// must not fire on import. Without this guard, `import` here would execute the
// whole run — including its writes.
const IS_CLI = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (IS_CLI) (async () => {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const queueIdx = args.indexOf("--queue");
  const queueN = queueIdx >= 0 ? Number(args[queueIdx + 1]) : 0;
  const fileIdx = args.indexOf("--file");
  let symbols = args.filter((a, i) => !a.startsWith("--") && i !== queueIdx + 1);
  if (fileIdx >= 0) {
    symbols = readFileSync(args[fileIdx + 1], "utf8").split(/\s+/).filter(Boolean);
    symbols = symbols.filter((s) => s !== args[fileIdx + 1]);
  }
  if (args.includes("--audit")) {
    if (!process.env.APP_DB_URL) throw new Error("APP_DB_URL not set");
    return audit(postgres(process.env.APP_DB_URL, { max: 1, idle_timeout: 5 }));
  }
  if (queueIdx >= 0 && (!Number.isInteger(queueN) || queueN < 1)) {
    console.error("--queue needs a positive integer, e.g. --queue 80");
    process.exit(2);
  }
  if (!symbols.length && queueIdx < 0) {
    console.error("usage: node scripts/build-company-overview.mjs SYM [SYM...] [--force]\n" +
                  "       node scripts/build-company-overview.mjs --queue 80 [--dry-run]\n" +
                  "       node scripts/build-company-overview.mjs --audit   # staleness sweep, exits 1 on stale rows");
    process.exit(2);
  }
  if (!process.env.APP_DB_URL) throw new Error("APP_DB_URL not set");
  if (!dryRun && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

  const cookie = cookieHeader();
  // A MISSING COOKIE IS FATAL IN QUEUE MODE, AND ONLY IN QUEUE MODE.
  //
  // By hand, falling back to yfinance prose is a choice the operator can see
  // on their own terminal. Unattended it is the exact shape of failure this
  // repo keeps shipping: the job runs, writes 80 rows from the worse source,
  // exits 0, and the degradation is invisible until someone reads a stock page.
  // The announcements cron did precisely this until 2026-09-24.
  if (!cookie) {
    if (queueIdx >= 0) {
      console.error("FAILED: SCREENER_SESSIONID / SCREENER_CSRFTOKEN not set. Every symbol " +
                    "would be written from yfinance prose, which is a silent downgrade. " +
                    "Refusing to run unattended.");
      process.exit(1);
    }
    console.error("!! No Screener cookies — falling back to yfinance prose for every symbol.");
  }

  // `postgres` (porsager) rather than node-postgres — it is what web/src/lib/db.ts
  // already uses, so this script adds no dependency the app does not have.
  const db = postgres(process.env.APP_DB_URL, { max: 2, idle_timeout: 10 });
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  if (queueIdx >= 0) {
    symbols = await selectQueue(db, queueN);
    const due = await db`
      SELECT count(*)::int AS n FROM app.universe u
        LEFT JOIN app.company_overview_attempt a ON a.symbol = u.symbol
       WHERE u.is_active AND (a.retry_after IS NULL OR a.retry_after <= now())`;
    const missing = await db`
      SELECT count(*)::int AS n FROM app.universe u
        LEFT JOIN app.company_overview o ON o.symbol = u.symbol
       WHERE u.is_active AND o.symbol IS NULL`;
    console.log(`queue: ${due[0].n} symbol(s) due, ${missing[0].n} with no overview at all; ` +
                `taking ${symbols.length}`);
    if (dryRun) { console.log(symbols.join(" ")); await db.end(); return; }
    // Not an error. It means the backfill has drained and nothing is due yet —
    // the steady state this job is supposed to reach.
    if (!symbols.length) { console.log("nothing due today."); await db.end(); return; }

    // PRE-FLIGHT SESSION PROBE. Costs one unit of the 80/day allowance and is
    // the difference between catching a dead cookie and discovering it after
    // writing 80 downgraded rows.
    //
    // An EXPIRED Screener session does not error. www.screener.in answers 200
    // with a logged-out page, that page carries no data-url="/wiki/company/..."
    // attribute, and fetchKeyPoints returns null — the SAME value it returns
    // for "this company genuinely has no wiki page". Per symbol the two are
    // indistinguishable. So the run would fall through to yfinance prose for
    // every symbol, print built=80, exit 0, and stamp retry_after = +180 days
    // so nothing revisits the damage for half a year.
    //
    // WHAT MAKES THIS ABLE TO FAIL (CLAUDE.md section 5): the probe symbol is
    // not a constant. It is read from the database as a symbol that ALREADY
    // produced Key Points on a previous run, so a null can only mean the
    // session died — not that we guessed an obscure company. Feed it a
    // garbage cookie and it exits 1; that is the test, and it is in the
    // commit message.
    const probeRow = await db`
      SELECT symbol FROM app.company_overview
       WHERE source = 'screener_keypoints' ORDER BY generated_at DESC LIMIT 1`;
    if (probeRow.length) {
      const probe = await fetchKeyPoints(probeRow[0].symbol, cookie);
      if (probe === QUOTA) {
        console.log(`Screener daily allowance already exhausted (probe ${probeRow[0].symbol}). ` +
                    `Nothing attempted; run again tomorrow.`);
        await db.end(); process.exit(3);
      }
      if (probe === LOGGED_OUT || !probe) {
        console.error(
          `FAILED: session probe on ${probeRow[0].symbol} ` +
          (probe === LOGGED_OUT
            ? `was served Screener's login/register page instead of the wiki fragment.`
            : `returned no Key Points, but that symbol's stored overview WAS built from ` +
              `Key Points, so the page has not simply disappeared.`) +
          ` Refresh SCREENER_SESSIONID / SCREENER_CSRFTOKEN. Nothing was written.`
        );
        await db.end(); process.exit(1);
      }
      console.log(`session probe ${probeRow[0].symbol}: ${probe.length} chars — cookie is live`);
      await sleep(3000);
    }
  }

  const universe = await db`
    SELECT symbol, company_name, sector, coalesce(business_summary,'') AS business_summary
      FROM app.universe WHERE symbol = ANY(${symbols})`;
  const missing = symbols.filter((s) => !universe.find((u) => u.symbol === s));
  if (missing.length) console.error(`!! not in app.universe, skipped: ${missing.join(", ")}`);

  let built = 0, skipped = 0, noInput = 0, protectedRows = 0, quotaHit = false;
  let attempted = 0, gotKeyPoints = 0, loggedOut = false, empty = 0;
  for (const row of universe) {
    const kp = await fetchKeyPoints(row.symbol, cookie);

    // Screener's daily allowance is gone. Every remaining symbol would be
    // written from yfinance prose, which is worse input, so stop rather than
    // spend Anthropic tokens producing rows we would only rebuild tomorrow.
    // Exit 3 is distinct from a real failure: the work done so far is good.
    if (kp === QUOTA) {
      quotaHit = true;
      console.error(
        `\n!! Screener daily key-insights quota exhausted at ${row.symbol} ` +
        `(allowance is ${SCREENER_DAILY_KEYPOINTS}/day, resets tomorrow).\n` +
        `!! Stopping. ${universe.length - built - skipped - noInput} symbol(s) not attempted.`
      );
      break;
    }

    // The session died mid-run. Everything after this point would be written
    // from yfinance prose, silently, and stamped six months fresh. Stop — the
    // work already done is good, exactly as with the quota.
    if (kp === LOGGED_OUT) {
      console.error(`\n!! Screener served its login page at ${row.symbol} — session expired ` +
                    `mid-run. Stopping after ${built} build(s); nothing downgraded.`);
      loggedOut = true;
      break;
    }

    attempted++;
    if (kp) gotKeyPoints++;
    const source = kp ? "screener_keypoints" : "yfinance";
    const text = kp || row.business_summary;

    // NEVER DOWNGRADE. A stored row built from Key Points must not be replaced
    // by one built from yfinance prose — that is a strict loss of input quality
    // and it is what the first 100-run did to 19 symbols under --force before
    // the quota was understood. --force means "rebuild from the best available
    // source", not "rebuild from a worse one".
    if (source === "yfinance") {
      const cur = await db`
        SELECT source FROM app.company_overview WHERE symbol = ${row.symbol}`;
      if (cur[0]?.source === "screener_keypoints") {
        console.log(`${row.symbol.padEnd(12)} keeping existing screener_keypoints row — refusing yfinance downgrade`);
        protectedRows++; await recordAttempt(db, row.symbol, "kept_existing");
        await sleep(3000); continue;
      }
    }

    if (!text) {
      console.log(`${row.symbol.padEnd(12)} no input — skipped`);
      noInput++; await recordAttempt(db, row.symbol, "no_input");
      await sleep(3000); continue;
    }
    const fp = sha(text);

    if (!force) {
      const cur = await db`
        SELECT source_sha256 FROM app.company_overview WHERE symbol = ${row.symbol}`;
      if (cur[0]?.source_sha256 === fp) {
        console.log(`${row.symbol.padEnd(12)} unchanged — skipped`);
        skipped++; await recordAttempt(db, row.symbol, "unchanged");
        await sleep(3000); continue;
      }
    }

    const parsed = await extract(client, row, text);

    // NEVER WRITE AN EMPTY OVERVIEW. This is the backstop to LOGGED_OUT, and
    // it is deliberately independent of it: it holds whatever the cause.
    //
    // A zero-row extraction means the model was handed text it could not turn
    // into a single supportable fact. On 2026-09-24 that text was Screener's
    // registration page and four such rows reached production, each rendering
    // an empty panel and each stamped retry_after = +180 days so nothing would
    // revisit it until March. Writing nothing leaves the panel empty too — but
    // it leaves the symbol in the queue, which is the difference between a gap
    // and a gap that repairs itself.
    //
    // Recorded as an attempt so the queue does not re-serve it tomorrow, but on
    // the SHORT no_input window rather than the 180-day built one.
    if (!parsed.length) {
      console.log(`${row.symbol.padEnd(12)} ${source} gave 0 rows from ${text.length} chars — NOT written`);
      empty++; await recordAttempt(db, row.symbol, "no_input");
      await sleep(3000); continue;
    }

    const fy = latestFy(parsed);
    await db`
      INSERT INTO app.company_overview (symbol, rows, source, model, source_sha256, latest_fy, generated_at)
           VALUES (${row.symbol}, ${db.json(parsed)}, ${source}, ${MODEL}, ${fp}, ${fy}, now())
      ON CONFLICT (symbol) DO UPDATE
            SET rows = EXCLUDED.rows, source = EXCLUDED.source, model = EXCLUDED.model,
                source_sha256 = EXCLUDED.source_sha256, latest_fy = EXCLUDED.latest_fy,
                generated_at = now()`;
    const drift = parsed.filter((p) => !SPINE.includes(p.label)).map((p) => p.label);
    // Rule 3 deleted the Brands row; if it reappears the prompt has been edited
    // back into the failure this spine exists to avoid. Loud, not silent.
    if (parsed.some((p) => /^brands?$/i.test(p.label))) {
      console.error(`!! ${row.symbol}: Brands row re-emitted — rule 3 is not holding`);
    }
    console.log(
      `${row.symbol.padEnd(12)} ${source.padEnd(19)} ${String(text.length).padStart(5)} chars ` +
      `-> ${parsed.length} rows  fy=${fy ?? "-"}${drift.length ? `  [drift: ${drift.join(", ")}]` : ""}`
    );
    built++;
    await recordAttempt(db, row.symbol, "built");
    await sleep(3000);
  }

  console.log(
    `\nbuilt=${built} skipped=${skipped} no_input=${noInput} empty=${empty} ` +
    `kept_existing=${protectedRows}${quotaHit ? " QUOTA_EXHAUSTED" : ""}` +
    `${loggedOut ? " SESSION_EXPIRED" : ""}  key_points=${gotKeyPoints}/${attempted}`
  );
  if (loggedOut) { await db.end(); process.exit(1); }

  // SECOND NET, BEHIND THE PRE-FLIGHT PROBE.
  //
  // The probe catches a session that was already dead at 19:00 UTC. It cannot
  // catch one that EXPIRES MID-RUN — an 80-symbol pass takes ~8 minutes, and a
  // session invalidated at minute three leaves the remaining symbols silently
  // downgraded to yfinance with the probe long since green.
  //
  // WHAT MAKES THIS ABLE TO FAIL. Measured on prod 2026-09-24: 152 of 178
  // stored overviews are source='screener_keypoints', so the observed hit rate
  // on real runs is ~85%. A floor of 25% over at least 10 attempts cannot be
  // tripped by an unlucky batch of obscure smallcaps, and cannot be missed by a
  // dead session, which scores 0%. A measurement with headroom, not a round
  // number chosen to keep the run green (CLAUDE.md section 5).
  const KEYPOINT_FLOOR = 0.25;
  if (queueIdx >= 0 && attempted >= 10 && gotKeyPoints / attempted < KEYPOINT_FLOOR) {
    console.error(
      `\nFAILED: only ${gotKeyPoints}/${attempted} symbols returned Screener Key Points ` +
      `(${(100 * gotKeyPoints / attempted).toFixed(0)}%, floor ${KEYPOINT_FLOOR * 100}%). ` +
      `The session cookie has almost certainly expired — Screener answers 200 with a ` +
      `logged-out page, which is indistinguishable from "no wiki page" per symbol. ` +
      `Refresh SCREENER_SESSIONID / SCREENER_CSRFTOKEN.`
    );
    await db.end();
    process.exit(1);
  }
  // Exit 3 == "stopped early on the Screener quota". A wrapper that re-runs
  // this daily needs to tell that apart from success (0) and from a crash,
  // because the correct response is "run again tomorrow", not "investigate".
  if (quotaHit) { await db.end(); process.exit(3); }
  await db.end();
})();
