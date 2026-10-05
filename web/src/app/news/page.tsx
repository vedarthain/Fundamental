/**
 * /news — aggregated market headlines from broadcaster RSS (Economic Times,
 * LiveMint, BusinessLine, CNBC-TV18, NDTV Profit, Moneycontrol). Headline +
 * summary + a link back to the source only — we never reproduce article text.
 *
 * Server-rendered from app.news (written by scripts/fetch-news.py on a short
 * cron). Categorises + dedups here, then hands off to NewsClient for the
 * interactive layout (Watchlist / Market / Economy / Policy / Others).
 * Fail-soft: missing tables → empty state, not a 500.
 *
 * No per-user data on this page — ISR-cached at the Vercel edge (revalidate
 * 300s). Individual data queries have their own unstable_cache TTLs so
 * background revalidations hit Neon as little as possible.
 */
import { unstable_cache } from "next/cache";
import { sql, golden } from "@/lib/db";
import { clusterByTitle, isNoiseHeadline } from "@/lib/newsCluster";
import { NewsClient, type FeedItem, type NewsCategory, type StockTag } from "./NewsClient";

// No session reads — safe to ISR cache at the edge. Revalidate every 5 min
// (matching getNews TTL so users see fresh headlines without a forced
// per-request render).
export const revalidate = 300;

export const metadata = {
  title: "Market News — latest NSE headlines by category · EquityRoots",
  description:
    "Latest Indian market headlines aggregated from top business outlets — by category (stocks, policy, macro, markets), tagged to the stocks they mention.",
};

type RawNews = {
  id: string; title: string; summary: string | null;
  url: string; published_at: string | null; symbols: string[];
};

type Sentiment = "positive" | "negative" | "neutral";

// A clustered/collapsed headline before our score-context tags are attached.
// Carries `symbols` (the stocks it mentions) so attachTags can look up context.
type Enriched = {
  id: string; title: string; summary: string | null; url: string;
  published_at: string | null; category: NewsCategory; related: number;
  symbols: string[]; regulatory: boolean; sentiment: Sentiment;
};

async function loadNews(): Promise<RawNews[]> {
  try {
    return await sql<RawNews[]>`
      SELECT n.id, n.title, n.summary, n.url, n.published_at::text,
             COALESCE(array_agg(ns.symbol) FILTER (WHERE ns.symbol IS NOT NULL),
                      ARRAY[]::text[]) AS symbols
        FROM app.news n
        LEFT JOIN app.news_stock ns ON ns.news_id = n.id
       -- Show a 30-day window. Two days went blank the moment ingest lagged
       -- (local: newest row 2026-09-18, window empty). Retention in
       -- fetch-news.py is KEEP_DAYS=180; this LIMIT is a payload cap, not
       -- the store. Per-stock pages still read the full retained history.
       WHERE n.published_at > now() - interval '30 days'
       GROUP BY n.id
       ORDER BY n.published_at DESC NULLS LAST
       LIMIT 5000
    `;
  } catch {
    return [];
  }
}
const getNews = unstable_cache(loadNews, ["news-feed-v3"], { revalidate: 300, tags: ["news"] });

// ----- our context for tagged stocks (the differentiator) -----------------
// Industry Score + standout pillar (from app.scores) and today's 1D move (from
// the golden price archive), keyed by symbol. Loaded for ALL scored stocks and
// cached, then looked up per headline — cheaper than a per-request ANY(list).

type StockCtx = {
  symbol: string; company_name: string | null;
  c: number | null; q: number | null; v: number | null; m: number | null;
};
async function loadStockCtx(): Promise<StockCtx[]> {
  try {
    return await sql<StockCtx[]>`
      SELECT u.symbol, u.company_name,
             s.composite_pct AS c, s.quality_pct AS q,
             s.valuation_pct AS v, s.momentum_pct AS m
        FROM app.universe u
        JOIN app.scores s
          ON s.symbol = u.symbol
         AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
    `;
  } catch { return []; }
}
// Scores are weekly snapshots — no need to refetch more than once an hour.
const getStockCtx = unstable_cache(loadStockCtx, ["news-stock-ctx"], { revalidate: 3600, tags: ["news", "market"] });

