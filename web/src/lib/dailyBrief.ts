/**
 * Daily "Morning Brief" — admin-only epaper synthesis.
 *
 * PIPELINE (all in-memory; the PDF is NEVER persisted):
 *   1. unpdf extracts per-page text from the uploaded epaper PDF.
 *   2. A keyword-density filter drops the notice/AGM/allotment/tender pages,
 *      keeping the ~handful of real news pages (see NOISE/NEWS below). We err
 *      toward KEEPING — a missed news page is worse than an extra noisy one.
 *   3. Claude (claude-sonnet-4-6) synthesizes the kept text into a structured
 *      brief: sections → items → { title, summary, mentions }. The system
 *      prompt is stable and cache_control-marked so re-runs hit the prompt cache.
 *   4. Model-named company "mentions" are resolved against app.universe here on
 *      the server (exact symbol, else company_name match) — the model never sees
 *      the 2,150-symbol list, and only symbols WE can price get linked.
 *   5. The derived brief JSON is upserted into app.daily_brief. No source text,
 *      no PDF, no publisher article bodies are stored — only our summary.
 *
 * Everything here is admin-gated by the callers (API route + pages). This module
 * does no auth itself; it assumes the caller already checked isAdminRequest().
 */
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";

export const BRIEF_MODEL = "claude-sonnet-4-6";

// Supported epaper sources. Value is the storage key (app.daily_brief.paper).
export const BRIEF_PAPERS = {
  "financial-express": "Financial Express",
  "business-standard": "Business Standard",
} as const;
export type BriefPaper = keyof typeof BRIEF_PAPERS;

export function isBriefPaper(x: string): x is BriefPaper {
  return Object.prototype.hasOwnProperty.call(BRIEF_PAPERS, x);
}

// ── Derived brief shape (matches app.daily_brief.sections jsonb) ──
export type BriefItem = {
  title: string;
  summary: string;
  symbols: string[]; // resolved NSE symbols (subset of app.universe)
};
export type BriefSection = {
  heading: string;
  items: BriefItem[];
};
export type BriefPayload = {
  sections: BriefSection[];
  symbols: string[]; // flat, deduped union of every item's symbols
};

export type StoredBrief = {
  id: string;
  paper: BriefPaper;
  paperLabel: string;
  briefDate: string;
  generatedAt: string;
  model: string | null;
  sourcePages: number | null;
  sections: BriefSection[];
  symbols: string[];
};

// ────────────────────────────────────────────────────────────────────────────
// 1 + 2.  PDF → per-page text → news-page filter
// ────────────────────────────────────────────────────────────────────────────

// Boilerplate/legal noise that dominates the ad/notice pages we want to drop.
// Includes formal-disclosure markers: in a financial paper the SEBI results
// tables and statutory notices are the MOST keyword-dense pages, so we must
// recognise their formal vocabulary to keep them from crowding out real news.
const NOISE = [
  "postal ballot", "e-voting", "notice is hereby", "annual general meeting",
  "extraordinary general", "agm", "egm", "allotment", "letter of offer",
  "public announcement", "registered office", "corporate identity number",
  "cin:", "cin ", "book closure", "record date", "unclaimed", "transfer to iepf",
  "investor education", "tender", "auction", "expression of interest",
  "request for proposal", "rfp", "prospectus", "red herring", "basis of allotment",
  "scheme of arrangement", "nclt", "insolvency", "liquidation", "e-auction",
  "sale notice", "possession notice", "sarfaesi", "demand notice",
  // Statutory financial-results & balance-sheet table vocabulary:
  "quarter ended", "year ended", "half year ended", "period ended",
  "balance sheet", "cash flow", "unaudited", "audited", "standalone",
  "consolidated results", "statement of", "extract of", "particulars",
  "listing regulations", "listing obligations", "face value", "isin",
  "regd. office", "regd office", "corresponding", "preceding", "iepf",
];
// Signals a page is real editorial/news copy.
const NEWS = [
  "said", "reported", "according to", "company", "market", "shares", "stock",
  "revenue", "profit", "growth", "quarter", "crore", "percent", "per cent",
  "government", "rbi", "sebi", "economy", "sector", "investors", "analysts",
  "rose", "fell", "gained", "board", "ceo", "managing director", "billion",
];

