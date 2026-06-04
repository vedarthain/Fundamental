"use client";

/**
 * IndicesClient — master-detail index board.
 *
 * Left: a selectable list of every tracked index (grouped Headline / Broad /
 * Sectoral) with its live level + 1D move. Right: the selected index in two
 * tabs — Chart (the price graph, reusing the shared PriceChart with live 1D
 * intraday) and Constituents (members with live price, 1D, real NSE weight).
 *
 * Live ticks + today's intraday series come from /api/market/index-live,
 * polled every 60s (the 10-min index pinger writes them). On mobile the left
 * list collapses to a dropdown so the detail pane gets the full width.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PriceChart, type PricePoint } from "@/components/PriceChart";

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

const UP = "var(--color-delta-up)";
const DOWN = "var(--color-delta-down)";
const MUTED = "var(--color-muted)";
const ACCENT = "var(--color-accent-600)";

const LIVE_MAX_AGE_S = 15 * 60;

type LiveTick = {
  code: string;
  ltp: number;
  prev_close: number | null;
  pct_change: number | null;
  ts: string;
  age_seconds: number;
};
type LiveData = {
  ticks: Record<string, LiveTick>;
  intraday: Record<string, { ts: string; ltp: number }[]>;
};

const GROUPS: { title: string; codes: string[] }[] = [
  { title: "Headline", codes: ["NIFTY50", "NIFTYBANK"] },
  { title: "Broad market", codes: ["NIFTY100", "NIFTY500", "NIFTYNEXT50", "NIFTYMIDCAP100", "NIFTYSMALLCAP100"] },
  { title: "Sectoral", codes: ["NIFTYIT", "NIFTYAUTO", "NIFTYFMCG", "NIFTYPHARMA", "NIFTYENERGY", "NIFTYMETAL", "NIFTYREALTY"] },
];

// ── Live polling ────────────────────────────────────────────────────────────
function useLiveIndexData(): LiveData {
  const [data, setData] = useState<LiveData>({ ticks: {}, intraday: {} });
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/market/index-live", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as Partial<LiveData>;
        if (alive) setData({ ticks: json.ticks ?? {}, intraday: json.intraday ?? {} });
      } catch {
        /* keep last good data */
      }
    };
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return data;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function istDayKey(d: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(d));
}
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
function pctColorOf(v: number | null): string {
  return v == null ? MUTED : v >= 0 ? UP : DOWN;
}
function fmtPct(v: number | null, dp = 2): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
}
/** Live level + 1D for a row, preferring today's held tick. */
function liveOf(row: IndexBoardRow, tick: LiveTick | undefined) {
  const held = todayTick(tick);
  return {
    level: held ? held.ltp : row.close,
    pct: held?.pct_change ?? row.pct_change_1d,
    isLive: !!held && (tick?.age_seconds ?? Infinity) <= LIVE_MAX_AGE_S,
    ts: held?.ts ?? tick?.ts ?? null,
  };
}

