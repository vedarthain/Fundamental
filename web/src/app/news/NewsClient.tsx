"use client";

/**
 * NewsClient — interactive /news shell.
 *
 * Layout (addresses the single-column "wasted space" problem):
 *   - Most talked about: a compact full-width chip strip up top — always
 *     visible, never buried under the watchlist.
 *   - Below: a 2-column grid — the feed (dense 2-up cards on desktop) on the
 *     left, a sticky sidebar (your watchlist news) on the right. On mobile the
 *     watchlist comes first (order-1), then the feed.
 *   - Category tabs (All / Stocks / Policy / Macro / Markets) filter the feed
 *     client-side; categories are computed server-side.
 *
 * Headlines link straight to the source (external) — no source-name label,
 * just the age + an out-arrow.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { band, bandColor } from "@/lib/score";

export type NewsCategory = "stocks" | "policy" | "macro" | "markets" | "general";

export type FeedItem = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: string | null;
  category: NewsCategory;
  /** count of near-identical headlines folded into this one */
  related: number;
};
export type TalkedItem = {
  symbol: string;
  company_name: string | null;
  mentions: number;
  composite_pct: number | null;
};
export type WatchItem = {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  related: number;
};

const TABS: { id: NewsCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stocks", label: "Stocks" },
  { id: "policy", label: "Policy" },
  { id: "macro", label: "Macro" },
  { id: "markets", label: "Markets" },
];

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function NewsClient({
  news,
  talked,
  watchNews,
}: {
  news: FeedItem[];
  talked: TalkedItem[];
  watchNews: WatchItem[];
}) {
  const [cat, setCat] = useState<NewsCategory | "all">("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: news.length };
    for (const n of news) c[n.category] = (c[n.category] ?? 0) + 1;
    return c;
  }, [news]);

  const filtered = cat === "all" ? news : news.filter((n) => n.category === cat);

  return (
    <>
      {/* Most talked — compact, full-width, always on top */}
      {talked.length > 0 && (
        <section className="card p-3 mb-4">
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
                title={`${t.company_name ?? t.symbol} · ${t.mentions} mention${t.mentions === 1 ? "" : "s"}`}
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        {/* Feed */}
        <main className="order-2 lg:order-1 min-w-0">
          <div role="tablist" aria-label="News categories" className="flex flex-wrap gap-1.5 mb-3">
            {TABS.map((t) => {
              const active = cat === t.id;
              const n = counts[t.id] ?? 0;
              if (t.id !== "all" && n === 0) return null; // hide empty categories
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCat(t.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12.5px] font-medium transition-colors border"
                  style={
                    active
                      ? { background: "var(--color-accent-600)", color: "#fff", borderColor: "var(--color-accent-600)" }
                      : { background: "transparent", color: "var(--color-muted)", borderColor: "var(--color-border-default)" }
                  }
                >
                  {t.label}
                  <span className="tabular-nums" style={{ opacity: 0.7 }}>{n}</span>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <div className="card p-6 muted-text text-[13px]">No headlines in this category yet.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map((n) => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block card p-3 hover:bg-[var(--color-paper)] transition-colors h-full"
                >
                  <div className="flex items-center justify-between text-[10.5px] muted-text mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className="tabular-nums">{ago(n.published_at)} ago</span>
                      {n.related > 0 && (
                        <span
                          className="rounded px-1 py-[1px] text-[9.5px] tabular-nums"
                          style={{ background: "color-mix(in srgb, var(--color-muted) 14%, transparent)" }}
                          title={`${n.related} more outlet${n.related === 1 ? "" : "s"} covered this`}
                        >
                          +{n.related} related
                        </span>
                      )}
                    </span>
                    <ArrowUpRight size={12} className="opacity-50 shrink-0" />
                  </div>
                  <div className="text-[13.5px] font-medium leading-snug">{n.title}</div>
                  {n.summary && (
                    <div className="muted-text text-[12px] mt-1 leading-snug line-clamp-2">{n.summary}</div>
                  )}
                </a>
              ))}
            </div>
          )}
        </main>

        {/* Sidebar — watchlist news (sticky on desktop, first on mobile) */}
        {watchNews.length > 0 && (
          <aside className="order-1 lg:order-2 self-start lg:sticky lg:top-[88px]">
            <section className="card p-3">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--color-accent-700)" }}>
                  Your watchlist
                </div>
                <Link href="/watchlist" className="text-[10.5px] muted-text hover:underline">Manage →</Link>
              </div>
              <div className="divide-y hairline">
                {watchNews.slice(0, 8).map((n) => (
                  <a
                    key={n.id}
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block py-2 first:pt-0 last:pb-0 hover:opacity-80 transition-opacity"
                  >
                    <div className="text-[10px] muted-text tabular-nums mb-0.5">
                      {ago(n.published_at)} ago{n.related > 0 ? ` · +${n.related} related` : ""}
                    </div>
                    <div className="text-[12.5px] leading-snug">{n.title}</div>
                  </a>
                ))}
              </div>
            </section>
          </aside>
        )}
      </div>
    </>
  );
}
