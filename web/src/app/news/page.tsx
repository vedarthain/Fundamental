/**
 * /news — aggregated market headlines from broadcaster RSS (Economic Times,
 * LiveMint, Hindu BusinessLine, Moneycontrol). Headline + summary + a link
 * back to the source only — we never reproduce article text.
 *
 * Server-rendered from app.news (written by scripts/fetch-news.py on a short
 * cron). Fail-soft: if the table isn't present yet (migration 0033 not
 * applied), render an empty state rather than 500.
 */
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { band, bandColor, displayCompanyName } from "@/lib/score";
import { getSession } from "@/lib/auth";

// Reads the session cookie for the per-user "watchlist news" section, so the
// page renders per-request. The heavy public queries (headlines, most-talked)
// stay cached via unstable_cache (300s); only the small watchlist query is live.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Market News — latest NSE headlines from top sources · EquityRoots",
  description:
    "Latest Indian market headlines aggregated from Economic Times, LiveMint, BusinessLine and more — tagged to the stocks they mention.",
};

type NewsRow = {
  id: string; source: string; title: string; summary: string | null;
  url: string; published_at: string | null;
};

async function loadNews(): Promise<NewsRow[]> {
  try {
    return await sql<NewsRow[]>`
      SELECT id, source, title, summary, url, published_at::text
        FROM app.news
       ORDER BY published_at DESC NULLS LAST
       LIMIT 80
    `;
  } catch {
    return [];
  }
}

const getNews = unstable_cache(loadNews, ["news-feed"], { revalidate: 300, tags: ["news"] });

// "Most talked about" — stocks ranked by how many headlines mentioned them in
// the last 3 days, with their latest composite percentile for a quality cue.
// A discovery + buzz surface that ties news volume to our score.
type TalkedRow = {
  symbol: string; company_name: string | null; mentions: number; composite_pct: number | null;
};

async function loadMostTalkedAbout(): Promise<TalkedRow[]> {
  try {
    return await sql<TalkedRow[]>`
      SELECT ns.symbol,
             u.company_name,
             COUNT(*)::int AS mentions,
             s.composite_pct
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
// Not cached (user-specific). IN-subquery on news.id avoids row duplication
// when a headline mentions several of the user's stocks.
async function loadWatchlistNews(userId: number): Promise<NewsRow[]> {
  try {
    return await sql<NewsRow[]>`
      SELECT n.id, n.source, n.title, n.summary, n.url, n.published_at::text
        FROM app.news n
       WHERE n.id IN (
               SELECT ns.news_id
                 FROM app.news_stock ns
                WHERE ns.symbol IN (
                        SELECT symbol FROM app.user_watchlist WHERE user_id = ${userId}
                      )
             )
       ORDER BY n.published_at DESC NULLS LAST
       LIMIT 25
    `;
  } catch {
    return [];
  }
}

function NewsCard({ n }: { n: NewsRow }) {
  return (
    <a
      href={n.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block card p-3.5 hover:bg-[var(--color-paper)] transition-colors"
    >
      <div className="flex items-center gap-2 text-[10.5px] muted-text mb-1">
        <span className="font-medium uppercase tracking-wide" style={{ color: "var(--color-accent-700)" }}>
          {n.source}
        </span>
        <span>·</span>
        <span className="tabular-nums">{ago(n.published_at)}</span>
      </div>
      <div className="text-[14px] font-medium leading-snug">{n.title}</div>
      {n.summary && (
        <div className="muted-text text-[12.5px] mt-1 leading-snug line-clamp-2">{n.summary}</div>
      )}
    </a>
  );
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function NewsPage() {
  const session = await getSession();
  const [news, talked] = await Promise.all([getNews(), getTalked()]);
  const watchNews = session ? await loadWatchlistNews(session.userId) : [];
  return (
    <div className="mx-auto max-w-[820px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-4">
        <h1 className="font-display text-[22px] md:text-[26px] leading-tight">Market News</h1>
        <p className="muted-text text-[12px] mt-1">
          Latest headlines from Economic Times, LiveMint, BusinessLine, CNBC-TV18 &amp; more · links open the source
        </p>
      </header>

      {watchNews.length > 0 && (
        <section className="mb-5">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--color-accent-700)" }}>
              Your watchlist · in the news
            </div>
            <Link href="/watchlist" className="text-[11px] muted-text hover:underline">Manage →</Link>
          </div>
          <div className="space-y-2">
            {watchNews.map((n) => <NewsCard key={`w-${n.id}`} n={n} />)}
          </div>
        </section>
      )}

      {talked.length > 0 && (
        <section className="card p-3.5 mb-4">
          <div className="text-[10.5px] uppercase tracking-wide muted-text mb-2">
            Most talked about · last 3 days
          </div>
          <div className="flex flex-wrap gap-1.5">
            {talked.map((t) => (
              <Link
                key={t.symbol}
                href={`/stock/${t.symbol}`}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] hover:bg-[var(--color-paper)] transition-colors"
                style={{ borderColor: "var(--color-border-default)" }}
                title={`${displayCompanyName(t.company_name, t.symbol)} · ${t.mentions} mention${t.mentions === 1 ? "" : "s"}`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: bandColor(band(t.composite_pct)) }}
                />
                <span className="font-medium tabular-nums">{t.symbol}</span>
                <span className="muted-text tabular-nums">{t.mentions}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {(watchNews.length > 0 || talked.length > 0) && news.length > 0 && (
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">
          All market news
        </div>
      )}
      {news.length === 0 ? (
        <div className="card p-6 muted-text text-[13px]">No headlines yet.</div>
      ) : (
        <div className="space-y-2">
          {news.map((n) => <NewsCard key={n.id} n={n} />)}
        </div>
      )}
    </div>
  );
}