function countHits(hay: string, needles: string[]): number {
  let n = 0;
  for (const w of needles) {
    let i = hay.indexOf(w);
    while (i !== -1) {
      n++;
      i = hay.indexOf(w, i + w.length);
    }
  }
  return n;
}

/**
 * Given per-page text (already extracted in the browser — see DailyBriefClient),
 * keep the editorial-news pages and drop the tables/notices/ads.
 *
 * The key discriminator is DIGIT RATIO. A financial paper's worst pages for us —
 * stock-price lists, SEBI results tables, balance sheets — are number-dense;
 * editorial prose (the Vi tariff story, the E2W sales feature) is not. A pure
 * NEWS-keyword filter is backwards here because those tables are stuffed with
 * "profit/revenue/crore/board", so they out-score real stories. We therefore
 * drop number-heavy pages, drop notice-vocabulary pages, and keep prose. Claude
 * does the final editorial judgement (see SYSTEM_PROMPT) — this stage only has
 * to stop the junk pages from crowding out the news.
 *
 * Extraction lives on the client so the PDF binary never traverses a serverless
 * function (Vercel caps request bodies at ~4.5 MB; epapers are 10-50 MB). Only
 * the extracted text is sent to the API, which then calls this.
 */
export function filterNewsPages(
  pages: string[],
): { text: string; keptPages: number; totalPages: number } {
  const total = pages.length;

  const scored = pages.map((rawIn, idx) => {
    const raw = rawIn ?? "";
    const lower = raw.toLowerCase();
    const words = lower.split(/\s+/).filter(Boolean).length;
    const news = countHits(lower, NEWS);
    const noise = countHits(lower, NOISE);
    // Digit ratio: digits / (digits + letters). Prose ≈ 0.02-0.06; price/results
    // tables ≈ 0.20-0.45. The single best signal for "table vs article".
    const digits = (raw.match(/\d/g) ?? []).length;
    const letters = (raw.match(/[A-Za-z]/g) ?? []).length;
    const digitRatio = digits + letters > 0 ? digits / (digits + letters) : 0;
    // Per-1000-word densities so page length doesn't dominate.
    const newsDensity = words > 0 ? (news / words) * 1000 : 0;
    const noiseDensity = words > 0 ? (noise / words) * 1000 : 0;
    return { idx, raw, words, newsDensity, noiseDensity, digitRatio };
  });

  const kept = scored.filter((pg) => {
    if (pg.words < 120) return false; // near-empty / image-only ad page
    if (pg.digitRatio > 0.16) return false; // price list / results table, not prose
    if (pg.noiseDensity > 8 && pg.noiseDensity >= pg.newsDensity) return false; // notice/disclosure page
    return pg.newsDensity >= 3; // some editorial density (loose — tables already gone)
  });

  // Fallback: if the filter was too aggressive (nothing survived), keep the
  // most prose-like pages (lowest digit ratio, enough words) so the admin still
  // gets *something* to review.
  const fallback = [...scored]
    .filter((p) => p.words >= 120)
    .sort((a, b) => a.digitRatio - b.digitRatio)
    .slice(0, 12);

  const survivors = (kept.length > 0 ? kept : fallback)
    .sort((a, b) => a.idx - b.idx)
    .slice(0, 16); // hard cap — text is cheap (~16 pages ≈ well within budget)

  const text = survivors
    .map((pg) => `--- PAGE ${pg.idx + 1} ---\n${pg.raw.trim()}`)
    .join("\n\n");

  return { text, keptPages: survivors.length, totalPages: total };
}

// ────────────────────────────────────────────────────────────────────────────
// 3.  Claude synthesis
// ────────────────────────────────────────────────────────────────────────────

