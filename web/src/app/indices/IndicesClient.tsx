"use client";

/**
 * IndicesClient — the all-Nifty index board.
 *
 * Renders every tracked index grouped (Headline / Broad market / Sectoral),
 * each card showing the LIVE level + today's move overlaid on the EOD daily
 * figures from the server. Live ticks come from /api/market/index-live,
 * polled every 60s (the endpoint is CDN-cached 60s, so ~one origin read per
 * minute per region). The 10-min index pinger writes the underlying ticks.
 *
 * Phase 2 will add a per-card expand for constituents (read each member's
 * live price from the equity pinger, weighted by market cap). The card shell
 * is structured so that section slots in without a rewrite.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Sparkline, type SparkPoint } from "@/components/Sparkline";

type ConstituentRow = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  pct_1d: number | null;
  market_cap_cr: number | null;
  weight_pct: number | null;
};
type ConstituentsResponse = {
  code: string;
  count: number;
  total_mcap_cr: number;
  fetched_at: string | null;
  weights_as_of: string | null;
  constituents: ConstituentRow[];
};

export type IndexBoardRow = {
  code: string;
  name: string;
  close: number;
  pct_change_1d: number | null;
  pct_change_1w: number | null;
  pct_change_1m: number | null;
  pct_change_1y: number | null;
  date: string;
  sparkline: { date: string; close: number }[];
};

type Range = "1D" | "1W" | "1M" | "1Y";

const UP = "var(--color-delta-up)";
const DOWN = "var(--color-delta-down)";
const MUTED = "var(--color-muted)";
const ACCENT = "var(--color-accent-600)";

// A live tick is "live" (pulsing badge) only within this window; beyond it we
// still HOLD the price (last session) but drop the live indicator.
const LIVE_MAX_AGE_S = 15 * 60;

type LiveTick = {
  code: string;
  ltp: number;
  prev_close: number | null;
  pct_change: number | null;
  ts: string;
  age_seconds: number;
};

// ── Index taxonomy ─────────────────────────────────────────────────────────
const GROUPS: { title: string; codes: string[] }[] = [
  { title: "Headline", codes: ["NIFTY50", "NIFTYBANK"] },
  { title: "Broad market", codes: ["NIFTY100", "NIFTY500", "NIFTYNEXT50", "NIFTYMIDCAP100", "NIFTYSMALLCAP100"] },
  { title: "Sectoral", codes: ["NIFTYIT", "NIFTYAUTO", "NIFTYFMCG", "NIFTYPHARMA", "NIFTYENERGY", "NIFTYMETAL", "NIFTYREALTY"] },
];

// ── Live polling ────────────────────────────────────────────────────────────
function useLiveIndexTicks(): Record<string, LiveTick> {
  const [ticks, setTicks] = useState<Record<string, LiveTick>>({});
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/market/index-live", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { ticks?: Record<string, LiveTick> };
        if (alive) setTicks(json.ticks ?? {});
      } catch {
        /* keep last good data */
      }
    };
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return ticks;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function istDayKey(d: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(d));
}

/** Latest tick if it's from today's IST session (regardless of age) — so the
 *  board holds the 15:30 close through to the next session instead of
 *  reverting to yesterday's EOD. */