async function loadMoves1D(): Promise<{ symbol: string; ret_1d: number | null; price: number | null }[]> {
  try {
    return await golden<{ symbol: string; ret_1d: number | null; price: number | null }[]>`
      WITH latest AS (SELECT MAX(date) AS d FROM golden.price_history WHERE interval='1d'),
      prev AS (
        SELECT MAX(date) AS d FROM golden.price_history
         WHERE interval='1d' AND date < (SELECT d FROM latest)
      ),
      t AS (
        SELECT REPLACE(symbol, '.NS', '') AS symbol, close
          FROM golden.price_history, latest
         WHERE interval='1d' AND date = latest.d
      ),
      p AS (
        SELECT REPLACE(symbol, '.NS', '') AS symbol, close
          FROM golden.price_history, prev
         WHERE interval='1d' AND date = prev.d
      )
      SELECT t.symbol,
             t.close::float AS price,
             CASE WHEN p.close > 0 THEN ((t.close - p.close) / p.close * 100)::float ELSE NULL END AS ret_1d
        FROM t LEFT JOIN p ON p.symbol = t.symbol
    `;
  } catch { return []; }
}
// EOD prices update once a day (Saturday fetch) — cache 6h.
const getMoves1D = unstable_cache(loadMoves1D, ["news-moves-1d"], { revalidate: 21600, tags: ["market"] });

const PILLAR = { q: "Q", v: "V", m: "M" } as const;
/** Strongest of the three pillars — a quick "what's this stock good at" cue. */
function topPillar(x: StockCtx): StockTag["top"] {
  const items: { label: "Q" | "V" | "M"; value: number | null }[] = [
    { label: PILLAR.q, value: x.q }, { label: PILLAR.v, value: x.v }, { label: PILLAR.m, value: x.m },
  ];
  let best: { label: "Q" | "V" | "M"; value: number } | null = null;
  for (const it of items) {
    if (it.value != null && (best == null || it.value > best.value)) best = { label: it.label, value: it.value };
  }
  return best;
}

/** Attach our score-context tags to each enriched headline. */
function attachTags(
  items: Enriched[],
  ctx: Map<string, StockCtx>,
  moves: Map<string, { ret_1d: number | null; price: number | null }>,
): FeedItem[] {
  return items.map((n) => {
    const tags: StockTag[] = n.symbols
      .map((sym) => {
        const x = ctx.get(sym);
        const mv = moves.get(sym);
        return {
          symbol: sym,
          company_name: x?.company_name ?? null,
          composite: x?.c ?? null,
          top: x ? topPillar(x) : null,
          ret_1d: mv?.ret_1d ?? null,
          price: mv?.price ?? null,
        };
      })
      // best Industry Score first, so the most recognizable/strong names lead
      .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
    return {
      id: n.id, title: n.title, summary: n.summary, url: n.url,
      published_at: n.published_at, category: n.category, related: n.related,
      regulatory: n.regulatory, sentiment: n.sentiment, tags,
    };
  });
}

// ----- categorisation + dedup (rule-based; no LLM) ------------------------

const POLICY_RE = /\b(sebi|rbi|ministry|minister|budget|gst|tariff|policy|parliament|cabinet|fdi|supreme court|lok sabha)\b/i;
const MACRO_RE  = /\b(inflation|gdp|repo rate|\brepo\b|\biip\b|\bcpi\b|\bwpi\b|rupee|crude|brent|\bfed\b|fomc|\beconomy\b|trade deficit|current account|unemployment|monsoon|forex reserves)\b/i;
const MARKETS_RE = /\b(nifty(?:\s*50)?|sensex|\bfii\b|\bdii\b|bourses?|\bf&o\b|\bipo\b|gift nifty|sgx nifty|bank nifty)\b/i;

function classify(title: string, summary: string | null): NewsCategory {
  const t = `${title} ${summary ?? ""}`;
  if (POLICY_RE.test(t)) return "policy";
  if (MACRO_RE.test(t)) return "macro";
  if (MARKETS_RE.test(t)) return "markets";
  return "general";
}

