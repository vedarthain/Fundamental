"use client";

/**
 * NewsClient — Market / Economy / Policy / Others / Watchlist.
 *
 * Lands on Market. Wires have a left date rail (Today / Yesterday /
 * 3–7 days / 8–30 days). Pick a date, see every clustered story for
 * that day — no 32-item cap. Summary sits to the right of the list.
 * Watchlist keeps the stock tree (today / week / month).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import { clusterByTitle } from "@/lib/newsCluster";
import { band } from "@/lib/score";
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
type StockRow = { symbol: string; tag: StockTag; n: number; items: FeedItem[] };
type DateSel = "today" | "yesterday" | "week" | "month" | `day:${string}`;

/** Selection: ink edge. Headline rows also get a faint wash. */
const EDGE = "inset 2px 0 0 var(--color-ink)";
const EDGE_TAB = "inset 0 -2px 0 var(--color-ink)";
const PICK_WASH = "#e4f3e8";

const LANES: { id: Lane; label: string }[] = [
  { id: "watchlist", label: "Watchlist" },
  { id: "markets", label: "Market" },
  { id: "macro", label: "Economy" },
  { id: "policy", label: "Policy" },
  { id: "general", label: "Others" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BOARD_H = "calc(100dvh - 8.5rem)";

function dayKey(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

function daysBehind(key: string, newest: string): number {
  if (!key || !newest) return 999;
  const a = Date.parse(`${newest}T00:00:00Z`);
  const b = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 999;
  return Math.round((a - b) / 864e5);
}

function prettyDay(key: string, newest: string): string {
  if (!key || key === "undated") return "Undated";
  const age = daysBehind(key, newest);
  if (age <= 0) return "Today";
  if (age === 1) return "Yesterday";
  const [, m, d] = key.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
}

function ago(iso: string | null, now: number | null): string {
  if (!iso || now == null) return iso ? iso.slice(0, 10) : "";
  const mins = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function storyWord(n: number): string {
  return n === 1 ? "1 story" : `${n} stories`;
}

type DayGroup = { key: string; label: string; items: FeedItem[]; age: number };

function groupByDay(items: FeedItem[], newest: string): DayGroup[] {
  const by = new Map<string, FeedItem[]>();
  const order: string[] = [];
  for (const n of items) {
    const k = dayKey(n.published_at) || "undated";
    const cur = by.get(k);
    if (cur) cur.push(n);
    else {
      by.set(k, [n]);
      order.push(k);
    }
  }
  return order.map((key) => ({
    key,
    label: prettyDay(key, newest),
    items: by.get(key) ?? [],
    age: daysBehind(key, newest),
  }));
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

function latestAge(items: FeedItem[], newest: string): number {
  return daysBehind(dayKey(items[0]?.published_at), newest);
}

function firstSel(days: DayGroup[]): DateSel {
  const today = days.find((d) => d.age <= 0);
  if (today && today.items.length) return "today";
  const yest = days.find((d) => d.age === 1);
  if (yest && yest.items.length) return "yesterday";
  const week = days.find((d) => d.age >= 2 && d.age <= 7);
  if (week) return `day:${week.key}`;
  const month = days.find((d) => d.age >= 8);
  if (month) return `day:${month.key}`;
  return "today";
}

export function NewsClient({ news }: { news: FeedItem[] }) {
  const { user, loading } = useSession();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [lane, setLane] = useState<Lane>("markets");
  const [stock, setStock] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dateSel, setDateSel] = useState<DateSel>("today");
  const [dateSeed, setDateSeed] = useState("");
  const [openRange, setOpenRange] = useState<{ week: boolean; month: boolean }>({
    week: true,
    month: false,
  });
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (loading || !user) {
      setSymbols([]);
      return;
    }
    let cancelled = false;
    fetch("/api/watchlist?list=1", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { symbols?: string[] }) => {
        if (!cancelled) setSymbols(Array.isArray(d.symbols) ? d.symbols : []);
      })
      .catch(() => {
        if (!cancelled) setSymbols([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  useEffect(() => {
    if (!loading && !user && lane === "watchlist") setLane("markets");
  }, [loading, user, lane]);

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
      }
      if (n.category === "markets") markets.push(n);
      else if (n.category === "macro") macro.push(n);
      else if (n.category === "policy") policy.push(n);
      else general.push(n);
    }
    return {
      watchlist,
      markets: clusterByTitle(markets, 0.4, 0.32),
      macro: clusterByTitle(macro, 0.4, 0.32),
      policy: clusterByTitle(policy, 0.4, 0.32),
      general: clusterByTitle(general, 0.4, 0.32),
    };
  }, [news, watched]);

  const watchNewest = dayKey(buckets.watchlist[0]?.published_at);

  const stockRows = useMemo(() => {
    const by = new Map<string, { tag: StockTag; items: FeedItem[] }>();
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
      .sort((a, b) => latestAge(a.items, watchNewest) - latestAge(b.items, watchNewest) || b.n - a.n);
  }, [buckets.watchlist, watched, watchNewest]);

  const stockBuckets = useMemo(() => {
    const today: StockRow[] = [];
    const week: StockRow[] = [];
    const month: StockRow[] = [];
    for (const s of stockRows) {
      const age = latestAge(s.items, watchNewest);
      if (age <= 0) today.push(s);
      else if (age <= 7) week.push(s);
      else month.push(s);
    }
    return { today, week, month };
  }, [stockRows, watchNewest]);

  const activeStock = stock && stockRows.some((s) => s.symbol === stock)
    ? stock
    : (stockBuckets.today[0] ?? stockBuckets.week[0] ?? stockBuckets.month[0])?.symbol ?? null;

  const watchHeadlines = useMemo(() => {
    if (!activeStock) return [] as FeedItem[];
    return stockRows.find((s) => s.symbol === activeStock)?.items ?? [];
  }, [stockRows, activeStock]);

  const wireAll = lane === "watchlist" ? watchHeadlines : buckets[lane];
  const newest = dayKey(wireAll[0]?.published_at);
  const dayGroups = useMemo(() => groupByDay(wireAll, newest), [wireAll, newest]);

  const todayG = dayGroups.filter((d) => d.age <= 0);
  const yestG = dayGroups.filter((d) => d.age === 1);
  const weekG = dayGroups.filter((d) => d.age >= 2 && d.age <= 7);
  const monthG = dayGroups.filter((d) => d.age >= 8);
  const todayN = todayG.reduce((n, d) => n + d.items.length, 0);
  const yestN = yestG.reduce((n, d) => n + d.items.length, 0);
  const weekN = weekG.reduce((n, d) => n + d.items.length, 0);
  const monthN = monthG.reduce((n, d) => n + d.items.length, 0);

  useEffect(() => {
    const seed = `${lane}:${dayGroups.map((d) => d.key).join("|")}`;
    if (seed === dateSeed) return;
    setDateSeed(seed);
    setDateSel(firstSel(dayGroups));
    setSelectedId(null);
    setOpenRange({ week: weekG.length > 0 && todayN + yestN === 0, month: false });
  }, [lane, dayGroups, dateSeed, weekG.length, todayN, yestN]);

  const visibleItems = useMemo(() => {
    if (lane === "watchlist") return watchHeadlines;
    if (dateSel === "today") return todayG.flatMap((d) => d.items);
    if (dateSel === "yesterday") return yestG.flatMap((d) => d.items);
    if (dateSel === "week") return weekG.flatMap((d) => d.items);
    if (dateSel === "month") return monthG.flatMap((d) => d.items);
    if (dateSel.startsWith("day:")) {
      const key = dateSel.slice(4);
      return dayGroups.find((d) => d.key === key)?.items ?? [];
    }
    return [];
  }, [lane, watchHeadlines, dateSel, todayG, yestG, weekG, monthG, dayGroups]);

  const activeId =
    selectedId && visibleItems.some((n) => n.id === selectedId)
      ? selectedId
      : visibleItems[0]?.id ?? null;
  const selected = visibleItems.find((n) => n.id === activeId) ?? null;

  const visibleLanes = useMemo(
    () => LANES.filter((t) => t.id !== "watchlist" || loading || !!user),
    [loading, user],
  );

  function pickDate(next: DateSel) {
    setDateSel(next);
    setSelectedId(null);
    if (next === "week") setOpenRange((s) => ({ ...s, week: true }));
    if (next === "month") setOpenRange((s) => ({ ...s, month: true }));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (visibleItems.length === 0) return;
        e.preventDefault();
        const i = visibleItems.findIndex((n) => n.id === activeId);
        const at = i < 0 ? 0 : i;
        const next =
          e.key === "ArrowDown"
            ? visibleItems[Math.min(visibleItems.length - 1, at + 1)]
            : visibleItems[Math.max(0, at - 1)];
        if (next) setSelectedId(next.id);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const i = visibleLanes.findIndex((l) => l.id === lane);
        const at = i < 0 ? 0 : i;
        const next =
          e.key === "ArrowRight"
            ? visibleLanes[Math.min(visibleLanes.length - 1, at + 1)]
            : visibleLanes[Math.max(0, at - 1)];
        if (next && next.id !== lane) {
          setLane(next.id);
          setSelectedId(null);
        }
      } else if (e.key === "Enter" && selected) {
        e.preventDefault();
        window.open(selected.url, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleItems, activeId, lane, visibleLanes, selected]);

  useEffect(() => {
    if (!activeId) return;
    const el = document.querySelector(`[data-news-id="${CSS.escape(activeId)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div
          role="tablist"
          aria-label="News lane"
          className="flex flex-wrap border hairline overflow-hidden"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          {visibleLanes.map((t) => {
            const n = buckets[t.id].length;
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
                className="px-3.5 py-1.5 text-[13px] border-r hairline last:border-r-0"
                style={
                  on
                    ? { fontWeight: 600, color: "var(--color-ink)", boxShadow: EDGE_TAB }
                    : { color: "var(--color-muted)" }
                }
              >
                {t.label}
                <span
                  className="tabular-nums ml-1.5"
                  style={{ color: "var(--color-muted)" }}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <span className="text-[11px] muted-text">Showing last 30 days</span>
        <span className="text-[11px] muted-text ml-auto">↑↓ headlines · ←→ lanes · Enter opens</span>
      </div>

      {lane === "watchlist" ? (
        <WatchBoard
          today={stockBuckets.today}
          week={stockBuckets.week}
          month={stockBuckets.month}
          activeStock={activeStock}
          headlines={watchHeadlines}
          selected={selected}
          signedIn={!!user}
          loading={loading}
          now={now}
          onStock={(s) => {
            setStock(s);
            setSelectedId(null);
          }}
          onPick={setSelectedId}
        />
      ) : (
        <WireBoard
          todayN={todayN}
          yestN={yestN}
          weekN={weekN}
          monthN={monthN}
          weekDays={weekG}
          monthDays={monthG}
          dateSel={dateSel}
          openRange={openRange}
          items={visibleItems}
          selected={selected}
          now={now}
          onPickDate={pickDate}
          onToggleRange={(id) =>
            setOpenRange((s) => ({ ...s, [id]: !s[id] }))
          }
          onPick={setSelectedId}
        />
      )}
    </>
  );
}

function WireBoard({
  todayN,
  yestN,
  weekN,
  monthN,
  weekDays,
  monthDays,
  dateSel,
  openRange,
  items,
  selected,
  now,
  onPickDate,
  onToggleRange,
  onPick,
}: {
  todayN: number;
  yestN: number;
  weekN: number;
  monthN: number;
  weekDays: DayGroup[];
  monthDays: DayGroup[];
  dateSel: DateSel;
  openRange: { week: boolean; month: boolean };
  items: FeedItem[];
  selected: FeedItem | null;
  now: number | null;
  onPickDate: (s: DateSel) => void;
  onToggleRange: (id: "week" | "month") => void;
  onPick: (id: string) => void;
}) {
  return (
    <div
      className="grid border hairline overflow-hidden max-lg:grid-cols-1 lg:grid-cols-[minmax(168px,15%)_minmax(0,1.4fr)_minmax(300px,0.85fr)]"
      style={{ backgroundColor: "#fff", height: BOARD_H }}
    >
      <DateRail
        todayN={todayN}
        yestN={yestN}
        weekN={weekN}
        monthN={monthN}
        weekDays={weekDays}
        monthDays={monthDays}
        dateSel={dateSel}
        openRange={openRange}
        onPickDate={onPickDate}
        onToggleRange={onToggleRange}
      />
      <HeadlineCol items={items} selectedId={selected?.id ?? null} now={now} onPick={onPick} />
      <SummaryPane item={selected} now={now} />
    </div>
  );
}

function DateRail({
  todayN,
  yestN,
  weekN,
  monthN,
  weekDays,
  monthDays,
  dateSel,
  openRange,
  onPickDate,
  onToggleRange,
}: {
  todayN: number;
  yestN: number;
  weekN: number;
  monthN: number;
  weekDays: DayGroup[];
  monthDays: DayGroup[];
  dateSel: DateSel;
  openRange: { week: boolean; month: boolean };
  onPickDate: (s: DateSel) => void;
  onToggleRange: (id: "week" | "month") => void;
}) {
  return (
    <div className="border-r hairline overflow-y-auto">
      <RailRow
        label="Today"
        n={todayN}
        on={dateSel === "today"}
        onClick={() => onPickDate("today")}
      />
      <RailRow
        label="Yesterday"
        n={yestN}
        on={dateSel === "yesterday"}
        onClick={() => onPickDate("yesterday")}
      />
      <RangeBlock
        id="week"
        label="3–7 days"
        n={weekN}
        days={weekDays}
        dateSel={dateSel}
        open={openRange.week}
        onPickDate={onPickDate}
        onToggle={() => onToggleRange("week")}
      />
      <RangeBlock
        id="month"
        label="8–30 days"
        n={monthN}
        days={monthDays}
        dateSel={dateSel}
        open={openRange.month}
        onPickDate={onPickDate}
        onToggle={() => onToggleRange("month")}
      />
    </div>
  );
}

function RailRow({
  label,
  n,
  on,
  onClick,
  indent = false,
}: {
  label: string;
  n: number;
  on: boolean;
  onClick: () => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center text-left border-b hairline"
      style={{
        padding: indent ? "7px 10px 7px 22px" : "9px 12px",
        boxShadow: on ? EDGE : undefined,
        fontWeight: on ? 600 : 500,
      }}
    >
      <span className={indent ? "text-[12px]" : "text-[13px]"}>{label}</span>
      <span className="ml-auto tabular-nums text-[11px] muted-text">{n}</span>
    </button>
  );
}

function RangeBlock({
  id,
  label,
  n,
  days,
  dateSel,
  open,
  onPickDate,
  onToggle,
}: {
  id: "week" | "month";
  label: string;
  n: number;
  days: DayGroup[];
  dateSel: DateSel;
  open: boolean;
  onPickDate: (s: DateSel) => void;
  onToggle: () => void;
}) {
  const rangeOn = dateSel === id;
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <div className="flex border-b hairline" style={{ boxShadow: rangeOn ? EDGE : undefined }}>
        <button
          type="button"
          onClick={() => onPickDate(id)}
          className="flex-1 flex items-center text-left px-3 py-2"
          style={{ fontWeight: rangeOn ? 600 : 500 }}
        >
          <span className="text-[13px]">{label}</span>
          <span className="ml-auto tabular-nums text-[11px] muted-text mr-1">{n}</span>
        </button>
        <button type="button" aria-expanded={open} onClick={onToggle} className="px-2 muted-text">
          <Icon size={13} />
        </button>
      </div>
      {open &&
        days.map((d) => (
          <RailRow
            key={d.key}
            label={d.label}
            n={d.items.length}
            on={dateSel === `day:${d.key}`}
            indent
            onClick={() => onPickDate(`day:${d.key}`)}
          />
        ))}
    </div>
  );
}

function HeadlineCol({
  items,
  selectedId,
  now,
  onPick,
}: {
  items: FeedItem[];
  selectedId: string | null;
  now: number | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="border-r hairline overflow-y-auto">
      {items.length === 0 && (
        <div className="px-3 py-4 text-[13px] muted-text">No headlines in this window.</div>
      )}
      {items.map((n) => {
        const on = n.id === selectedId;
        return (
          <button
            key={n.id}
            type="button"
            data-news-id={n.id}
            aria-selected={on}
            title={n.title}
            onClick={() => onPick(n.id)}
            className="flex w-full items-start gap-2 text-left px-3 py-2 border-b hairline"
            style={on ? { boxShadow: EDGE, backgroundColor: PICK_WASH } : undefined}
          >
            <span className="text-[13px] leading-snug flex-1">{n.title}</span>
            <span className="tabular-nums text-[11px] muted-text shrink-0 mt-0.5">
              {ago(n.published_at, now)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WatchBoard({
  today,
  week,
  month,
  activeStock,
  headlines,
  selected,
  signedIn,
  loading,
  now,
  onStock,
  onPick,
}: {
  today: StockRow[];
  week: StockRow[];
  month: StockRow[];
  activeStock: string | null;
  headlines: FeedItem[];
  selected: FeedItem | null;
  signedIn: boolean;
  loading: boolean;
  now: number | null;
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
  if (today.length + week.length + month.length === 0) {
    return (
      <div className="card p-6 muted-text text-[13px]">
        No headlines in the last 30 days for your watchlist.
      </div>
    );
  }

  return (
    <div
      className="grid border hairline overflow-hidden max-lg:grid-cols-1 lg:grid-cols-[minmax(160px,15%)_minmax(0,1.4fr)_minmax(300px,0.85fr)]"
      style={{ backgroundColor: "#fff", height: BOARD_H }}
    >
      <div className="border-r hairline overflow-y-auto">
        <StockSection title="Today" rows={today} active={activeStock} onStock={onStock} defaultOpen={today.length > 0} />
        <StockSection title="This week" rows={week} active={activeStock} onStock={onStock} defaultOpen={today.length === 0} />
        <StockSection title="Rest of month" rows={month} active={activeStock} onStock={onStock} />
      </div>
      <HeadlineCol items={headlines} selectedId={selected?.id ?? null} now={now} onPick={onPick} />
      <SummaryPane item={selected} now={now} />
    </div>
  );
}

function StockSection({
  title,
  rows,
  active,
  onStock,
  defaultOpen = false,
}: {
  title: string;
  rows: StockRow[];
  active: string | null;
  onStock: (s: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (rows.length === 0) return null;
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-2.5 py-1.5 text-left border-b hairline"
      >
        <Icon size={12} className="shrink-0 muted-text" />
        <span className="text-[10px] font-semibold uppercase tracking-wider">{title}</span>
        <span className="ml-auto text-[10px] tabular-nums muted-text">{rows.length}</span>
      </button>
      {open &&
        rows.map((s) => {
          const on = s.symbol === active;
          const move = s.tag.ret_1d;
          return (
            <div
              className="flex items-start gap-1 px-3 py-1.5 border-b hairline"
              style={on ? { boxShadow: EDGE } : undefined}
            >
              <button
                type="button"
                onClick={() => onStock(s.symbol)}
                className="flex-1 text-left min-w-0"
                style={on ? { fontWeight: 600 } : undefined}
              >
                <span className="font-mono text-[12.5px] font-medium">{s.symbol}</span>
                <span className="block text-[10.5px] tabular-nums mt-0.5 muted-text">
                  {storyWord(s.n)}
                  {move != null && (
                    <span className={move >= 0 ? "delta-up" : "delta-down"}>
                      {" · "}
                      {move >= 0 ? "+" : ""}
                      {move.toFixed(1)}%
                    </span>
                  )}
                </span>
              </button>
              <Link
                href={`/stock/${s.symbol}`}
                className="shrink-0 mt-0.5 muted-text"
                title={`Open ${s.symbol}`}
                aria-label={`Open ${s.symbol} stock page`}
              >
                <ArrowUpRight size={12} />
              </Link>
            </div>
          );
        })}
    </div>
  );
}

function SummaryPane({
  item,
  now,
}: {
  item: FeedItem | null;
  now: number | null;
}) {
  if (!item) {
    return (
      <div className="px-4 py-3 overflow-y-auto">
        <span className="text-[13px] muted-text">Pick a headline.</span>
      </div>
    );
  }
  return (
    <div className="px-4 py-3 overflow-y-auto">
      <div className="text-[11px] muted-text mb-2">
        {sourceLabel(item.url) ?? "Source"}
        {item.published_at ? ` · ${ago(item.published_at, now)}` : ""}
      </div>
      <div className="text-[15px] font-medium leading-snug mb-2">{item.title}</div>
      <p className="text-[13px] leading-relaxed">
        {item.summary?.trim() || "No summary in the RSS item — open the source."}
      </p>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[12px] mt-3 font-medium underline"
      >
        Open article <ArrowUpRight size={12} />
      </a>
      {item.tags.length > 0 && (
        <div className="mt-3 pt-3 border-t hairline flex flex-wrap gap-2">
          {item.tags.slice(0, 4).map((t) => {
            const b = band(t.composite);
            const move = t.ret_1d;
            return (
              <Link
                key={t.symbol}
                href={`/stock/${t.symbol}`}
                className="inline-flex items-center gap-1.5 text-[11px]"
              >
                <span
                  className={`inline-grid place-items-center w-6 h-4 text-[10px] font-semibold tabular-nums ${b ? `score-bg-${b}` : ""}`}
                  title={
                    t.composite != null
                      ? `Industry score ${Math.round(t.composite)}`
                      : "No score"
                  }
                >
                  {t.composite != null ? Math.round(t.composite) : "—"}
                </span>
                <span className="font-mono underline">{t.symbol}</span>
                {move != null && (
                  <span className={move >= 0 ? "delta-up" : "delta-down"}>
                    {move >= 0 ? "+" : ""}
                    {move.toFixed(1)}%
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
