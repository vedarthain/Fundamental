"use client";

/**
 * /themes single-page-app client.
 *
 * Receives every theme and every constituent as one prop, so picking a theme
 * is a React state change rather than a Neon round-trip — same reasoning as
 * /sectors, and more acute here: ~110 themes means ~110 URLs, none of which
 * would stay warm in an ISR cache.
 *
 * The left rail leads with Themes and demotes Sectors to a second group. That
 * ordering is the point of the page: the ~49 "sector" entries largely restate
 * groupings our own cluster tree already expresses, while the ~61 "theme"
 * entries (Drone, Data Center, Green Hydrogen, Nuclear Power) are the ones we
 * cannot derive from an industry classification at all.
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { band, bandColor, displayCompanyName } from "@/lib/score";

// ── Types ───────────────────────────────────────────────────────────────────

export type ThemeTile = {
  id: number;
  slug: string;
  label: string;
  kind: "theme" | "sector";
  stock_count: number;
};

export type ThemeStock = {
  symbol: string;
  company_name: string | null;
  price: number | null;
  market_cap_cr: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  /** Close-to-close between the two newest daily bars. No intraday overlay on
   *  this page — it renders from a server cache, not a pinger. */
  ret_1d: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
};

export type ThemesData = {
  themes: ThemeTile[];
  stocksByTheme: Record<string, ThemeStock[]>;
  snapshotDate: string | null;
};

type SortKey =
  | "price"
  | "market_cap_cr"
  | "composite_pct"
  | "ret_1d"
  | "ret_1w"
  | "ret_1m"
  | "ret_1y";
type SortDir = "asc" | "desc";

/** Rows shown at once. A theme can carry 200+ constituents; the page's job is
 *  "what's in this theme and what moved", which a 12-row window answers without
 *  a scroll that loses the header. */
const PAGE_SIZE = 12;

// ── Formatting ──────────────────────────────────────────────────────────────

const fmtPct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const fmtNum = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Market cap arrives in ₹ crore. Above 1 lakh crore the raw number stops being
// readable at a glance, so fold to ₹ lakh crore there.
const fmtMcap = (v: number | null) =>
  v == null ? "—" : v >= 100_000 ? `${(v / 100_000).toFixed(2)}L Cr` : `${Math.round(v).toLocaleString("en-IN")} Cr`;

function PagerButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-2.5 py-1 rounded border hairline text-[12px] disabled:opacity-40 disabled:cursor-default hover:bg-[var(--color-paper)] transition-colors"
    >
      {label}
    </button>
  );
}

const deltaColor = (v: number | null) =>
  v == null ? undefined : v > 0 ? "var(--color-delta-up, #087443)" : v < 0 ? "var(--color-delta-down, #b00)" : undefined;

// ── Component ───────────────────────────────────────────────────────────────