// Regulatory & governance — a CROSS-CUTTING flag (not a category), so a SEBI
// order on a stock keeps its "Stocks" colour but is ALSO surfaced in the
// Regulatory lane. Tuned for ENFORCEMENT + GOVERNANCE-RISK signals (the
// trust-relevant subset), not every routine SEBI/RBI policy mention — those
// stay in "Policy". High-precision over recall: better to miss a borderline
// item than to flag every regulator mention as a red-flag.
const REGULATORY_RE = new RegExp(
  [
    // SEBI / exchange enforcement actions
    "sebi (order|bar|ban|fine|penal|probe|interim|crackdown|notice|action|summon|impos|restrain)",
    "(barred|banned|debarred|restrained) (from|by)", "show[- ]?cause notice",
    "adjudicat", "disgorge", "impound", "settlement order",
    // Accounting / governance red flags
    "forensic audit", "insider[- ]trading", "(accounting|securities|financial) fraud",
    "misrepresent", "round[- ]?trip", "price (manipulation|rigging)", "front[- ]running",
    "siphon", "fund diversion", "shell (company|companies|firms?)", "related[- ]party transaction",
    // Auditor / disclosure
    "auditor['s ]*(resign|quit|raised? concern)", "qualif(ied|ication) (opinion|of accounts)",
    "adverse opinion", "whistle[- ]?blow", "disclosure (lapse|lapses|breach)", "non[- ]?compliance",
    // Distress / insolvency
    "\\bnclt\\b", "\\bnclat\\b", "insolvency", "\\bibc\\b", "(debt|loan|bond) default", "defaulted on",
    // Investigative agencies
    "enforcement directorate", "\\bcbi\\b (probe|raid|search|case|fir)", "income[- ]tax (raid|search)",
    // Promoter governance
    "promoter pledge", "pledged shares", "delist(ed|ing)", "trading (halt|suspen)",
  ].join("|"),
  "i",
);
function isRegulatory(title: string, summary: string | null): boolean {
  return REGULATORY_RE.test(`${title} ${summary ?? ""}`);
}

// Keyword-based headline sentiment — a directional cue for whether the news
// is broadly positive or negative for the stocks it mentions. High precision
// over recall: better to return "neutral" than to mis-signal direction.
// Applied to `${title} ${summary}` so a summary clause can tip the balance.
const SENTIMENT_POS_RE = new RegExp([
  // Earnings beats
  "(?:beats?|tops?|exceed(?:s|ed)?)\\s+(?:estimate|expectation|forecast|consensus|street)",
  // Profit / revenue growing
  "(?:net\\s+)?profit\\s+(?:rise|rises|jumped?|surge[sd]?|soar[sd]?|up\\b|grew?|hit\\s+record|beat)",
  "revenue\\s+(?:up\\b|rise|rises|jumped?|surge[sd]?)",
  "(?:record|highest)\\s+(?:profit|revenue|sales|quarter|earnings)",
  // Positive analyst actions
  "upgrade[sd]?",
  "target\\s+(?:rais|hik)\\w+",
  "outperform",
  // Corporate events: unambiguously positive
  "dividend\\s+(?:declar|announc|approv)\\w*",
  "bonus\\s+(?:share|issue)\\w*",
  "buyback",
  "wins?\\s+(?:order|contract|deal|bid)\\b",
  "bags?\\s+(?:order|contract)",
  "new\\s+order\\b",
  // Positive performance language
  "strong\\s+(?:result|quarter|growth|performance)\\w*",
  "robust\\s+(?:result|quarter|growth)\\w*",
  "better.than.expected",
].join("|"), "i");

const SENTIMENT_NEG_RE = new RegExp([
  // Losses
  "\\bnet\\s+loss\\b",
  "\\bbooks?\\s+(?:net\\s+)?loss\\b",
  // Profit / revenue falling
  "profit\\s+(?:falls?|drops?|declines?|slumps?|tumbles?|plunges?)",
  "revenue\\s+(?:falls?|drops?|declines?|slumps?|plunges?)",
  // Estimate misses
  "miss(?:es|ed)?\\s+(?:estimate|expectation|forecast|consensus|street)",
  "below\\s+(?:estimate|expectation|forecast|consensus|street)",
  // Negative analyst actions
  "downgrade[sd]?",
  "target\\s+(?:cut|lower|reduc)\\w+",
  "underperform",
  // Guidance / warnings
  "profit\\s+warn\\w+",
  "guidance\\s+(?:cut|lower|reduc)\\w+",
  // Distress
  "\\bdefault(?:s|ed)?\\b",
  "\\bpenalt(?:y|ies)\\b",
  "\\bfined?\\b",
  "\\bfraud\\b",
  "\\bscam\\b",
  "\\bnclt\\b",
  "insolvenc\\w+",
  // Sentiment words
  "disappoint\\w+",
  "worse.than.expected",
  "weaker.than.expected",
  "margin\\s+(?:pressur|compress|squeez)\\w+",
  "\\blayoffs?\\b",
  "retrench\\w+",
].join("|"), "i");

