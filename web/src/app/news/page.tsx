/**
 * /news — aggregated market headlines from broadcaster RSS (Economic Times,
 * LiveMint, Hindu BusinessLine, Moneycontrol). Headline + summary + a link
 * back to the source only — we never reproduce article text.
 *
 * Server-rendered from app.news (written by scripts/fetch-news.py on a short
 * cron). Fail-soft: if the table isn't present yet (migration 0033 not
 * applied), render an empty state rather than 500.
 */
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";

export const revalidate = 300; // 5 min — RSS refreshes on a short cron anyway.

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
  const news = await getNews();
  return (
    <div className="mx-auto max-w-[820px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-4">
        <h1 className="font-display text-[22px] md:text-[26px] leading-tight">Market News</h1>
        <p className="muted-text text-[12px] mt-1">
          Latest headlines from Economic Times, LiveMint, BusinessLine &amp; more · links open the source
        </p>
      </header>

      {news.length === 0 ? (
        <div className="card p-6 muted-text text-[13px]">No headlines yet.</div>
      ) : (
        <div className="space-y-2">
          {news.map((n) => (
            <a
              key={n.id}
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
          ))}
        </div>
      )}
    </div>
  );
}