export function ThemesClient({
  data,
  initialSlug,
}: {
  data: ThemesData;
  initialSlug: string | null;
}) {
  const { themes, stocksByTheme, snapshotDate } = data;

  const grouped = useMemo(
    () => ({
      theme: themes.filter((t) => t.kind === "theme"),
      sector: themes.filter((t) => t.kind === "sector"),
    }),
    [themes],
  );

  const [activeId, setActiveId] = useState<number | null>(
    () => themes.find((t) => t.slug === initialSlug)?.id ?? grouped.theme[0]?.id ?? themes[0]?.id ?? null,
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "market_cap_cr",
    dir: "desc",
  });
  const [page, setPage] = useState(0);

  const select = useCallback(
    (t: ThemeTile) => {
      setActiveId(t.id);
      // Page is per-theme: landing on "page 4 of Drone" after paging through
      // Defence would look like an empty theme.
      setPage(0);
      // Shareable URL without a server round-trip, matching /sectors.
      window.history.replaceState(null, "", `/themes?theme=${t.slug}`);
    },
    [],
  );

  /** Same key → flip direction. New key → start descending, since every column
   *  here is a "biggest first" question (largest cap, best score, top gainer)
   *  except when you deliberately ask for the other end. */
  const toggleSort = useCallback((key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
    // Re-sorting reshuffles which rows are on which page, so page 3 of the old
    // order means nothing in the new one.
    setPage(0);
  }, []);

  const active = themes.find((t) => t.id === activeId) ?? null;
  const rows = useMemo(() => {
    const list = activeId == null ? [] : (stocksByTheme[activeId] ?? []);
    const mul = sort.dir === "desc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      // Nulls sink in BOTH directions. Letting them float to the top of an
      // ascending sort would answer "worst 1D" with a list of names that have
      // no 1D at all.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return mul * (bv - av);
    });
  }, [activeId, stocksByTheme, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // Clamped rather than stored-clamped: a theme switch can shrink the list
  // before the setPage(0) above is applied in the same render.
  const pageSafe = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => rows.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE),
    [rows, pageSafe],
  );

  // ← / → page the table. Ignored while typing in the theme filter, and when a
  // modifier is held (⌘←/⌥← are browser-back and word-jump — stealing those
  // would break navigation on a page that has a text input).
  useEffect(() => {
    if (pageCount <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setPage((p) => Math.min(pageCount - 1, Math.max(0, Math.min(p, pageCount - 1) + step)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageCount]);

  // Theme-list filter, not a stock filter: with 110 entries the rail is the
  // thing that needs finding, and the constituent tables are short.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return grouped;
    const f = (l: ThemeTile[]) => l.filter((t) => t.label.toLowerCase().includes(q));
    return { theme: f(grouped.theme), sector: f(grouped.sector) };
  }, [grouped, query]);

  return (
    <>
      <header className="mb-5">
        <h1 className="font-display text-[22px] tracking-tight">Themes</h1>
        <p className="muted-text text-[13px] mt-1">
          Stocks grouped by investment theme rather than by industry — a stock can sit in
          several. Prices, returns and scores are ours{snapshotDate ? ` (panel ${snapshotDate})` : ""}; only
          the grouping is imported.
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-5">
        {/* ── Rail ── */}
        <aside className="md:w-[248px] shrink-0">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a theme…"
            className="w-full mb-3 px-3 py-2 text-[13px] rounded-md border hairline bg-transparent"
          />
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {(["theme", "sector"] as const).map((kind) =>
              visible[kind].length === 0 ? null : (
                <div key={kind} className="mb-4">
                  <div className="text-[11px] uppercase tracking-wide muted-text mb-1.5 px-1">
                    {kind === "theme" ? "Themes" : "Sectors"}
                  </div>
                  {visible[kind].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => select(t)}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-[13px] flex items-baseline justify-between gap-2 ${
                        t.id === activeId ? "bg-[var(--color-paper)] font-medium" : "hover:bg-[var(--color-paper)]"
                      }`}
                    >
                      <span className="truncate">{t.label}</span>
                      <span className="muted-text text-[11px] shrink-0">{t.stock_count}</span>
                    </button>
                  ))}
                </div>
              ),
            )}
          </div>
        </aside>

        {/* ── Constituents ── */}
        <section className="flex-1 min-w-0">
          {active == null ? (
            <p className="muted-text text-[13px]">No themes available.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2.5">
                <h2 className="font-display text-[17px] tracking-tight">{active.label}</h2>
                <span className="muted-text text-[12px]">
                  {rows.length === 0
                    ? "0 names"
                    : pageCount === 1
                      ? `${rows.length} names`
                      : `${pageSafe * PAGE_SIZE + 1}–${pageSafe * PAGE_SIZE + pageRows.length} of ${rows.length}`}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide muted-text border-b hairline">
                      <th className="text-left py-2 pr-3 font-medium">Stock</th>
                      {([
                        ["price", "Price"],
                        ["market_cap_cr", "Mkt cap"],
                        ["composite_pct", "Score"],
                        ["ret_1d", "1D"],
                        ["ret_1w", "1W"],
                        ["ret_1m", "1M"],
                        ["ret_1y", "1Y"],
                      ] as const).map(([k, label]) => (
                        <th key={k} className="text-right py-2 px-2 font-medium">
                          <button
                            type="button"
                            onClick={() => toggleSort(k)}
                            title={`Sort by ${label} — click again to reverse`}
                            className={
                              sort.key === k
                                ? "ink-text font-semibold"
                                : "hover:underline"
                            }
                          >
                            {label}
                            {/* Arrow only on the active column: showing a
                                neutral glyph on all seven turns the header into
                                noise and hides which one is live. */}
                            {sort.key === k && (
                              <span aria-hidden className="ml-0.5 text-[9px]">
                                {sort.dir === "desc" ? "▼" : "▲"}
                              </span>
                            )}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((s) => (
                      <tr key={s.symbol} className="border-b hairline last:border-0">
                        <td className="py-2 pr-3">
                          <Link href={`/stock/${s.symbol}`} className="hover:underline">
                            <span className="font-medium">{s.symbol}</span>
                            <span className="muted-text text-[12px] ml-2">
                              {displayCompanyName(s.company_name, s.symbol)}
                            </span>
                          </Link>
                        </td>
                        <td className="text-right py-2 px-2 tabular-nums">{fmtNum(s.price)}</td>
                        <td className="text-right py-2 px-2 tabular-nums muted-text">{fmtMcap(s.market_cap_cr)}</td>
                        <td className="text-right py-2 px-2 tabular-nums">
                          {s.composite_pct == null ? (
                            "—"
                          ) : (
                            <span style={{ color: bandColor(band(s.composite_pct)) }}>
                              {Math.round(s.composite_pct)}
                            </span>
                          )}
                        </td>
                        {(["ret_1d", "ret_1w", "ret_1m", "ret_1y"] as const).map((k) => (
                          <td key={k} className="text-right py-2 px-2 tabular-nums" style={{ color: deltaColor(s[k]) }}>
                            {fmtPct(s[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pageCount > 1 && (
                <div className="flex items-center justify-between gap-3 mt-3">
                  <span className="muted-text text-[11px]">
                    Use ← → to page
                  </span>
                  <div className="flex items-center gap-2">
                    <PagerButton
                      label="‹ Prev"
                      disabled={pageSafe === 0}
                      onClick={() => setPage(pageSafe - 1)}
                    />
                    <span className="text-[12px] tabular-nums muted-text">
                      {pageSafe + 1} / {pageCount}
                    </span>
                    <PagerButton
                      label="Next ›"
                      disabled={pageSafe >= pageCount - 1}
                      onClick={() => setPage(pageSafe + 1)}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
