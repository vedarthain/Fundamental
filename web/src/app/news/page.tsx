/**
 * /news — aggregated market headlines from broadcaster RSS (Economic Times,
 * LiveMint, BusinessLine, CNBC-TV18, NDTV Profit, Moneycontrol). Headline +
 * summary + a link back to the source only — we never reproduce article text.
 *
 * Server-rendered from app.news (written by scripts/fetch-news.py on a short
 * cron). Categorises + dedups here, then hands off to NewsClient for the
 * interactive layout (category tabs, most-talked strip, watchlist sidebar).
 * Fail-soft: missing tables → empty state, not a 500.
 */
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NewsClient, type FeedItem, type NewsCategory, type TalkedItem, type WatchItem } from "./NewsClient";

// Reads the session cookie for the per-user watchlist sidebar, so the page
// renders per-request. The heavy public queries stay cached via unstable_cache.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Market News — latest NSE headlines by category · EquityRoots",
  description:
    "Latest Indian market headlines aggregated from top business outlets — by category (stocks, policy, macro, markets), tagged to the stocks they mention.",
};

type RawNews = {
  id: string; title: string; summary: string | null;
  url: string; published_at: string | null; symbols: string[];
};

async function loadNews(): Promise<RawNews[]> {
  try {
    return await sql<RawNews[]>`
      SELECT n.id, n.title, n.summary, n.url, n.published_at::text,
             COALESCE(array_agg(ns.symbol) FILTER (WHERE ns.symbol IS NOT NULL),
                      ARRAY[]::text[]) AS symbols
        FROM app.news n
        LEFT JOIN app.news_stock ns ON ns.news_id = n.id
       -- Show a fixed 2-day window (predictable "last 2 days" regardless of
       -- feed volume), not a fixed count. Retention stays 30d for per-stock
       -- cards. LIMIT is just a payload safety bound.
       WHERE n.published_at > now() - interval '2 days'
       GROUP BY n.id
       ORDER BY n.published_at DESC NULLS LAST
       LIMIT 400
    `;
  } catch {
    return [];
  }
}
const getNews = unstable_cache(loadNews, ["news-feed-v2"], { revalidate: 300, tags: ["news"] });

// "Most talked about" — stocks ranked by headline mentions in the last 3 days,
// with their latest composite percentile for a quality cue.
async function loadMostTalkedAbout(): Promise<TalkedItem[]> {
  try {
    return await sql<TalkedItem[]>`
      SELECT ns.symbol, u.company_name, COUNT(*)::int AS mentions, s.composite_pct
        FROM app.news_stock ns
        JOIN app.news n     ON n.id = ns.news_id
        JOIN app.universe u ON u.symbol = ns.symbol
        LEFT JOIN app.scores s
          ON s.symbol = ns.symbol
         AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
       WHERE n.published_at > now() - interval '3 days'
       GROUP BY ns.symbol, u.company_name, s.composite_pct
       ORDER BY mentions DESC, ns.symbol
       LIMIT 12
    `;
  } catch {
    return [];
  }
}
const getTalked = unstable_cache(loadMostTalkedAbout, ["news-talked"], { revalidate: 300, tags: ["news"] });

// Per-user: headlines tagged to any stock on the signed-in user's watchlist.
async function loadWatchlistNews(userId: number): Promise<WatchItem[]> {
  try {
    return await sql<WatchItem[]>`
      SELECT n.id, n.title, n.url, n.published_at::text
        FROM app.news n
       WHERE n.id IN (
               SELECT ns.news_id FROM app.news_stock ns
                WHERE ns.symbol IN (SELECT symbol FROM app.user_watchlist WHERE user_id = ${userId})
             )
       ORDER BY n.published_at DESC NULLS LAST
       LIMIT 20
    `;
  } catch {
    return [];
  }
}

/** How many stocks the user watches — to tell "empty watchlist" apart from
 *  "watchlist has stocks but none are in the news right now". */
