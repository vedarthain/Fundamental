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
import { ArrowUpRight, LayoutGrid, Rows3, Scale, Search, X } from "lucide-react";
import { band, bandColor } from "@/lib/score";

export type NewsCategory = "stocks" | "policy" | "macro" | "markets" | "general";

// Per-category accent colour — used on the filter tabs and as a left rail /
// label on every headline so the feed is scannable by category at a glance.
const CAT_META: Record<NewsCategory, { label: string; color: string }> = {
  stocks:  { label: "Stocks",  color: "var(--color-accent-600)" }, // blue
  policy:  { label: "Policy",  color: "var(--color-score-weak)" }, // orange
  macro:   { label: "Macro",   color: "var(--color-score-good)" }, // green
  markets: { label: "Markets", color: "#7c6dd0" },                 // purple
  general: { label: "General", color: "var(--color-muted)" },
};
function catMeta(c: NewsCategory) {
  return CAT_META[c] ?? CAT_META.general;
}

type ViewMode = "cards" | "list";

/** A stock this headline is tagged to, carrying OUR context — the differentiator
 *  over a plain aggregator: the reader sees our Industry Score band + today's
 *  move right on the headline. `top` is the stock's standout pillar (tooltip). */
export type StockTag = {
  symbol: string;
  company_name: string | null;
  composite: number | null;
  top: { label: "Q" | "V" | "M"; value: number } | null;
  ret_1d: number | null;
};

export type FeedItem = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: string | null;
  category: NewsCategory;
  /** count of near-identical headlines folded into this one */
  related: number;
  /** cross-cutting flag: SEBI/exchange enforcement or a governance red flag */
  regulatory: boolean;
  /** keyword-based tone signal — positive/negative/neutral for mentioned stocks */
  sentiment: "positive" | "negative" | "neutral";
  /** stocks this headline mentions, with our score context (sorted best-first) */
  tags: StockTag[];
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

