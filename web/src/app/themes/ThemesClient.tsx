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
import { useState, useMemo, useCallback } from "react";
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
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
};

export type ThemesData = {
  themes: ThemeTile[];
  stocksByTheme: Record<string, ThemeStock[]>;
  snapshotDate: string | null;
};

type SortKey = "market_cap_cr" | "composite_pct" | "ret_1w" | "ret_1m" | "ret_1y";

// ── Formatting ──────────────────────────────────────────────────────────────

const fmtPct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const fmtNum = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Market cap arrives in ₹ crore. Above 1 lakh crore the raw number stops being
// readable at a glance, so fold to ₹ lakh crore there.
const fmtMcap = (v: number | null) =>
  v == null ? "—" : v >= 100_000 ? `${(v / 100_000).toFixed(2)}L Cr` : `${Math.round(v).toLocaleString("en-IN")} Cr`;

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
  const [sortKey, setSortKey] = useState<SortKey>("market_cap_cr");

  const select = useCallback(
    (t: ThemeTile) => {
      setActiveId(t.id);
      // Shareable URL without a server round-trip, matching /sectors.
      window.history.replaceState(null, "", `/themes?theme=${t.slug}`);
    },
    [],
  );

  const active = themes.find((t) => t.id === activeId) ?? null;
  const rows = useMemo(() => {
    const list = activeId == null ? [] : (stocksByTheme[activeId] ?? []);
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
    return sorted;
  }, [activeId, stocksByTheme, sortKey]);

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
                <span className="muted-text text-[12px]">{rows.length} names</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide muted-text border-b hairline">
                      <th className="text-left py-2 pr-3 font-medium">Stock</th>
                      <th className="text-right py-2 px-2 font-medium">Price</th>
                      {([
                        ["market_cap_cr", "Mkt cap"],
                        ["composite_pct", "Score"],
                        ["ret_1w", "1W"],
                        ["ret_1m", "1M"],
                        ["ret_1y", "1Y"],
                      ] as const).map(([k, label]) => (
                        <th key={k} className="text-right py-2 px-2 font-medium">
                          <button
                            type="button"
                            onClick={() => setSortKey(k)}
                            className={sortKey === k ? "ink-text font-semibold" : "hover:underline"}
                          >
                            {label}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
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
                        {(["ret_1w", "ret_1m", "ret_1y"] as const).map((k) => (
                          <td key={k} className="text-right py-2 px-2 tabular-nums" style={{ color: deltaColor(s[k]) }}>
                            {fmtPct(s[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
