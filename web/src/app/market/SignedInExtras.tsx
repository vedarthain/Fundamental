"use client";

/**
 * SignedInExtras — additional /market cards visible only to signed-in
 * users.  Fetches /api/market/me client-side AFTER the public page
 * shell has rendered, so signed-in users don't pay a second cold-start
 * cost on the server. Shows a lightweight skeleton until the fetch
 * resolves; the rest of /market is fully interactive while this loads.
 *
 * Two cards once data arrives:
 *   1. Your watchlist today — every saved symbol with 1D + 1W context,
 *      sorted by absolute 1D move.
 *   2. FII / DII trend · 60 days — full-month grouped bar chart.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import type { MarketMeResponse, WatchlistMover, FiiTrendPoint } from "../api/market/me/route";

const UP   = "var(--color-delta-up)";
const DOWN = "var(--color-delta-down)";
const MUTED = "var(--color-muted)";
const INK  = "var(--color-ink)";

export function SignedInExtras() {
  // Client-side fetch so the public page renders immediately; this
  // section pops in once /api/market/me responds. Skeleton holds the
  // layout to avoid jumpy hydration when data arrives.
  const [data, setData] = useState<MarketMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/market/me", { credentials: "include" });
        if (!r.ok) throw new Error(`server ${r.status}`);
        const json = (await r.json()) as MarketMeResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-2">
        <span
          className="px-2 py-0.5 text-[10px] tracking-[0.12em] font-semibold uppercase rounded"
          style={{ backgroundColor: "var(--color-accent-50, #f0ece4)", color: "var(--color-accent-700, #6b4a2b)" }}
        >
          Signed in
        </span>
        <span className="muted-text text-[11px]">
          Personal cards — only you see these.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loading ? (
          <>
            <SkeletonCard label="Your watchlist today" />
            <SkeletonCard label="FII / DII trend" />
          </>
        ) : error ? (
          <div className="lg:col-span-2 card p-4 text-[12px] muted-text">
            Couldn&apos;t load your personalised cards ({error}). Refresh to retry.
          </div>
        ) : data ? (
          <>
            <WatchlistTodayCard rows={data.watchlistMovers} />
            <FiiTrend60DayCard series={data.fiiTrend} />
          </>
        ) : null}
      </div>
    </section>
  );
}

function SkeletonCard({ label }: { label: string }) {
  return (
    <section className="card p-4 md:p-5">
      <div className="font-display text-[15px] leading-tight">{label}</div>
      <div className="muted-text text-[10.5px] mt-0.5">Loading…</div>
      <div className="mt-3 space-y-2">
        <div className="h-3 w-3/4 rounded animate-pulse" style={{ backgroundColor: "var(--color-paper)" }} />
        <div className="h-3 w-1/2 rounded animate-pulse" style={{ backgroundColor: "var(--color-paper)" }} />
        <div className="h-[120px] mt-2 rounded animate-pulse" style={{ backgroundColor: "var(--color-paper)" }} />
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Watchlist Today
// ──────────────────────────────────────────────────────────────────────────

function WatchlistTodayCard({ rows }: { rows: WatchlistMover[] }) {
  return (
    <section className="card overflow-hidden">
      <div className="px-3 md:px-4 py-2.5 border-b hairline flex items-baseline justify-between gap-2">
        <div>
          <div className="font-display text-[15px] leading-tight">Your watchlist today</div>
          <div className="muted-text text-[10.5px] mt-0.5">
            Sorted by biggest absolute 1D move · quality dot = Q-percentile
          </div>
        </div>
        <Link
          href="/watchlist"
          className="text-[11px] muted-text hover:underline"
          style={{ color: "var(--color-accent-600)" }}
        >
          Manage →
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <div className="text-[13px] mb-1.5">No saved symbols yet</div>
          <div className="muted-text text-[11.5px] mb-3">
            Hit the heart on any /stock page to start tracking it here.
          </div>
          <Link
            href="/sectors"
            className="inline-block px-3 py-1.5 rounded-md border text-[12px] font-medium hover:bg-[var(--color-paper)]"
            style={{ borderColor: "var(--color-border-default)" }}
          >
            Browse sectors
          </Link>
        </div>
      ) : (
        <ul className="divide-y hairline max-h-[360px] overflow-y-auto">
          {rows.map((r) => <WatchlistRow key={r.symbol} row={r} />)}
        </ul>
      )}
    </section>
  );
}

function WatchlistRow({ row }: { row: WatchlistMover }) {
  const r1d = row.ret_1d == null ? null : row.ret_1d * 100;
  const r1w = row.ret_1w == null ? null : row.ret_1w * 100;
  const qPct = row.quality_pct ?? 0;
  const qColor = qualityColor(qPct);

  return (
    <li>
      <Link
        href={`/stock/${row.symbol}`}
        className="block px-3 md:px-4 py-2 hover:bg-[var(--color-paper)] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: qColor, boxShadow: `0 0 0 2px ${qColor}33` }}
            title={`Quality: ${Math.round(qPct)}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-[13px] tabular-nums">{row.symbol}</span>
              <span className="muted-text text-[10.5px] truncate">
                {row.industry_name || row.company_name || ""}
              </span>
            </div>
          </div>
          <div className="flex items-baseline gap-3 shrink-0 tabular-nums text-[11.5px]">
            <PctCell label="1D" v={r1d} bold />
            <PctCell label="1W" v={r1w} />
          </div>
        </div>
      </Link>
    </li>
  );
}

function PctCell({ label, v, bold = false }: { label: string; v: number | null; bold?: boolean }) {
  if (v == null) {
    return <span><span className="muted-text">{label}</span> <span className="opacity-60">—</span></span>;
  }
  const color = v >= 0 ? UP : DOWN;
  const sign = v >= 0 ? "+" : "";
  return (
    <span>
      <span className="muted-text">{label} </span>
      <span className={bold ? "font-semibold" : "font-medium"} style={{ color }}>
        {sign}{v.toFixed(2)}%
      </span>
    </span>
  );
}

function qualityColor(pct: number): string {
  if (pct >= 80) return "#1f8a4c";
  if (pct >= 60) return "#6cab43";
  if (pct >= 40) return "#d6a035";
  if (pct >= 20) return "#c97a3f";
  return "#a14a32";
}

// ──────────────────────────────────────────────────────────────────────────
// FII / DII 60-day trend
// ──────────────────────────────────────────────────────────────────────────

function FiiTrend60DayCard({ series }: { series: FiiTrendPoint[] }) {
  const FII_COLOR = "#7c6dd0";
  const DII_COLOR = "#0f8a8a";

  // Running totals for the headline numbers — gives the user a one-glance
  // "FII has been net X over the visible window" instead of forcing them
  // to eyeball the chart.
  const totals = series.reduce(
    (acc, p) => ({
      fii: acc.fii + (p.fii_net ?? 0),
      dii: acc.dii + (p.dii_net ?? 0),
    }),
    { fii: 0, dii: 0 },
  );

  return (
    <section className="card p-3 md:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-display text-[15px] leading-tight">
            FII / DII trend <span className="muted-text font-normal text-[12px]">· {series.length} sessions</span>
          </div>
          <div className="muted-text text-[10.5px] mt-0.5">Daily net flows ₹ Cr</div>
        </div>
        <div className="flex items-center gap-3 text-[11px] tabular-nums">
          <CumulativeCell color={FII_COLOR} label="FII total" value={totals.fii} />
          <CumulativeCell color={DII_COLOR} label="DII total" value={totals.dii} />
        </div>
      </div>
      <MountedChart className="mt-2 h-[200px] md:h-[220px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} barGap={1} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border-default)" strokeDasharray="2 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtMonth}
              minTickGap={36}
              tick={{ fontSize: 10, fill: "var(--color-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
              tick={{ fontSize: 9, fill: "var(--color-muted)" }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <ReferenceLine y={0} stroke="var(--color-border-default)" />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelFormatter={(l) => fmtFull(String(l ?? ""))}
              formatter={(v: unknown, n: unknown) => [
                `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`,
                String(n) === "fii_net" ? "FII net" : "DII net",
              ]}
            />
            <Bar dataKey="fii_net" fill={FII_COLOR} radius={[2, 2, 0, 0]} />
            <Bar dataKey="dii_net" fill={DII_COLOR} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </MountedChart>
      <div className="mt-1 flex items-center gap-3 text-[10px] muted-text">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: FII_COLOR }} />FII net</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: DII_COLOR }} />DII net</span>
        <span className="ml-auto">bars above 0 = buying</span>
      </div>
    </section>
  );
}

function CumulativeCell({ color, label, value }: { color: string; label: string; value: number }) {
  const positive = value >= 0;
  return (
    <span>
      <span className="muted-text">{label} </span>
      <span className="font-semibold" style={{ color }}>
        {positive ? "+" : "−"}₹{Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
      </span>
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers shared with MarketClient (kept private here to avoid pulling its
// whole module into the signed-in tree)
// ──────────────────────────────────────────────────────────────────────────

/** ResizeObserver-gated chart wrapper — same pattern as MarketClient.
 *  Avoids recharts' "width(-1) height(-1)" warning during hydration. */
function MountedChart({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    const check = (): boolean => {
      const el = ref.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    if (check()) { setReady(true); return; }
    const obs = new ResizeObserver(() => {
      if (!cancelled && check()) { setReady(true); obs.disconnect(); }
    });
    obs.observe(ref.current);
    return () => { cancelled = true; obs.disconnect(); };
  }, []);
  return <div ref={ref} className={className}>{ready ? children : null}</div>;
}

const chartTooltipStyle: React.CSSProperties = {
  backgroundColor: "var(--color-card)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 6,
  fontSize: 10.5,
  padding: "5px 7px",
};

function fmtMonth(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function fmtFull(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

// Suppress unused warning for INK (kept exported-ish in spirit for future use).
void INK; void MUTED;