// "regulatory" is a pseudo-tab: it filters on the cross-cutting flag rather than
// the (mutually-exclusive) category, so an enforcement story shows here AND under
// its own category.
type TabId = NewsCategory | "all" | "regulatory";
// Deliberately NEUTRAL (muted grey), not red. This is a TOPIC label on the news
// ("this story is a regulatory/legal matter"), never a verdict on the company —
// most items are allegations or interim orders, not findings.
const REG_COLOR = "var(--color-muted)";

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stocks", label: "Stocks" },
  { id: "policy", label: "Policy" },
  { id: "macro", label: "Macro" },
  { id: "markets", label: "Markets" },
  { id: "regulatory", label: "Regulatory" },
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
  signedIn,
  watchlistCount,
}: {
  news: FeedItem[];
  talked: TalkedItem[];
  watchNews: WatchItem[];
  signedIn: boolean;
  watchlistCount: number;
}) {
  const [cat, setCat] = useState<TabId>("all");
  const [view, setView] = useState<ViewMode>("cards");
  const [query, setQuery] = useState("");
  const [stocksOnly, setStocksOnly] = useState(false);
  const [score, setScore] = useState<"any" | "strong" | "weak">("any");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: news.length, regulatory: 0 };
    for (const n of news) {
      c[n.category] = (c[n.category] ?? 0) + 1;
      if (n.regulatory) c.regulatory += 1;
    }
    return c;
  }, [news]);

  const filtered = useMemo(() => {
    let r =
      cat === "all" ? news
      : cat === "regulatory" ? news.filter((n) => n.regulatory)
      : news.filter((n) => n.category === cat);

    const q = query.trim().toLowerCase();
    if (q) {
      r = r.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          (n.summary?.toLowerCase().includes(q) ?? false) ||
          n.tags.some(
            (t) => t.symbol.toLowerCase().includes(q) || (t.company_name?.toLowerCase().includes(q) ?? false),
          ),
      );
    }
    if (stocksOnly) r = r.filter((n) => n.tags.length > 0);
    if (score === "strong") r = r.filter((n) => n.tags.some((t) => t.composite != null && t.composite >= 75));
    if (score === "weak") r = r.filter((n) => n.tags.some((t) => t.composite != null && t.composite < 40));
    return r;
  }, [news, cat, query, stocksOnly, score]);

  const anyFilter = query.trim() !== "" || stocksOnly || score !== "any";

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
          <div className="flex items-start justify-between gap-2 mb-3">
            <div role="tablist" aria-label="News categories" className="flex flex-wrap gap-1.5">
              {TABS.map((t) => {
                const active = cat === t.id;
                const n = counts[t.id] ?? 0;
                if (t.id !== "all" && n === 0) return null; // hide empty categories/lanes
                // "All" = accent; "regulatory" = red alert lane; else the category hue.
                const color =
                  t.id === "all" ? "var(--color-accent-600)"
                  : t.id === "regulatory" ? REG_COLOR
                  : catMeta(t.id).color;
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
                        ? { background: color, color: "#fff", borderColor: color }
                        : { background: "transparent", color: "var(--color-muted)", borderColor: "var(--color-border-default)" }
                    }
                  >
                    {t.id === "regulatory" ? (
                      <Scale size={12} strokeWidth={2} />
                    ) : t.id !== "all" && !active ? (
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                    ) : null}
                    {t.label}
                    <span className="tabular-nums" style={{ opacity: 0.7 }}>{n}</span>
                  </button>
                );
              })}
            </div>
            {/* View switcher — dense Cards grid vs a scannable List/timeline. */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-md border shrink-0" style={{ borderColor: "var(--color-border-default)" }}>
              <ViewBtn active={view === "cards"} onClick={() => setView("cards")} label="Card view"><LayoutGrid size={14} /></ViewBtn>
              <ViewBtn active={view === "list"} onClick={() => setView("list")} label="List view"><Rows3 size={14} /></ViewBtn>
            </div>
          </div>

          {/* Search + filters — operate on the loaded feed (no reload). */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 muted-text pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search headlines or a stock…"
                aria-label="Search news"
                className="w-full pl-7 pr-7 py-1.5 rounded-md border text-[12.5px] bg-[var(--color-card)] outline-none focus:border-[var(--color-accent-400)]"
                style={{ borderColor: "var(--color-border-default)" }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 muted-text hover:text-[var(--color-ink)]"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStocksOnly((v) => !v)}
              aria-pressed={stocksOnly}
              className="px-2.5 py-1.5 rounded-md text-[12px] border transition-colors whitespace-nowrap"
              style={
                stocksOnly
                  ? { background: "var(--color-accent-50)", borderColor: "var(--color-accent-300)", color: "var(--color-accent-700)", fontWeight: 600 }
                  : { background: "transparent", borderColor: "var(--color-border-default)", color: "var(--color-muted)" }
              }
            >
              Stocks only
            </button>
            <select
              value={score}
              onChange={(e) => setScore(e.target.value as "any" | "strong" | "weak")}
              aria-label="Filter by Industry Score band"
              className="px-2 py-1.5 rounded-md text-[12px] border bg-[var(--color-card)] outline-none cursor-pointer"
              style={{ borderColor: "var(--color-border-default)", color: "var(--color-muted)" }}
            >
              <option value="any">Any score</option>
              <option value="strong">Strong (≥75)</option>
              <option value="weak">Weak (&lt;40)</option>
            </select>
            <span className="text-[11px] muted-text tabular-nums shrink-0">
              {filtered.length}{anyFilter ? ` of ${news.length}` : ""}
            </span>
          </div>

          {cat === "regulatory" && (
            <div
              className="mb-3 px-3 py-2 rounded-md text-[11.5px] leading-snug flex items-start gap-2 muted-text"
              style={{
                background: "color-mix(in srgb, var(--color-muted) 7%, transparent)",
                border: "1px solid var(--color-border-default)",
              }}
            >
              <Scale size={14} className="mt-[1px] shrink-0" />
              <span>
                Stories that involve a regulatory or legal matter — <strong>often an allegation
                or interim order, not a final finding</strong>. This is a keyword heuristic to help
                you notice them, not a verdict on any company. Always read the actual order or
                filing yourself.
              </span>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="card p-6 muted-text text-[13px]">
              {anyFilter ? "No headlines match your search / filters." : "No headlines in this category yet."}
            </div>
          ) : view === "cards" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map((n) => <NewsCard key={n.id} n={n} />)}
            </div>
          ) : (
            <div className="card overflow-hidden divide-y hairline">
              {filtered.map((n) => <NewsRow key={n.id} n={n} />)}
            </div>
          )}
        </main>

        {/* Sidebar — watchlist news (sticky on desktop, first on mobile).
            Shown whenever signed in, with an empty-state so it's never a
            silent blank: distinguishes "empty watchlist" from "no news yet". */}
        {signedIn && (
          <aside className="order-1 lg:order-2 self-start lg:sticky lg:top-[88px]">
            <section className="card p-3">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--color-accent-700)" }}>
                  Your watchlist
                </div>
                <Link href="/watchlist" className="text-[10.5px] muted-text hover:underline">Manage →</Link>
              </div>
              {watchNews.length > 0 ? (
                <div className="divide-y hairline overflow-y-auto lg:max-h-[calc(100vh-150px)] -mr-1 pr-1">
                  {watchNews.map((n) => (
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
              ) : watchlistCount === 0 ? (
                <p className="text-[12px] muted-text leading-snug">
                  Your watchlist is empty.{" "}
                  <Link href="/sectors" className="underline" style={{ color: "var(--color-accent-600)" }}>Add stocks</Link>{" "}
                  and headlines that mention them will show up here.
                </p>
              ) : (
                <p className="text-[12px] muted-text leading-snug">
                  No recent headlines mention your {watchlistCount} watched stock{watchlistCount === 1 ? "" : "s"} yet —
                  we tag news to stocks as it comes in (best for large/mid caps).
                </p>
              )}
            </section>
          </aside>
        )}
      </div>
    </>
  );
}

/** Small icon toggle for the Cards/List view switcher. */
function ViewBtn({
  active, onClick, label, children,
}: {
  active: boolean; onClick: () => void; label: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className="inline-flex items-center justify-center w-7 h-6 rounded transition-colors"
      style={active ? { background: "var(--color-accent-600)", color: "#fff" } : { color: "var(--color-muted)" }}
    >
      {children}
    </button>
  );
}

function RelatedBadge({ n }: { n: number }) {
  return (
    <span
      className="rounded px-1 py-[1px] text-[9.5px] tabular-nums"
      style={{ background: "color-mix(in srgb, var(--color-muted) 14%, transparent)" }}
      title={`${n} more outlet${n === 1 ? "" : "s"} covered this`}
    >
      +{n} related
    </span>
  );
}

/** Neutral topic tag on any headline our regulatory/governance detector trips.
 *  Grey, not red — it labels the NEWS TOPIC, never the company. Most such items
 *  are allegations or interim orders, not findings. */
function RegBadge() {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wide muted-text"
      style={{ background: "color-mix(in srgb, var(--color-muted) 14%, transparent)" }}
      title="This story involves a regulatory or legal matter — often an allegation or interim order, not a final finding. Read the filing; not a verdict on the company."
    >
      <Scale size={9} strokeWidth={2.2} /> Reg
    </span>
  );
}

