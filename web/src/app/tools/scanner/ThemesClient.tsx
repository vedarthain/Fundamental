"use client";

/**
 * ThemesClient — the "Themes" scanner tab.
 *
 * Layout intent: a real NSE thematic index as the benchmark, its constituents
 * read RELATIVE to it. Three panes:
 *   1. left  — pick one of 8 themes (each chip shows the index's own return)
 *   2. header— the picked index rebased-to-100 line + window return + breadth
 *              (% constituents beating zero) + advance/decline
 *   3. list  — constituents ranked by EXCESS return vs. the index (default),
 *              with Q/V/M chips, star + portfolio (P) markers. Toggle the sort
 *              to "Quality within theme" to rank by composite score instead —
 *              that's the differentiating read: who's beating the theme AND is
 *              fundamentally sound vs. just riding the tide.
 *
 * Windows are the three the panel cache carries (1w / 1m / 1y) so excess return
 * is apples-to-apples on both sides. No per-constituent price fetch.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Theme, ThemeWindow, ThemeConstituent } from "@/lib/themes";
import { Sparkline, type SparkPoint } from "@/components/Sparkline";
import { useStarred } from "@/lib/starred";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";
const VIOLET = "#7c3aed";

const WINDOWS: { id: ThemeWindow; label: string }[] = [
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
  { id: "1y", label: "1Y" },
];

// Approx trading-day span per window — how much of the index series to rebase
// for the header line. Mirrors WINDOW_OFFSET in lib/themes.ts.
const WINDOW_SPAN: Record<ThemeWindow, number> = { "1w": 6, "1m": 22, "1y": 251 };

function pctColor(p: number | null): string {
  if (p == null) return "var(--color-muted)";
  return p > 0 ? GREEN : p < 0 ? RED : "var(--color-muted)";
}
function signedPct(p: number | null, dp = 1): string {
  if (p == null) return "—";
  return `${p >= 0 ? "+" : ""}${p.toFixed(dp)}%`;
}
function scoreColor(p: number | null): string {
  if (p == null) return "var(--color-muted)";
  if (p >= 66) return GREEN;
  if (p >= 40) return "var(--color-score-weak, #b7791f)";
  return RED;
}

/** Pull a constituent's return for the active window. */
function constituentRet(c: ThemeConstituent, w: ThemeWindow): number | null {
  return w === "1w" ? c.ret1w : w === "1m" ? c.ret1m : c.ret1y;
}
/** The index's own return for the active window. */
function indexRet(t: Theme, w: ThemeWindow): number | null {
  return w === "1w" ? t.idxRet1w : w === "1m" ? t.idxRet1m : t.idxRet1y;
}

// Small Q/V/M/score pill.
function Chip({ label, value }: { label: string; value: number | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] tabular-nums"
      style={{ background: "var(--color-paper, #fbfbfd)", border: "1px solid var(--color-border)" }}
      title={`${label} percentile`}
    >
      <span className="muted-text">{label}</span>
      <span style={{ color: scoreColor(value), fontWeight: 700 }}>{value == null ? "—" : value}</span>
    </span>
  );
}