function todayTick(t: LiveTick | undefined): LiveTick | null {
  if (!t || typeof t.ltp !== "number") return null;
  return istDayKey(t.ts) === istDayKey(new Date()) ? t : null;
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function pctFor(row: IndexBoardRow, range: Range): number | null {
  if (range === "1D") return row.pct_change_1d;
  if (range === "1W") return row.pct_change_1w;
  if (range === "1M") return row.pct_change_1m;
  return row.pct_change_1y;
}

const RANGES: Range[] = ["1D", "1W", "1M", "1Y"];

// ── Board ───────────────────────────────────────────────────────────────────
export function IndicesClient({ indices }: { indices: IndexBoardRow[] }) {
  const [range, setRange] = useState<Range>("1D");
  const [expanded, setExpanded] = useState<string | null>(null);
  const ticks = useLiveIndexTicks();
  const byCode = useMemo(() => new Map(indices.map((r) => [r.code, r])), [indices]);

  // Newest live fetch time across all indices (header freshness stamp).
  const latestTs = useMemo(() => {
    let best: string | null = null;
    for (const t of Object.values(ticks)) {
      const held = todayTick(t);
      if (held && (!best || held.ts > best)) best = held.ts;
    }
    return best;
  }, [ticks]);
  const anyLive = useMemo(
    () => Object.values(ticks).some((t) => todayTick(t) && t.age_seconds <= LIVE_MAX_AGE_S),
    [ticks],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] md:text-[26px] leading-tight">NSE Index Board</h1>
          <p className="muted-text text-[12px] mt-1">
            All tracked Nifty indices · live level updates every ~10 min during market hours
            {latestTs && (
              <span className="ml-1.5 tabular-nums">
                · {anyLive ? "updated" : "last fetched"} {fmtClock(latestTs)} IST
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-md border" style={{ borderColor: "var(--color-border-default)" }}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-[12px] font-medium tabular-nums rounded transition-colors ${
                range === r ? "" : "muted-text hover:bg-[var(--color-paper)]"
              }`}
              style={range === r ? { backgroundColor: ACCENT, color: "white" } : undefined}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Groups */}
      {GROUPS.map((g) => {
        const rows = g.codes.map((c) => byCode.get(c)).filter((r): r is IndexBoardRow => !!r);
        if (rows.length === 0) return null;
        // Sort gainers-first by the selected range, using the live 1D when active.
        const sorted = [...rows].sort((a, b) => effPct(b, range, ticks) - effPct(a, range, ticks));
        return (
          <section key={g.title}>
            <h2 className="muted-text text-[11px] tracking-[0.12em] font-semibold uppercase mb-2">{g.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 items-start">
              {sorted.map((row) => (
                <IndexCard
                  key={row.code}
                  row={row}
                  range={range}
                  tick={ticks[row.code]}
                  expanded={expanded === row.code}
                  onToggle={() => setExpanded((c) => (c === row.code ? null : row.code))}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Effective % for sorting: live day-change when range is 1D and a today
 *  tick exists, else the EOD figure for that range. */
function effPct(row: IndexBoardRow, range: Range, ticks: Record<string, LiveTick>): number {
  if (range === "1D") {
    const held = todayTick(ticks[row.code]);
    if (held?.pct_change != null) return held.pct_change;
  }
  return pctFor(row, range) ?? -Infinity;
}

// ── Card ────────────────────────────────────────────────────────────────────
function IndexCard({
  row, range, tick, expanded, onToggle,
}: {
  row: IndexBoardRow;
  range: Range;
  tick?: LiveTick;
  expanded: boolean;
  onToggle: () => void;
}) {
  const held = todayTick(tick);
  const isLive = !!held && tick!.age_seconds <= LIVE_MAX_AGE_S;

  // Headline level + change. For 1D prefer the held live tick; other ranges
  // are EOD by nature (level still shows the latest known price).
  const level = held ? held.ltp : row.close;
  const headPct =
    range === "1D"
      ? (held?.pct_change ?? row.pct_change_1d)
      : pctFor(row, range);
  const headColor = headPct == null ? MUTED : headPct >= 0 ? UP : DOWN;

  // Sparkline (90d daily). Stroke follows the selected range's direction.
  const spark: SparkPoint[] = row.sparkline.map((p) => ({ label: p.date, value: p.close }));
  const sparkColor = (pctFor(row, range) ?? 0) >= 0 ? UP : DOWN;

  return (
    <div className={`card p-3 flex flex-col gap-2 ${expanded ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-[13px] leading-tight truncate">{row.name}</span>
            {isLive && <LiveDot />}
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="font-display text-[19px] tabular-nums leading-none">
              {level.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
            </span>
            <span className="tabular-nums text-[12px] font-medium" style={{ color: headColor }}>
              {headPct == null ? "—" : `${headPct >= 0 ? "+" : ""}${headPct.toFixed(2)}%`}
            </span>
          </div>
        </div>
        <div className="shrink-0">
          <Sparkline data={spark} width={104} height={36} stroke={sparkColor} />
        </div>
      </div>

      {/* Range chips */}
      <div className="grid grid-cols-4 gap-1 pt-1.5 border-t hairline">
        <RangeCell label="1D" value={range === "1D" ? (held?.pct_change ?? row.pct_change_1d) : row.pct_change_1d} active={range === "1D"} />
        <RangeCell label="1W" value={row.pct_change_1w} active={range === "1W"} />
        <RangeCell label="1M" value={row.pct_change_1m} active={range === "1M"} />
        <RangeCell label="1Y" value={row.pct_change_1y} active={range === "1Y"} />
      </div>

      {/* Constituents expander */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center justify-center gap-1 text-[11px] font-medium muted-text hover:text-[var(--color-ink)] transition-colors pt-1"
      >
        <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
        {expanded ? "Hide constituents" : "Constituents"}
      </button>
      {expanded && <ConstituentsPanel code={row.code} />}
    </div>
  );
}

// ── Constituents (lazy) ─────────────────────────────────────────────────────
function ConstituentsPanel({ code }: { code: string }) {
  const [data, setData] = useState<ConstituentsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    // Panel mounts fresh on each expand (conditionally rendered), so initial
    // state is already "loading"/null — no reset needed here.
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/indices/constituents?code=${encodeURIComponent(code)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ConstituentsResponse;
        if (alive) { setData(json); setState("ok"); }
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [code]);

  if (state === "loading") {
    return <div className="muted-text text-[12px] py-3 text-center">Loading constituents…</div>;
  }
  if (state === "error") {
    return <div className="muted-text text-[12px] py-3 text-center">Couldn’t load constituents.</div>;
  }
  if (!data || data.count === 0) {
    return (
      <div className="muted-text text-[12px] py-3 text-center">
        No constituent list ingested yet for this index.
      </div>
    );
  }

  return (
    <div className="mt-1 border-t hairline pt-2">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[10.5px] muted-text">
          {data.count} constituents · Wt% = NSE index weight
          {data.weights_as_of ? ` (factsheet ${data.weights_as_of})` : " — not yet added for this index"}
        </span>
        {data.fetched_at && (
          <span className="text-[10px] muted-text tabular-nums">prices {fmtClock(data.fetched_at)} IST</span>
        )}
      </div>
      {/* Height-capped + scrollable so big indices (NIFTY 500 = 500 rows)
          don't blow up the page; sticky header keeps columns labelled. */}
      <div className="overflow-y-auto overflow-x-auto max-h-[360px] rounded border hairline">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 z-10" style={{ background: "var(--color-card)" }}>
            <tr className="muted-text text-[9.5px] uppercase tracking-wide text-left">
              <th className="font-medium py-1 pl-2 pr-1.5">Symbol</th>
              <th className="font-medium py-1 px-1.5 hidden lg:table-cell">Sector</th>
              <th className="font-medium py-1 px-1.5 text-right">Price</th>
              <th className="font-medium py-1 px-1.5 text-right">1D</th>
              <th className="font-medium py-1 pl-1.5 pr-2 text-right">Wt%</th>
            </tr>
          </thead>
          <tbody>
            {data.constituents.map((c) => {
              const pct = c.pct_1d;
              const pctColor = pct == null ? MUTED : pct >= 0 ? UP : DOWN;
              return (
                <tr key={c.symbol} className="border-t hairline hover:bg-[var(--color-paper)] transition-colors">
                  <td className="py-0.5 pl-2 pr-1.5">
                    <Link href={`/stock/${c.symbol}`} className="hover:underline" title={c.company_name ?? c.symbol}>
                      <span className="font-medium">{c.symbol}</span>
                      {c.company_name && (
                        <span className="muted-text ml-1.5 hidden xl:inline">{c.company_name}</span>
                      )}
                    </Link>
                  </td>
                  <td className="py-0.5 px-1.5 muted-text hidden lg:table-cell truncate max-w-[140px]">{c.sector ?? "—"}</td>
                  <td className="py-0.5 px-1.5 text-right tabular-nums">
                    {c.price == null ? "—" : c.price.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </td>
                  <td className="py-0.5 px-1.5 text-right tabular-nums" style={{ color: pctColor }}>
                    {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(2)}%`}
                  </td>
                  <td className="py-0.5 pl-1.5 pr-2 text-right tabular-nums muted-text">
                    {c.weight_pct == null ? "—" : c.weight_pct.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RangeCell({ label, value, active }: { label: string; value: number | null; active: boolean }) {
  const color = value == null ? MUTED : value >= 0 ? UP : DOWN;
  return (
    <div
      className="rounded px-1 py-0.5 text-center"
      style={active ? { background: "color-mix(in srgb, var(--color-accent-600) 9%, transparent)" } : undefined}
    >
      <div className="text-[9px] muted-text uppercase tracking-wide">{label}</div>
      <div className="tabular-nums text-[11px] font-medium" style={{ color }}>
        {value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`}
      </div>
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: UP }} />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: UP }} />
    </span>
  );
}