/** Inline stock chips for the meta row — separator dot + chips + overflow
 *  count. Max is caller-specified (2 for cards, 3 for list). Chips link to
 *  the stock scorecard and render OUTSIDE the headline <a> so they navigate
 *  independently. */
function MetaChips({ tags, max = 2 }: { tags: StockTag[]; max?: number }) {
  return (
    <>
      <span className="opacity-30 select-none" aria-hidden>·</span>
      {tags.slice(0, max).map((t) => <StockChip key={t.symbol} tag={t} />)}
      {tags.length > max && (
        <span className="text-[10px] muted-text">+{tags.length - max}</span>
      )}
    </>
  );
}

/** Small ▲ / ▼ tone cue in the meta row. Green = broadly positive for the
 *  mentioned stocks; red = broadly negative. Nothing shown for neutral.
 *  Keyword-based heuristic — directional cue only, not a rating. */
function SentimentDot({ s }: { s: "positive" | "negative" | "neutral" }) {
  if (s === "neutral") return null;
  return (
    <span
      className="text-[10px] font-bold leading-none shrink-0"
      style={{ color: s === "positive" ? "var(--color-delta-up)" : "var(--color-delta-down)" }}
      title={
        s === "positive"
          ? "Headline signals positive news for the mentioned stock(s)"
          : "Headline signals negative news for the mentioned stock(s)"
      }
      aria-label={s}
    >
      {s === "positive" ? "▲" : "▼"}
    </span>
  );
}

/** Cards view — dense 2-up card with a category colour rail + label.
 *  Meta row (category · sentiment · time · badges · stock chips) is a
 *  standalone div so the stock <Link>s work without nesting inside the
 *  headline <a>; the title + summary are their own <a>. */