// Stable system prompt — cache_control-marked so repeated same-day/next-day
// runs read it from the prompt cache instead of re-billing the prefix.
const SYSTEM_PROMPT = `You are the editor of a concise daily market brief for a single Indian equity investor. You are sharp, specific, and allergic to vague filler.

You will be given the raw extracted text of pages from an Indian financial newspaper. The extraction is messy: headlines, body paragraphs, chart labels, captions, ads, public notices, and results tables are all interleaved and out of order. Your job is to find the real EDITORIAL NEWS STORIES and distill each into a specific, fact-carrying brief item.

WHAT TO EXTRACT (in priority order):
- Company-specific news: earnings, deals, launches, management moves, guidance, capex, orders, regulatory actions, stake changes.
- Sector/industry trends with named players (e.g. telecom ARPU, EV/2-wheeler sales, banking credit growth).
- Macro & policy: RBI, SEBI, government, budget, rates, inflation, trade.
- Market moves with a reason (index levels, big movers and WHY).

WHAT TO IGNORE COMPLETELY (do not create items for these):
- Statutory/public notices, AGM/EGM notices, postal ballots, allotments, tenders.
- SEBI-format financial-result tables and balance sheets (the formatted disclosure tables — NOT genuine earnings news stories).
- Raw stock-price / market-data tables (lists of scrips with numbers).
- Advertisements, classifieds, lifestyle, sports, opinion fluff.

SPECIFICITY IS MANDATORY. Every item MUST carry concrete facts pulled from the text: named companies, people, numbers (revenue, growth %, prices, ARPU, subscriber/sales counts, ₹ amounts), and the actual development.
- GOOD: "Vodafone Idea faces a tariff dilemma: it needs ARPU hikes (Q1 FY27 ARPU ₹195) but a steep rise risks its first subscriber gains since the merger (193.1mn base), even as Jio (ARPU ₹185) and Airtel (ARPU ₹264) push premium plans."
- BAD (NEVER produce): "Market data tables indicate trading activity", "Multiple companies reported quarterly results", "Several companies filed regulatory disclosures". These are worthless category labels. If you cannot state a specific fact, DROP the item entirely.

Rules:
- Group items into sections (e.g. "Markets", "Companies", "Economy & Policy", "Sectors"). Use only sections with real content. Order sections by importance.
- Each item: a specific factual title and a 1-3 sentence summary carrying the key numbers/facts. Neutral wire-service tone. Rewrite in your own words — do NOT copy sentences verbatim.
- Aim for 8-20 substantive items if the source supports it. Quality over padding, but do not be lazy — extract every genuine story you can find.
- For every item, list the NSE-listed companies it is about in "mentions" as their common company names (e.g. "Vodafone Idea", "Bharti Airtel", "TVS Motor"). Only companies clearly central to the item. Leave "mentions" as [] if none.

Respond with ONLY a JSON object (no markdown code fences, no prose) of exactly this shape:
{"sections":[{"heading":"string","items":[{"title":"string","summary":"string","mentions":["string"]}]}]}`;

type RawItem = { title?: unknown; summary?: unknown; mentions?: unknown };
type RawSection = { heading?: unknown; items?: unknown };

function coerceStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => String(v ?? "").trim()).filter(Boolean);
}

/** Strip an accidental ```json … ``` fence if the model adds one anyway. */
function stripFence(s: string): string {
  const t = s.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
  }
  return t;
}

/**
 * Call Claude to synthesize the brief. Returns sections with raw model
 * "mentions" (company-name strings) NOT yet resolved to symbols.
 */
