/**
 * /watchlist — the user's saved stocks, with current scores and prices.
 *
 * Auth-gated: anonymous visitors see a "Sign in to see your watchlist"
 * panel rather than the list itself. The watchlist is private to the
 * signed-in user; we don't want strangers seeing each other's lists, and
 * we don't want to suggest there's any public/social data behind the URL.
 *
 * Server-side gating (vs. client-only) means signed-out visitors get a
 * fast HTML response with the sign-in prompt — no flicker of empty cards,
 * no extra round-trip. We also redirect ?next=/watchlist on the login
 * link so users land back here after authenticating.
 *
 * Once signed in, the page delegates to WatchlistClient which calls
 * /api/watchlist (no args → server returns the user's stored list).
 */
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { WatchlistClient } from "./WatchlistClient";
import { SignedInExtras } from "../market/SignedInExtras";

type WatchlistNews = {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  symbols: string[];
};

async function loadWatchlistNews(userId: number): Promise<WatchlistNews[]> {
  try {
    return await sql<WatchlistNews[]>`
      SELECT n.id, n.title, n.url, n.published_at::text,
             COALESCE(array_agg(ns2.symbol) FILTER (
               WHERE ns2.symbol IN (SELECT symbol FROM app.user_watchlist WHERE user_id = ${userId})
             ), ARRAY[]::text[]) AS symbols
        FROM app.news n
        JOIN app.news_stock ns ON ns.news_id = n.id
        JOIN app.user_watchlist w ON w.symbol = ns.symbol AND w.user_id = ${userId}
        LEFT JOIN app.news_stock ns2 ON ns2.news_id = n.id
       WHERE n.published_at > now() - interval '7 days'
       GROUP BY n.id
       ORDER BY n.published_at DESC NULLS LAST
       LIMIT 40
    `;
  } catch {
    return [];
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const session = await getSession();

  if (!session) {

    return (
      <div className="mx-auto max-w-[520px] px-4 md:px-6 py-10 md:py-16">
        <div className="card p-8 md:p-10 text-center">
          <h1 className="font-display text-[24px] md:text-[26px] leading-[1.1] tracking-tight mb-3">
            Sign in to see your watchlist
          </h1>
          <p className="muted-text text-[13.5px] max-w-md mx-auto mb-6">
            Your watchlist follows you across devices. Free, no spam — we only
            store your email and the symbols you save.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[13px]">
            <Link
              href="/login?next=/watchlist"
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
            >
              Sign in
            </Link>
            <Link
              href="/signup?next=/watchlist"
              className="px-4 py-2 rounded-md border font-medium transition-colors hover:bg-[var(--color-paper)]"
              style={{ borderColor: "var(--color-border-default)" }}
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const watchlistNews = await loadWatchlistNews(session.userId);

  return (
    <div className="mx-auto max-w-[1200px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-6">
        <h1 className="font-display text-[26px] md:text-[30px] leading-[1.1] tracking-tight">
          Your watchlist
        </h1>
        <p className="muted-text text-[13px] mt-1">
          Stocks you&apos;re tracking — refreshed with each weekly snapshot. Saved to your account when you&apos;re signed in, otherwise on this device.
        </p>
      </header>
      <WatchlistClient />

      {/* News about the user's watched stocks — last 7 days. */}
      {watchlistNews.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[14px] font-semibold">News about your stocks</h2>
            <Link href="/news" className="text-[12px] muted-text hover:underline">All news →</Link>
          </div>
          <div className="card overflow-hidden divide-y hairline">
            {watchlistNews.map((n) => (
              <a
                key={n.id}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--color-paper)] transition-colors group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap text-[10.5px] muted-text mb-0.5">
                    <span className="tabular-nums shrink-0">{timeAgo(n.published_at)}</span>
                    {n.symbols.length > 0 && (
                      <span className="flex items-center gap-1 flex-wrap">
                        {n.symbols.slice(0, 3).map((s) => (
                          <span
                            key={s}
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                            style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
                          >
                            {s}
                          </span>
                        ))}
                        {n.symbols.length > 3 && (
                          <span className="text-[10px] muted-text">+{n.symbols.length - 3}</span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] font-medium leading-snug group-hover:underline line-clamp-2">
                    {n.title}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Watchlist movers (1D/1W) + FII/DII trend. */}
      <div className="mt-8">
        <SignedInExtras />
      </div>
    </div>
  );
}
