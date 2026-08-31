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
const NOISE = [
  "postal ballot", "e-voting", "notice is hereby", "annual general meeting",
  "extraordinary general", "agm", "egm", "allotment", "letter of offer",
  "public announcement", "registered office", "corporate identity number",
  "cin:", "cin ", "book closure", "record date", "unclaimed", "transfer to iepf",
  "investor education", "tender", "auction", "expression of interest",
  "request for proposal", "rfp", "prospectus", "red herring", "basis of allotment",
  "scheme of arrangement", "nclt", "insolvency", "liquidation", "e-auction",
  "sale notice", "possession notice", "sarfaesi", "demand notice",
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
 * keep only the news-looking pages.
 * Heuristic: keep a page when its news-signal density clears a floor AND it
 * isn't drowned in legal-notice noise. A page with almost no words (image ads)
 * is dropped. Bias toward keeping when uncertain; hard-cap the survivors so a
 * pathological file can't blow the token budget.
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
    // Per-1000-word densities so page length doesn't dominate.
    const newsDensity = words > 0 ? (news / words) * 1000 : 0;
    const noiseDensity = words > 0 ? (noise / words) * 1000 : 0;
    return { idx, raw, words, newsDensity, noiseDensity };
  });

  const kept = scored.filter((pg) => {
    if (pg.words < 120) return false; // near-empty / image-only ad page
    if (pg.noiseDensity > 12 && pg.noiseDensity > pg.newsDensity) return false; // legal-notice page
    return pg.newsDensity >= 6; // has real editorial density
  });

  // Fallback: if the filter was too aggressive (nothing survived), keep the
  // wordiest pages so the admin still gets *something* to review.
  const survivors = (kept.length > 0 ? kept : [...scored].sort((a, b) => b.words - a.words).slice(0, 6))
    .sort((a, b) => a.idx - b.idx)
    .slice(0, 8); // hard cap — bounds tokens (~8 pages ≈ well within budget)

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
const SYSTEM_PROMPT = `You are the editor of a concise daily market brief for a single Indian equity investor.

You will be given the raw extracted text of a few pages from an Indian financial newspaper. Your job is to distill it into a structured "Morning Brief".

Rules:
- Focus on India equity markets, listed companies, sectors, macro (RBI/SEBI/government policy), and results/earnings. Ignore lifestyle, sports, opinion fluff, classifieds and advertisements.
- Group items into a few sections (e.g. "Markets", "Companies", "Economy & Policy", "Sectors"). Use only sections that have real content.
- Each item: a short factual title and a 1-2 sentence summary. Neutral wire-service tone. Do NOT copy sentences verbatim from the source — rewrite in your own words.
- For every item, list the NSE-listed companies it is about in "mentions" as their common company names (e.g. "Reliance Industries", "HDFC Bank"). Only include companies that are clearly the subject. Leave "mentions" as [] if none.
- Omit anything that is a public notice, AGM/EGM notice, allotment, tender, or advertisement.

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