async function synthesize(
  paperLabel: string,
  briefDate: string,
  pageText: string,
): Promise<{ heading: string; items: { title: string; summary: string; mentions: string[] }[] }[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — cannot synthesize the brief.");
  }
  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 8000,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Newspaper: ${paperLabel}\nEdition date: ${briefDate}\n\nExtracted pages:\n\n${pageText}`,
      },
    ],
  });

  const textPart = msg.content.find((b) => b.type === "text");
  const rawText = textPart && "text" in textPart ? textPart.text : "";
  if (!rawText) throw new Error("Claude returned no text for the brief.");

  let parsed: { sections?: unknown };
  try {
    parsed = JSON.parse(stripFence(rawText));
  } catch {
    throw new Error("Claude returned unparseable JSON for the brief.");
  }

  const sectionsRaw = Array.isArray(parsed.sections) ? (parsed.sections as RawSection[]) : [];
  return sectionsRaw
    .map((sec) => {
      const heading = String(sec.heading ?? "").trim();
      const itemsRaw = Array.isArray(sec.items) ? (sec.items as RawItem[]) : [];
      const items = itemsRaw
        .map((it) => ({
          title: String(it.title ?? "").trim(),
          summary: String(it.summary ?? "").trim(),
          mentions: coerceStringArray(it.mentions),
        }))
        .filter((it) => it.title || it.summary);
      return { heading, items };
    })
    .filter((sec) => sec.heading && sec.items.length > 0);
}

// ────────────────────────────────────────────────────────────────────────────
// 4.  Resolve model "mentions" → canonical app.universe symbols
// ────────────────────────────────────────────────────────────────────────────

/**
 * Map a batch of free-text company mentions to NSE symbols. Two passes against
 * app.universe (active only): exact symbol match, then company_name match
 * (normalized, punctuation/suffix-insensitive). Unresolved mentions are dropped
 * — we only link symbols we can actually price. Returns a Map keyed by the
 * ORIGINAL mention string (lowercased) → symbol.
 */
async function resolveMentions(mentions: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(mentions.map((m) => m.trim()).filter(Boolean))];
  if (unique.length === 0) return out;

  const rows = await sql<{ symbol: string; company_name: string | null }[]>`
    SELECT symbol, company_name FROM app.universe WHERE is_active
  `;

  // Normalize: lowercase, drop punctuation + common corporate suffixes, squeeze
  // whitespace. "Reliance Industries Ltd." → "reliance industries".
  const SUFFIX = /\b(ltd|limited|ltd\.|inc|corp|co|company|pvt|private|and|&)\b/g;
  const norm = (s: string) =>
    s.toLowerCase().replace(/[.,'"()\-]/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();

  const bySymbol = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const r of rows) {
    bySymbol.set(r.symbol.toLowerCase(), r.symbol);
    if (r.company_name) {
      const n = norm(r.company_name);
      if (n && !byName.has(n)) byName.set(n, r.symbol);
    }
  }

  for (const m of unique) {
    const key = m.toLowerCase();
    // Pass 1: exact symbol (model sometimes returns the ticker directly).
    const sym = bySymbol.get(key);
    if (sym) {
      out.set(key, sym);
      continue;
    }
    // Pass 2: normalized company-name equality.
    const byN = byName.get(norm(m));
    if (byN) out.set(key, byN);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Orchestration + persistence
// ────────────────────────────────────────────────────────────────────────────

/**
 * Full pipeline for browser-extracted page text: filter → synthesize → resolve →
 * upsert. Returns the stored brief. No PDF ever reaches the server — the client
 * extracts text and sends only the per-page strings (see DailyBriefClient).
 */
export async function processBriefPages(
  paper: BriefPaper,
  briefDate: string,
  pages: string[],
): Promise<StoredBrief> {
  const paperLabel = BRIEF_PAPERS[paper];
  const { text, keptPages } = filterNewsPages(pages);
  if (!text.trim()) {
    throw new Error(
      "No readable news text in that PDF. If it's a scanned-image edition (no selectable text), synthesis isn't possible without OCR.",
    );
  }

  const rawSections = await synthesize(paperLabel, briefDate, text);

  // Resolve mentions across every item in one DB pass.
  const allMentions = rawSections.flatMap((s) => s.items.flatMap((it) => it.mentions));
  const resolved = await resolveMentions(allMentions);

  const sections: BriefSection[] = rawSections.map((s) => ({
    heading: s.heading,
    items: s.items.map((it) => ({
      title: it.title,
      summary: it.summary,
      symbols: [...new Set(it.mentions.map((m) => resolved.get(m.toLowerCase())).filter((x): x is string => !!x))],
    })),
  }));

  const flatSymbols = [...new Set(sections.flatMap((s) => s.items.flatMap((it) => it.symbols)))];

  await sql`
    INSERT INTO app.daily_brief (paper, brief_date, model, source_pages, sections, symbols)
    VALUES (${paper}, ${briefDate}, ${BRIEF_MODEL}, ${keptPages},
            ${sql.json(sections)}, ${flatSymbols})
    ON CONFLICT (paper, brief_date) DO UPDATE
      SET generated_at = now(),
          model        = EXCLUDED.model,
          source_pages = EXCLUDED.source_pages,
          sections     = EXCLUDED.sections,
          symbols      = EXCLUDED.symbols
  `;

  const stored = await getBrief(paper, briefDate);
  if (!stored) throw new Error("Brief saved but could not be re-read.");
  return stored;
}

type BriefRow = {
  id: string;
  paper: string;
  brief_date: string;
  generated_at: string;
  model: string | null;
  source_pages: number | null;
  sections: BriefSection[];
  symbols: string[] | null;
};

function toStored(r: BriefRow): StoredBrief {
  const paper = (isBriefPaper(r.paper) ? r.paper : "financial-express") as BriefPaper;
  return {
    id: r.id,
    paper,
    paperLabel: BRIEF_PAPERS[paper] ?? r.paper,
    briefDate: r.brief_date,
    generatedAt: r.generated_at,
    model: r.model,
    sourcePages: r.source_pages,
    sections: Array.isArray(r.sections) ? r.sections : [],
    symbols: r.symbols ?? [],
  };
}

export async function getBrief(paper: BriefPaper, briefDate: string): Promise<StoredBrief | null> {
  const rows = await sql<BriefRow[]>`
    SELECT id::text, paper, brief_date::text, generated_at::text, model, source_pages,
           sections, symbols
      FROM app.daily_brief
     WHERE paper = ${paper} AND brief_date = ${briefDate}
     LIMIT 1
  `;
  return rows.length ? toStored(rows[0]) : null;
}

/** Newest brief overall (any paper) — what /news shows by default. */
export async function latestBrief(): Promise<StoredBrief | null> {
  const rows = await sql<BriefRow[]>`
    SELECT id::text, paper, brief_date::text, generated_at::text, model, source_pages,
           sections, symbols
      FROM app.daily_brief
     ORDER BY brief_date DESC, generated_at DESC
     LIMIT 1
  `;
  return rows.length ? toStored(rows[0]) : null;
}

/** Lightweight list for the admin picker (no sections payload). */
export async function listBriefs(limit = 60): Promise<
  { id: string; paper: BriefPaper; paperLabel: string; briefDate: string; generatedAt: string; itemCount: number }[]
> {
  const rows = await sql<
    { id: string; paper: string; brief_date: string; generated_at: string; item_count: number }[]
  >`
    SELECT id::text, paper, brief_date::text, generated_at::text,
           COALESCE((SELECT sum(jsonb_array_length(s->'items'))
                       FROM jsonb_array_elements(sections) s), 0)::int AS item_count
      FROM app.daily_brief
     ORDER BY brief_date DESC, generated_at DESC
     LIMIT ${limit}
  `;
  return rows.map((r) => {
    const paper = (isBriefPaper(r.paper) ? r.paper : "financial-express") as BriefPaper;
    return {
      id: r.id,
      paper,
      paperLabel: BRIEF_PAPERS[paper] ?? r.paper,
      briefDate: r.brief_date,
      generatedAt: r.generated_at,
      itemCount: Number(r.item_count),
    };
  });
}

export async function deleteBrief(id: string): Promise<boolean> {
  const del = await sql<{ id: string }[]>`
    DELETE FROM app.daily_brief WHERE id = ${Number(id)} RETURNING id::text
  `;
  return del.length > 0;
}

/** Briefs mentioning a symbol — for admin-only context on a stock page. */
export async function briefsForSymbol(symbol: string, limit = 5): Promise<StoredBrief[]> {
  const rows = await sql<BriefRow[]>`
    SELECT id::text, paper, brief_date::text, generated_at::text, model, source_pages,
           sections, symbols
      FROM app.daily_brief
     WHERE ${symbol} = ANY(symbols)
     ORDER BY brief_date DESC
     LIMIT ${limit}
  `;
  return rows.map(toStored);
}