async function loadWatchlistCount(userId: number): Promise<number> {
  try {
    const r = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM app.user_watchlist WHERE user_id = ${userId}
    `;
    return r[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

// ----- categorisation + dedup (rule-based; no LLM) ------------------------

const POLICY_RE = /\b(sebi|rbi|govern|govt|ministry|minister|budget|\btax\b|gst|tariff|policy|polic|regulat|parliament|cabinet|fdi|sebi|supreme court|lok sabha|union)\b/i;
const MACRO_RE  = /\b(inflation|gdp|repo rate|\brepo\b|\biip\b|\bcpi\b|\bwpi\b|rupee|crude|brent|\bfed\b|fomc|economy|economic|trade deficit|current account|unemployment|jobs data|monsoon|forex|reserves)\b/i;
const MARKETS_RE = /\b(nifty|sensex|\bfii\b|\bdii\b|sell-?off|rally|markets?|bourses?|\bindex\b|indices|futures|f&o|\bipo\b|listing|bull|bear)\b/i;

function classify(title: string, summary: string | null, tagged: boolean): NewsCategory {
  if (tagged) return "stocks";
  const t = `${title} ${summary ?? ""}`;
  if (POLICY_RE.test(t)) return "policy";
  if (MACRO_RE.test(t)) return "macro";
  if (MARKETS_RE.test(t)) return "markets";
  return "general";
}

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "was", "its", "into", "after", "over", "amid", "say", "says", "will"]);
function titleTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Cluster near-identical headlines (same story across outlets / re-posts) so
 *  10 re-reports read as ~3 stories. Keeps the first (most recent) of each
 *  cluster as the representative and counts the rest as `related`. Generic so
 *  the feed and the watchlist sidebar cluster the same way. */
function clusterByTitle<T extends { title: string }>(rows: T[]): (T & { related: number })[] {
  const reps: (T & { related: number })[] = [];
  const repTokens: Set<string>[] = [];
  for (const r of rows) {
    const tk = titleTokens(r.title);
    const hit = repTokens.findIndex((k) => jaccard(k, tk) >= 0.6);
    if (hit >= 0) {
      reps[hit].related += 1; // fold into the existing story
      continue;
    }
    repTokens.push(tk);
    reps.push({ ...r, related: 0 });
  }
  return reps;
}

/** Build the feed: (1) cluster near-identical titles, then (2) collapse
 *  repeated SINGLE-stock stories into one card. Step 2 is what stops one busy
 *  name (e.g. a Vedanta demerger spawning 6 differently-worded headlines, all
 *  tagged only to VEDL) from flooding the feed — token overlap is too low to
 *  cluster them, but they share the sole stock + window, so we fold them.
 *  Multi-stock headlines (market round-ups) are left alone. */
function enrich(rows: RawNews[]): FeedItem[] {
  const clustered = clusterByTitle(rows);
  const out: FeedItem[] = [];
  const repBySymbol = new Map<string, number>(); // sole symbol → index in out
  for (const r of clustered) {
    const sole = r.symbols.length === 1 ? r.symbols[0] : null;
    if (sole !== null && repBySymbol.has(sole)) {
      out[repBySymbol.get(sole)!].related += 1 + r.related; // fold in
      continue;
    }
    if (sole !== null) repBySymbol.set(sole, out.length);
    out.push({
      id: r.id, title: r.title, summary: r.summary, url: r.url,
      published_at: r.published_at, related: r.related,
      category: classify(r.title, r.summary, r.symbols.length > 0),
    });
  }
  return out;
}

export default async function NewsPage() {
  const session = await getSession();
  const [rawNews, talked] = await Promise.all([getNews(), getTalked()]);
  const [watchRaw, watchlistCount] = session
    ? await Promise.all([loadWatchlistNews(session.userId), loadWatchlistCount(session.userId)])
    : [[], 0];
  const watchNews = clusterByTitle(watchRaw);
  const news = enrich(rawNews);

  return (
    <div className="mx-auto max-w-[1200px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-4">
        <h1 className="font-display text-[22px] md:text-[26px] leading-tight">Market News</h1>
        <p className="muted-text text-[12px] mt-1">
          Aggregated market headlines · by category · links open the source
        </p>
      </header>

      {news.length === 0 ? (
        <div className="card p-6 muted-text text-[13px]">No headlines yet.</div>
      ) : (
        <NewsClient news={news} talked={talked} watchNews={watchNews} signedIn={!!session} watchlistCount={watchlistCount} />
      )}
    </div>
  );
}
