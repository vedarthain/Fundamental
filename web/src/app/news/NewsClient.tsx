"use client";

/**
 * NewsClient — Watchlist / Market / Economy / Policy / Others.
 *
 * Watchlist: pick a stock (col 1) → only that name's headlines (col 2) →
 * summary of the selected headline (col 3). Other lanes: headline list +
 * one summary. Watchlist symbols come from GET /api/watchlist?list=1 so
 * this page stays ISR for everyone else.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { compactWire } from "@/lib/newsCluster";
import { useSession } from "@/lib/session-client";

export type NewsCategory = "stocks" | "policy" | "macro" | "markets" | "general";

export type StockTag = {
  symbol: string;
  company_name: string | null;
  composite: number | null;
  top: { label: "Q" | "V" | "M"; value: number } | null;
  ret_1d: number | null;
  price: number | null;
};

export type FeedItem = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: string | null;
  category: NewsCategory;
  related: number;
  regulatory: boolean;
  sentiment: "positive" | "negative" | "neutral";
  tags: StockTag[];
};

type Lane = "watchlist" | "markets" | "macro" | "policy" | "general";

const LANES: { id: Lane; label: string }[] = [
  { id: "watchlist", label: "Watchlist" },
  { id: "markets", label: "Market" },
  { id: "macro", label: "Economy" },
  { id: "policy", label: "Policy" },
  { id: "general", label: "Others" },
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

const SOURCE_NAMES: Record<string, string> = {
  "cnbctv18.com": "CNBC-TV18",
  "economictimes.indiatimes.com": "Economic Times",
  "livemint.com": "Mint",
  "moneycontrol.com": "Moneycontrol",
  "business-standard.com": "Business Standard",
  "thehindubusinessline.com": "Hindu BusinessLine",
  "financialexpress.com": "Financial Express",
  "reuters.com": "Reuters",
  "bloomberg.com": "Bloomberg",
  "ndtvprofit.com": "NDTV Profit",
  "zeebiz.com": "Zee Business",
  "businesstoday.in": "Business Today",
};

function sourceLabel(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return SOURCE_NAMES[host] ?? host;
  } catch {
    return null;
  }
}

function watchedHit(item: FeedItem, watched: Set<string>): string[] {
  return item.tags.filter((t) => watched.has(t.symbol)).map((t) => t.symbol);
}

export function NewsClient({ news }: { news: FeedItem[] }) {
  const { user, loading } = useSession();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [lane, setLane] = useState<Lane>("markets");
  const [stock, setStock] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) {
      setSymbols([]);
      return;
    }
    let cancelled = false;
    fetch("/api/watchlist?list=1", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { symbols?: string[] }) => {
        if (cancelled) return;
        const next = Array.isArray(d.symbols) ? d.symbols : [];
        setSymbols(next);
        if (next.length > 0) setLane("watchlist");
      })
      .catch(() => {
        if (!cancelled) setSymbols([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  const watched = useMemo(
    () => new Set(symbols.map((s) => s.toUpperCase())),
    [symbols],
  );

  const buckets = useMemo(() => {
    const watchlist: FeedItem[] = [];
    const markets: FeedItem[] = [];
    const macro: FeedItem[] = [];
    const policy: FeedItem[] = [];
    const general: FeedItem[] = [];
    for (const n of news) {
      if (watched.size > 0 && watchedHit(n, watched).length > 0) {
        watchlist.push(n);
        continue;
      }
      if (n.category === "markets") markets.push(n);
      else if (n.category === "macro") macro.push(n);
      else if (n.category === "policy") policy.push(n);
      else general.push(n);
    }
    return {
      watchlist,
      markets: compactWire(markets),
      macro: compactWire(macro),
      policy: compactWire(policy),
      general: compactWire(general),
    };
  }, [news, watched]);

  const stockRows = useMemo(() => {
    const by = new Map<
      string,
      { tag: StockTag; items: FeedItem[] }
    >();
    for (const n of buckets.watchlist) {
      for (const t of n.tags) {
        if (!watched.has(t.symbol)) continue;
        const cur = by.get(t.symbol);
        if (cur) cur.items.push(n);
        else by.set(t.symbol, { tag: t, items: [n] });
      }
    }
    return [...by.entries()]
      .map(([symbol, v]) => ({ symbol, ...v, n: v.items.length }))
      .sort((a, b) => b.n - a.n || a.symbol.localeCompare(b.symbol));
  }, [buckets.watchlist, watched]);

  const activeStock = stock && stockRows.some((s) => s.symbol === stock)
    ? stock
    : stockRows[0]?.symbol ?? null;

  const watchHeadlines = useMemo(() => {
    if (!activeStock) return [] as FeedItem[];
    return stockRows.find((s) => s.symbol === activeStock)?.items ?? [];
  }, [stockRows, activeStock]);

  const wire = lane === "watchlist" ? watchHeadlines : buckets[lane];
  const activeId =
    selectedId && wire.some((n) => n.id === selectedId)
      ? selectedId
      : wire[0]?.id ?? null;
  const selected = wire.find((n) => n.id === activeId) ?? null;

  return (
    <>
      <div
        role="tablist"
        aria-label="News lane"
        className="flex flex-wrap mb-4 border hairline overflow-hidden"
        style={{ backgroundColor: "var(--color-card)", width: "fit-content", maxWidth: "100%" }}
      >
        {LANES.map((t) => {
          if (t.id === "watchlist" && !loading && !user) return null;
          const n =
            t.id === "watchlist" ? buckets.watchlist.length : buckets[t.id].length;
          const on = lane === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                setLane(t.id);
                setSelectedId(null);
              }}
              className="px-3 py-1.5 text-[13px] border-r hairline last:border-r-0"
              style={
                on
                  ? { fontWeight: 600, backgroundColor: "var(--color-paper)" }
                  : { color: "var(--color-muted)" }
              }
            >
              {t.label}
              <span className="tabular-nums muted-text ml-1.5">{n}</span>
            </button>
          );
        })}
      </div>

      {lane === "watchlist" ? (
        <WatchBoard
          stocks={stockRows}
          activeStock={activeStock}
          headlines={watchHeadlines}
          selected={selected}
          signedIn={!!user}
          loading={loading}
          onStock={(s) => {
            setStock(s);
            setSelectedId(null);
          }}
          onPick={setSelectedId}
        />
      ) : (
        <WireBoard items={wire} selected={selected} onPick={setSelectedId} />
      )}
    </>
  );
}

function WatchBoard({
  stocks,
  activeStock,
  headlines,
  selected,
  signedIn,
  loading,
  onStock,
  onPick,
}: {
  stocks: { symbol: string; tag: StockTag; n: number }[];
  activeStock: string | null;
  headlines: FeedItem[];
  selected: FeedItem | null;
  signedIn: boolean;
  loading: boolean;
  onStock: (s: string) => void;
  onPick: (id: string) => void;
}) {
  if (loading) {
    return <div className="card p-6 muted-text text-[13px]">Loading watchlist…</div>;
  }
  if (!signedIn) {
    return (
      <div className="card p-6 muted-text text-[13px]">
        Sign in to see headlines for names you follow.
      </div>
    );
  }
  if (stocks.length === 0) {
    return (
      <div className="card p-6 muted-text text-[13px]">
        No headlines in the last 30 days for your watchlist.
      </div>
    );
  }

  return (
    <div
      className="grid border hairline overflow-hidden max-lg:grid-cols-1"
      style={{
        backgroundColor: "var(--color-card)",
        gridTemplateColumns: "minmax(140px,18%) minmax(0,1.15fr) minmax(0,1fr)",
      }}
    >
      <ColHead>Stock</ColHead>
      <ColHead>Headline</ColHead>
      <ColHead>Summary</ColHead>
      <div className="border-r hairline">
        {stocks.map((s) => {
          const on = s.symbol === activeStock;
          const move = s.tag.ret_1d;
          return (
            <button
              key={s.symbol}
              type="button"
              onClick={() => onStock(s.symbol)}
              className="block w-full text-left px-3 py-2.5 border-b hairline"
              style={on ? { backgroundColor: "var(--color-paper)" } : undefined}
            >
              <span className="font-mono font-medium text-[13px]">{s.symbol}</span>
              <span className="block text-[11px] muted-text tabular-nums mt-0.5">
                {s.tag.composite != null ? Math.round(s.tag.composite) : "—"}
                {move != null && (
                  <span
                    style={{
                      color: move >= 0 ? "var(--color-delta-up)" : "var(--color-delta-down)",
                    }}
                  >
                    {" "}
                    · {move >= 0 ? "+" : ""}
                    {move.toFixed(1)}%
                  </span>
                )}
                {" · "}
                {s.n}
              </span>
            </button>
          );
        })}
      </div>
      <HeadlineList items={headlines} selectedId={selected?.id ?? null} onPick={onPick} />
      <SummaryPane item={selected} />
    </div>
  );
}

function WireBoard({
  items,
  selected,
  onPick,
}: {
  items: FeedItem[];
  selected: FeedItem | null;
  onPick: (id: string) => void;
}) {
  if (items.length === 0) {
    return <div className="card p-6 muted-text text-[13px]">No headlines in this lane.</div>;
  }
  return (
    <div
      className="grid border hairline overflow-hidden max-lg:grid-cols-1"
      style={{
        backgroundColor: "var(--color-card)",
        gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)",
      }}
    >
      <ColHead>Headline</ColHead>
      <ColHead>Summary</ColHead>
      <HeadlineList items={items} selectedId={selected?.id ?? null} onPick={onPick} />
      <SummaryPane item={selected} />
    </div>
  );
}

function ColHead({ children }: { children: string }) {
  return (
    <div className="px-3 py-2 text-[11px] muted-text font-medium border-b hairline border-r hairline last:border-r-0"
      style={{ backgroundColor: "var(--color-paper)" }}
    >
      {children}
    </div>
  );
}

function HeadlineList({
  items,
  selectedId,
  onPick,
}: {
  items: FeedItem[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="border-r hairline max-h-[70vh] overflow-y-auto">
      {items.map((n) => {
        const on = n.id === selectedId;
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => onPick(n.id)}
            className="block w-full text-left px-3 py-2.5 border-b hairline"
            style={on ? { backgroundColor: "var(--color-paper)" } : undefined}
          >
            <div className="text-[13.5px] font-medium leading-snug">{n.title}</div>
            <div className="text-[11px] muted-text mt-1">
              {ago(n.published_at)}
              {sourceLabel(n.url) ? ` · ${sourceLabel(n.url)}` : ""}
              {n.related > 0 ? ` · +${n.related} related` : ""}
              {n.regulatory ? " · Reg" : ""}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SummaryPane({ item }: { item: FeedItem | null }) {
  if (!item) {
    return <div className="px-4 py-3 muted-text text-[13px]">Pick a headline.</div>;
  }
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] muted-text mb-2">
        {sourceLabel(item.url) ?? "Source"}
        {item.published_at ? ` · ${ago(item.published_at)}` : ""}
      </div>
      <div className="text-[14px] font-medium leading-snug mb-2">{item.title}</div>
      <p className="text-[13px] muted-text leading-relaxed">
        {item.summary?.trim() || "No summary in the RSS item — open the source."}
      </p>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[12px] mt-3"
        style={{ color: "var(--color-accent-700)" }}
      >
        Open article <ArrowUpRight size={12} />
      </a>
    </div>
  );
}