function NewsCard({ n }: { n: FeedItem }) {
  const meta = catMeta(n.category);
  return (
    <div className="card p-3 h-full flex flex-col gap-1.5" style={{ borderLeft: `3px solid ${meta.color}` }}>
      {/* Meta row — outside the headline <a> so chip links are independent */}
      <div className="flex items-start justify-between gap-1 text-[10.5px] muted-text">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          <span className="uppercase tracking-wide font-semibold text-[9px] shrink-0" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <SentimentDot s={n.sentiment} />
          {n.regulatory && <RegBadge />}
          <span className="tabular-nums shrink-0">{ago(n.published_at)} ago</span>
          {n.related > 0 && <RelatedBadge n={n.related} />}
          {n.tags.length > 0 && <MetaChips tags={n.tags} max={2} />}
        </div>
        <a href={n.url} target="_blank" rel="noopener noreferrer" className="group shrink-0 mt-[1px]" aria-label="Open article">
          <ArrowUpRight size={12} className="opacity-50 group-hover:opacity-90 transition-opacity" />
        </a>
      </div>
      {/* Headline + summary */}
      <a href={n.url} target="_blank" rel="noopener noreferrer" className="group block">
        <div className="text-[13.5px] font-medium leading-snug group-hover:underline">{n.title}</div>
        {n.summary && (
          <div className="muted-text text-[12px] mt-1 leading-snug line-clamp-2">{n.summary}</div>
        )}
      </a>
    </div>
  );
}

/** List view — a scannable single-column row. Meta line holds category,
 *  sentiment, time, badges, and up to 3 stock chips; headline is a
 *  separate <a> below. */
function NewsRow({ n }: { n: FeedItem }) {
  const meta = catMeta(n.category);
  return (
    <div
      className="px-3 py-2.5 hover:bg-[var(--color-paper)] transition-colors"
      style={{ borderLeft: `3px solid ${meta.color}` }}
    >
      <div className="flex items-center justify-between gap-1 text-[10px] muted-text mb-0.5">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          <span className="uppercase tracking-wide font-semibold text-[9px] shrink-0" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <SentimentDot s={n.sentiment} />
          {n.regulatory && <RegBadge />}
          <span className="tabular-nums shrink-0">{ago(n.published_at)} ago</span>
          {n.related > 0 && <RelatedBadge n={n.related} />}
          {n.tags.length > 0 && <MetaChips tags={n.tags} max={3} />}
        </div>
        <a href={n.url} target="_blank" rel="noopener noreferrer" className="group shrink-0" aria-label="Open article">
          <ArrowUpRight size={11} className="opacity-40 group-hover:opacity-80 transition-opacity" />
        </a>
      </div>
      <a href={n.url} target="_blank" rel="noopener noreferrer" className="group block">
        <div className="text-[13px] font-medium leading-snug group-hover:underline line-clamp-2">{n.title}</div>
      </a>
    </div>
  );
}

/** Compact "our context" chip on a headline: score-band dot · symbol · Industry
 *  Score · today's move. Links to the stock's scorecard. Tooltip carries the
 *  company name + the standout pillar. */
function StockChip({ tag }: { tag: StockTag }) {
  const dot = bandColor(band(tag.composite));
  const moveColor =
    tag.ret_1d == null
      ? "var(--color-muted)"
      : tag.ret_1d >= 0
        ? "var(--color-delta-up)"
        : "var(--color-delta-down)";
  const title =
    (tag.company_name ?? tag.symbol) +
    (tag.composite != null ? ` · Industry Score ${Math.round(tag.composite)}` : "") +
    (tag.top ? ` · strongest ${tag.top.label} ${Math.round(tag.top.value)}` : "");
  return (
    <Link
      href={`/stock/${tag.symbol}`}
      title={title}
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] hover:bg-[var(--color-paper)] transition-colors"
      style={{ borderColor: "var(--color-border-default)" }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
      <span className="font-medium tabular-nums">{tag.symbol}</span>
      {tag.composite != null && (
        <span className="muted-text tabular-nums">{Math.round(tag.composite)}</span>
      )}
      {tag.ret_1d != null && (
        <span className="tabular-nums" style={{ color: moveColor }}>
          {tag.ret_1d >= 0 ? "+" : ""}{tag.ret_1d.toFixed(1)}%
        </span>
      )}
    </Link>
  );
}