function sentimentOf(title: string, summary: string | null): Sentiment {
  const text = `${title} ${summary ?? ""}`;
  const pos = SENTIMENT_POS_RE.test(text);
  const neg = SENTIMENT_NEG_RE.test(text);
  if (pos && !neg) return "positive";
  if (neg && !pos) return "negative";
  return "neutral"; // conflict or neither → stay neutral
}

// Display-time recommendation / tip filter — a second line of defence that
// drops any headline that slipped through the ingest filter (old rows, RSS
// encoding quirks). Keep in sync with RECO_RE in scripts/fetch-news.py.
// "shares?" added alongside "stocks?" to catch "Shares to buy or sell" form.
const DISPLAY_RECO_RE = /\b(?:stocks?|shares?)\s+to\s+(?:buy|sell|bet|grab|add)\b|\b\d+\s+(?:stocks?|shares?)\s+to\s+(?:buy|sell|bet|grab|add|watch)\b|\brecommends?\s+(?:\w+\s+){0,3}(?:stocks?|shares?)\s+to\s+(?:buy|sell)\b|\btop\s+(?:stock\s+)?picks?\b|\bstock\s+picks?\b|\bbuy\s+or\s+sell\b|\bshould\s+you\s+(?:buy|sell|invest)\b|\bmulti-?bagger\w*|\bstock\s+tips?\b|\b(?:stock|share)\s+recommendations?\b|\btrade\s+setups?\b|\btrading\s+guide\b|\bf&o\s+(?:strateg|pick|trade)\w*|\bintraday\s+(?:pick|tip|trade)\w*|\bbuy\s+this\s+stock\b|\bbest\s+(?:stocks?|shares?)\s+to\b|\bhot\s+stocks?\b/i;

/** Build the feed: drop recommendation/tip headlines, then cluster
 *  near-identical titles. Do not fold every single-stock story into one
 *  card — Watchlist is stock → headlines, and that needs the distinct
 *  stories kept. */
function enrich(rows: RawNews[]): Enriched[] {
  // Drop tip/recommendation headlines at display time (defence-in-depth).
  const noReco = rows.filter(
    (r) =>
      !DISPLAY_RECO_RE.test(`${r.title} ${r.summary ?? ""}`) &&
      !isNoiseHeadline(r.title),
  );
  const clustered = clusterByTitle(noReco, 0.45);
  return clustered.map((r) => ({
    id: r.id, title: r.title, summary: r.summary, url: r.url,
    published_at: r.published_at, related: r.related,
    category: classify(r.title, r.summary),
    symbols: r.symbols,
    regulatory: isRegulatory(r.title, r.summary),
    sentiment: sentimentOf(r.title, r.summary),
  }));
}

export default async function NewsPage() {
  const [rawNews, ctxRows, moveRows] = await Promise.all([
    getNews(), getStockCtx(), getMoves1D(),
  ]);

  // Index our context by symbol, then attach to each headline.
  const ctxMap = new Map(ctxRows.map((r) => [r.symbol, r]));
  const moveMap = new Map(moveRows.map((r) => [r.symbol, { ret_1d: r.ret_1d, price: r.price }]));
  const news = attachTags(enrich(rawNews), ctxMap, moveMap);

  return (
    <div className="mx-auto max-w-[1200px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-4">
        <h1 className="font-display text-[22px] md:text-[26px] leading-tight">Market News</h1>
        <p className="muted-text text-[12px] mt-1">
          Watchlist names, then the market, economy and policy wires. Last 30 days.
        </p>
      </header>

      {news.length === 0 ? (
        <div className="card p-6 muted-text text-[13px]">No headlines yet.</div>
      ) : (
        <NewsClient news={news} />
      )}
    </div>
  );
}