export default function ThemesClient({
  themes,
  snapDate,
  indexLastDate,
  n500Only,
  nifty500,
  portfolioSymbols = [],
}: {
  themes: Theme[];
  snapDate: string | null;
  indexLastDate: string | null;
  n500Only: boolean;
  nifty500: string[];
  portfolioSymbols?: string[];
}) {
  const [selectedCode, setSelectedCode] = useState<string>(themes[0]?.code ?? "");
  const [win, setWin] = useState<ThemeWindow>("1m");
  const [sort, setSort] = useState<"excess" | "quality">("excess");

  const { isStarred, toggle } = useStarred();
  const portfolioSet = useMemo(
    () => new Set(portfolioSymbols.map((s) => s.toUpperCase())),
    [portfolioSymbols],
  );
  const n500 = useMemo(() => new Set(nifty500), [nifty500]);

  const theme = useMemo(
    () => themes.find((t) => t.code === selectedCode) ?? themes[0],
    [themes, selectedCode],
  );

  // Rebase the index series to 100 within the active window for the header line.
  const rebased: SparkPoint[] = useMemo(() => {
    if (!theme) return [];
    const span = WINDOW_SPAN[win];
    const slice = theme.series.slice(-span - 1);
    if (slice.length < 2) return [];
    const base = slice[0].close;
    if (!base) return [];
    return slice.map((p) => ({ label: p.date, value: (p.close / base) * 100 }));
  }, [theme, win]);

  const idxRet = theme ? indexRet(theme, win) : null;

  // Constituents for the active window: attach excess return, filter to N500 if
  // scoped, drop names with no return for this window, then rank.
  const rows = useMemo(() => {
    if (!theme) return [];
    const enriched = theme.constituents
      .filter((c) => (n500Only ? n500.has(c.symbol) : true))
      .map((c) => {
        const r = constituentRet(c, win);
        const excess = r != null && idxRet != null ? r - idxRet : null;
        return { c, ret: r, excess };
      });
    enriched.sort((a, b) => {
      if (sort === "quality") {
        return (b.c.compositePct ?? -1) - (a.c.compositePct ?? -1);
      }
      return (b.excess ?? -Infinity) - (a.excess ?? -Infinity);
    });
    return enriched;
  }, [theme, win, idxRet, sort, n500Only, n500]);

  // Breadth + advance/decline over the window (constituents with a return).
  const { breadthPct, adv, dec, total } = useMemo(() => {
    const withRet = rows.filter((r) => r.ret != null);
    const a = withRet.filter((r) => (r.ret as number) > 0).length;
    const d = withRet.filter((r) => (r.ret as number) < 0).length;
    return {
      breadthPct: withRet.length ? (a / withRet.length) * 100 : null,
      adv: a,
      dec: d,
      total: withRet.length,
    };
  }, [rows]);

  // Max |excess| for scaling the inline excess bars.
  const maxAbsExcess = useMemo(() => {
    let m = 0;
    for (const r of rows) if (r.excess != null) m = Math.max(m, Math.abs(r.excess));
    return m || 1;
  }, [rows]);

  if (!theme) {
    return <div className="muted-text text-[13px] py-8">No theme data yet.</div>;
  }

  return (
    <div>
      {/* Eyebrow + freshness */}
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide muted-text">Themes</div>
          <h2 className="font-display text-[22px] leading-tight">Index vs. its constituents</h2>
        </div>
        <div className="text-[11px] muted-text text-right leading-tight">
          {snapDate && <div>Scores as of {snapDate}</div>}
          {indexLastDate && <div>Index to {indexLastDate}</div>}
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* Left: theme picker */}
        <div className="w-full lg:w-[176px] lg:shrink-0">
          <div className="text-[11px] uppercase tracking-wide muted-text mb-2 px-1">Theme</div>
          <div className="flex flex-wrap gap-1.5 lg:flex-col">
            {themes.map((t) => {
              const active = t.code === selectedCode;
              const r = indexRet(t, win);
              return (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => setSelectedCode(t.code)}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors"
                  style={
                    active
                      ? {
                          background: "color-mix(in srgb, var(--color-accent-600) 10%, transparent)",
                          borderColor: "color-mix(in srgb, var(--color-accent-600) 35%, transparent)",
                        }
                      : { borderColor: "var(--color-border)" }
                  }
                >
                  <span
                    className="text-[13px] font-semibold"
                    style={{ color: active ? "var(--color-accent-700)" : "var(--color-ink)" }}
                  >
                    {t.label}
                  </span>
                  <span className="text-[11px] tabular-nums" style={{ color: pctColor(r) }}>
                    {signedPct(r)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: header card + constituents */}
        <div className="min-w-0 flex-1">
          {/* Header card: rebased index line + stats */}
          <div className="card p-4 mb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-display text-[18px] leading-tight">
                  {theme.displayName ?? theme.label}
                </div>
                <div className="text-[11.5px] muted-text mt-0.5">
                  {theme.constituents.length} constituents{n500Only ? " · NIFTY 500 scope" : ""}
                </div>
                {/* Window toggle */}
                <div className="inline-flex items-center gap-1 rounded-lg p-1 border hairline mt-3" role="group" aria-label="Window">
                  {WINDOWS.map((w) => {
                    const active = win === w.id;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setWin(w.id)}
                        className="px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors"
                        style={active ? { background: "var(--color-accent-600)", color: "#fff" } : { color: "var(--color-muted)" }}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Rebased index line */}
              <div className="shrink-0">
                <Sparkline
                  data={rebased}
                  width={260}
                  height={64}
                  stroke={VIOLET}
                  showBaseline={false}
                  showHiLo
                />
              </div>
            </div>

            {/* Stat strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t hairline">
              <Stat label={`Index ${win.toUpperCase()}`} value={signedPct(idxRet)} color={pctColor(idxRet)} />
              <Stat
                label="Breadth"
                value={breadthPct == null ? "—" : `${breadthPct.toFixed(0)}%`}
                color={breadthPct == null ? "var(--color-muted)" : breadthPct >= 50 ? GREEN : RED}
                hint="% of constituents up over the window"
              />
              <Stat label="Advancing" value={`${adv}`} color={GREEN} />
              <Stat label="Declining" value={`${dec}`} color={RED} />
            </div>
          </div>

          {/* Sort toggle */}
          <div className="flex items-center justify-between gap-3 mb-2 px-0.5">
            <div className="text-[11.5px] muted-text">
              {total} ranked · {sort === "excess" ? "excess return vs. index" : "quality within theme"}
            </div>
            <div className="inline-flex items-center gap-1 rounded-lg p-1 border hairline" role="group" aria-label="Sort">
              {([
                { id: "excess", label: "Excess vs. index" },
                { id: "quality", label: "Quality" },
              ] as const).map((opt) => {
                const active = sort === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSort(opt.id)}
                    className="px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors"
                    style={active ? { background: "var(--color-accent-600)", color: "#fff" } : { color: "var(--color-muted)" }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Constituent list */}
          <div className="card divide-y" style={{ borderColor: "var(--color-border)" }}>
            {rows.length === 0 && (
              <div className="muted-text text-[13px] p-4">No constituents in scope.</div>
            )}
            {rows.map(({ c, ret, excess }) => {
              const starred = isStarred(c.symbol);
              const inPortfolio = portfolioSet.has(c.symbol);
              const barW = excess == null ? 0 : (Math.abs(excess) / maxAbsExcess) * 100;
              const barPositive = (excess ?? 0) >= 0;
              return (
                <div key={c.symbol} className="flex items-center gap-3 px-3 py-2.5">
                  {/* Star */}
                  <button
                    type="button"
                    onClick={() => toggle(c.symbol)}
                    className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--color-border)]"
                    aria-label={starred ? `Unstar ${c.symbol}` : `Star ${c.symbol}`}
                    title={starred ? "Remove from Favourites" : "Add to Favourites"}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24"
                      fill={starred ? "var(--color-accent-500, #f59e0b)" : "none"}
                      stroke={starred ? "var(--color-accent-500, #f59e0b)" : "currentColor"}
                      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>

                  {/* Name + symbol */}
                  <div className="min-w-0 w-[150px] sm:w-[190px] shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/stock/${c.symbol}`}
                        className="text-[13px] font-semibold truncate hover:underline"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {c.symbol}
                      </Link>
                      {inPortfolio && (
                        <span
                          className="inline-flex items-center justify-center rounded-full font-bold leading-none shrink-0"
                          style={{ width: 16, height: 16, fontSize: 9.5, color: "#fff", backgroundColor: VIOLET }}
                          title="In your portfolio"
                          aria-label={`${c.symbol} is in your portfolio`}
                        >
                          P
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] muted-text truncate">{c.name ?? ""}</div>
                  </div>

                  {/* Excess-return bar (diverging) */}
                  <div className="flex-1 min-w-0 hidden sm:block">
                    <div className="flex items-center" style={{ height: 16 }}>
                      <div className="w-1/2 flex justify-end pr-1">
                        {!barPositive && (
                          <div style={{ width: `${barW}%`, height: 8, background: RED, borderRadius: 2 }} />
                        )}
                      </div>
                      <div className="w-px self-stretch" style={{ background: "var(--color-border)" }} />
                      <div className="w-1/2 flex justify-start pl-1">
                        {barPositive && (
                          <div style={{ width: `${barW}%`, height: 8, background: GREEN, borderRadius: 2 }} />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Excess + raw return */}
                  <div className="w-[92px] shrink-0 text-right">
                    <div className="text-[13px] tabular-nums font-semibold" style={{ color: pctColor(excess) }}>
                      {signedPct(excess)}
                    </div>
                    <div className="text-[10.5px] tabular-nums muted-text">
                      raw {signedPct(ret)}
                    </div>
                  </div>

                  {/* Q / V / M chips */}
                  <div className="hidden md:flex items-center gap-1 shrink-0">
                    <Chip label="C" value={c.compositePct} />
                    <Chip label="Q" value={c.qualityPct} />
                    <Chip label="V" value={c.valuationPct} />
                    <Chip label="M" value={c.momentumPct} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footnote */}
          <p className="text-[11.5px] muted-text mt-3 leading-[1.55]">
            <strong>Excess return</strong> is each stock&apos;s {win.toUpperCase()} return minus the
            index&apos;s own {win.toUpperCase()} return — a positive bar means the name is beating its
            theme, not just up with the tide. <strong>Breadth</strong> is the share of constituents up
            over the window: a green index on thin breadth is a few names carrying the group. The
            <strong> Quality</strong> sort re-ranks by composite score to surface names beating the
            theme that are also fundamentally sound. This is a map, not a buy list.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, hint }: { label: string; value: string; color: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[10.5px] uppercase tracking-wide muted-text">{label}</div>
      <div className="text-[17px] tabular-nums font-semibold mt-0.5" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