// ── Board ───────────────────────────────────────────────────────────────────
export function IndicesClient({ indices }: { indices: IndexBoardRow[] }) {
  const live = useLiveIndexData();
  const byCode = useMemo(() => new Map(indices.map((r) => [r.code, r])), [indices]);
  // Default to the first available code (prefer NIFTY50).
  const firstCode = byCode.has("NIFTY50") ? "NIFTY50" : indices[0]?.code ?? "";
  const [selected, setSelected] = useState<string>(firstCode);
  const [tab, setTab] = useState<"chart" | "constituents">("chart");

  const row = byCode.get(selected);

  return (
    <div>
      <header className="mb-4">
        <h1 className="font-display text-[22px] md:text-[26px] leading-tight">NSE Index Board</h1>
        <p className="muted-text text-[12px] mt-1">
          All tracked Nifty indices · pick one to see its chart and constituents · live updates every ~10 min
        </p>
      </header>

      {/* Mobile selector */}
      <div className="lg:hidden mb-3">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-[13px] bg-[var(--color-card)]"
          style={{ borderColor: "var(--color-border-default)" }}
        >
          {GROUPS.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.codes.filter((c) => byCode.has(c)).map((c) => (
                <option key={c} value={c}>{byCode.get(c)!.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="lg:grid lg:grid-cols-[290px_1fr] lg:gap-4">
        {/* Left list (desktop) */}
        <aside className="hidden lg:block self-start sticky top-4 space-y-3">
          {GROUPS.map((g) => {
            const rows = g.codes.map((c) => byCode.get(c)).filter((r): r is IndexBoardRow => !!r);
            if (rows.length === 0) return null;
            return (
              <div key={g.title}>
                <div className="muted-text text-[10px] tracking-[0.12em] font-semibold uppercase mb-1.5 px-1">{g.title}</div>
                <div className="space-y-1">
                  {rows.map((r) => (
                    <IndexListItem
                      key={r.code}
                      row={r}
                      tick={live.ticks[r.code]}
                      selected={r.code === selected}
                      onSelect={() => setSelected(r.code)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </aside>

        {/* Detail pane */}
        <section className="min-w-0">
          {row ? (
            <IndexDetail
              row={row}
              tick={live.ticks[row.code]}
              intraday={live.intraday[row.code] ?? []}
              tab={tab}
              setTab={setTab}
            />
          ) : (
            <div className="card p-6 muted-text text-[13px]">No index data.</div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Left list item ──────────────────────────────────────────────────────────
function IndexListItem({
  row, tick, selected, onSelect,
}: {
  row: IndexBoardRow;
  tick?: LiveTick;
  selected: boolean;
  onSelect: () => void;
}) {
  const { level, pct, isLive } = liveOf(row, tick);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left rounded-md border px-2.5 py-1.5 transition-colors"
      style={
        selected
          ? { background: "color-mix(in srgb, var(--color-accent-600) 10%, transparent)", borderColor: "var(--color-accent-300)" }
          : { background: "transparent", borderColor: "var(--color-border-default)" }
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium leading-tight truncate flex items-center gap-1.5">
          {row.name}
          {isLive && <LiveDot />}
        </span>
        <span className="tabular-nums text-[11px] font-medium shrink-0" style={{ color: pctColorOf(pct) }}>
          {fmtPct(pct, 2)}
        </span>
      </div>
      <div className="tabular-nums text-[12px] mt-0.5 muted-text">
        {level.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
      </div>
    </button>
  );
}

// ── Detail pane ─────────────────────────────────────────────────────────────
function IndexDetail({
  row, tick, intraday, tab, setTab,
}: {
  row: IndexBoardRow;
  tick?: LiveTick;
  intraday: { ts: string; ltp: number }[];
  tab: "chart" | "constituents";
  setTab: (t: "chart" | "constituents") => void;
}) {
  const { level, pct, isLive, ts } = liveOf(row, tick);
  const sparkData: PricePoint[] = row.sparkline;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b hairline">
        <div className="flex items-center gap-1.5">
          <h2 className="font-display text-[18px] leading-tight">{row.name}</h2>
          {isLive && <LiveDot />}
        </div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="font-display text-[24px] tabular-nums leading-none">
            {level.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
          </span>
          <span className="tabular-nums text-[13px] font-medium" style={{ color: pctColorOf(pct) }}>
            {fmtPct(pct, 2)} <span className="muted-text font-normal">1D</span>
          </span>
          {ts && (
            <span className="text-[10.5px] muted-text tabular-nums ml-auto">
              {isLive ? "updated" : "last"} {fmtClock(ts)} IST
            </span>
          )}
        </div>
        {/* Range chips (read-only context; chart has its own range control) */}
        <div className="flex flex-wrap gap-3 mt-1.5 text-[10.5px] tabular-nums">
          <span className="muted-text">1W <span style={{ color: pctColorOf(row.pct_change_1w) }}>{fmtPct(row.pct_change_1w, 1)}</span></span>
          <span className="muted-text">1M <span style={{ color: pctColorOf(row.pct_change_1m) }}>{fmtPct(row.pct_change_1m, 1)}</span></span>
          <span className="muted-text">1Y <span style={{ color: pctColorOf(row.pct_change_1y) }}>{fmtPct(row.pct_change_1y, 1)}</span></span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b hairline">
        <TabButton label="Chart" active={tab === "chart"} onClick={() => setTab("chart")} />
        <TabButton label="Constituents" active={tab === "constituents"} onClick={() => setTab("constituents")} />
      </div>

      <div className="p-3 md:p-4">
        {tab === "chart" ? (
          sparkData.length >= 2 ? (
            <PriceChart
              data={sparkData}
              intraday={intraday}
              currentPrice={level}
              priceFetchedAt={ts ?? undefined}
              prefix=""
            />
          ) : (
            <div className="h-[200px] flex items-center justify-center muted-text text-[13px]">
              No price history for this index.
            </div>
          )
        ) : (
          <ConstituentsPanel key={row.code} code={row.code} />
        )}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-4 py-2 text-[12.5px] font-medium transition-colors relative"
      style={{ color: active ? ACCENT : "var(--color-muted)" }}
    >
      {label}
      {active && (
        <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full" style={{ background: ACCENT }} />
      )}
    </button>
  );
}

// ── Constituents (lazy) ─────────────────────────────────────────────────────
function ConstituentsPanel({ code }: { code: string }) {
  const [data, setData] = useState<ConstituentsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    // Panel is keyed by code → remounts on index change, so initial state is
    // already "loading"/null; no reset needed here.
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

  if (state === "loading") return <div className="muted-text text-[12px] py-6 text-center">Loading constituents…</div>;
  if (state === "error") return <div className="muted-text text-[12px] py-6 text-center">Couldn’t load constituents.</div>;
  if (!data || data.count === 0) {
    return <div className="muted-text text-[12px] py-6 text-center">No constituent list ingested yet for this index.</div>;
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[10.5px] muted-text">
          {data.count} constituents · Wt% = NSE index weight
          {data.weights_as_of ? ` (factsheet ${data.weights_as_of})` : " — not yet added for this index"}
        </span>
        {data.fetched_at && (
          <span className="text-[10px] muted-text tabular-nums">prices {fmtClock(data.fetched_at)} IST</span>
        )}
      </div>
      <div className="overflow-y-auto overflow-x-auto max-h-[520px] rounded border hairline">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10" style={{ background: "var(--color-card)" }}>
            <tr className="muted-text text-[10px] uppercase tracking-wide text-left">
              <th className="font-medium py-1.5 pl-2 pr-1.5">Symbol</th>
              <th className="font-medium py-1.5 px-1.5 hidden md:table-cell">Sector</th>
              <th className="font-medium py-1.5 px-1.5 text-right">Price</th>
              <th className="font-medium py-1.5 px-1.5 text-right">1D</th>
              <th className="font-medium py-1.5 pl-1.5 pr-2 text-right">Wt%</th>
            </tr>
          </thead>
          <tbody>
            {data.constituents.map((c) => {
              const pct = c.pct_1d;
              return (
                <tr key={c.symbol} className="border-t hairline hover:bg-[var(--color-paper)] transition-colors">
                  <td className="py-1 pl-2 pr-1.5">
                    <Link href={`/stock/${c.symbol}`} className="hover:underline" title={c.company_name ?? c.symbol}>
                      <span className="font-medium">{c.symbol}</span>
                      {c.company_name && <span className="muted-text ml-1.5 hidden lg:inline">{c.company_name}</span>}
                    </Link>
                  </td>
                  <td className="py-1 px-1.5 muted-text hidden md:table-cell truncate max-w-[160px]">{c.sector ?? "—"}</td>
                  <td className="py-1 px-1.5 text-right tabular-nums">
                    {c.price == null ? "—" : c.price.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </td>
                  <td className="py-1 px-1.5 text-right tabular-nums" style={{ color: pctColorOf(pct == null ? null : pct * 100) }}>
                    {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(2)}%`}
                  </td>
                  <td className="py-1 pl-1.5 pr-2 text-right tabular-nums muted-text">
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

function LiveDot() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: UP }} />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: UP }} />
    </span>
  );
}
