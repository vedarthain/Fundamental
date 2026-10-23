"use client";

/**
 * The filterable A–Z of every scored industry.
 *
 * WHY THIS EXISTS AS ITS OWN PAGE
 *
 * /sectors is a browse, not a lookup. It opens on one sector and the industry
 * list is a sidebar scoped to whichever sector tab is active, so finding
 * "Media & Entertainment" without already knowing it sits under Consumer &
 * Media means opening each sector tab in turn and reading its sidebar. That is
 * nine clicks to answer a question the reader could have typed in four
 * keystrokes, and it is the only way the site currently answers it.
 *
 * So this page inverts the hierarchy: every industry at once, filtered by a
 * box, with the sector shown as an attribute of the row rather than as the
 * thing you must choose first. It deliberately does NOT duplicate /sectors —
 * there are no stock rows here and no tier filter. It is an index, and the row
 * links straight to /industry/<id>, which is where the depth already lives.
 *
 * THE SEARCH MATCHES THE SECTOR TOO, ON PURPOSE. Typing "bank" should surface
 * Private Banks and PSU Banks, but typing "BFSI" should surface all eleven
 * financial industries — a reader who knows the sector but not our name for
 * the industry is the exact reader this page is for. Matching the id as well
 * means a URL someone has seen before ("media_entertainment") is also a valid
 * query.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

export type IndustryIndexRow = {
  id: string;
  name: string;
  sectorId: string;
  sectorName: string;
  sectorOrder: number;
  stockCount: number;
  avgComposite: number | null;
};

/** Percentile → the same four-band colour the rest of the site uses. Null is
 *  not a band: an industry with no composite renders muted, never green. */
function bandColor(pct: number | null): string {
  if (pct == null) return "var(--color-muted)";
  if (pct >= 70) return "var(--color-score-excellent)";
  if (pct >= 50) return "var(--color-score-good, var(--color-delta-up))";
  if (pct >= 30) return "var(--color-score-mid, #d4951a)";
  return "var(--color-score-poor, #b91c1c)";
}

export function IndustriesClient({ rows }: { rows: IndustryIndexRow[] }) {
  const [q, setQ] = useState("");
  const [groupBySector, setGroupBySector] = useState(true);

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      needle === ""
        ? rows
        : rows.filter(
            (r) =>
              r.name.toLowerCase().includes(needle) ||
              r.sectorName.toLowerCase().includes(needle) ||
              r.id.toLowerCase().includes(needle),
          ),
    [rows, needle],
  );

  // Grouped keeps the sector's own display order (the one /sectors uses, so
  // the two pages cannot disagree about where an industry belongs). Flat is
  // strict A–Z, which is the order someone scanning for a half-remembered name
  // actually wants.
  const groups = useMemo(() => {
    if (!groupBySector) {
      return [
        {
          sectorId: "",
          sectorName: "",
          rows: [...filtered].sort((a, b) => a.name.localeCompare(b.name)),
        },
      ];
    }
    const m = new Map<string, { sectorId: string; sectorName: string; order: number; rows: IndustryIndexRow[] }>();
    for (const r of filtered) {
      const g = m.get(r.sectorId) ?? {
        sectorId: r.sectorId,
        sectorName: r.sectorName,
        order: r.sectorOrder,
        rows: [],
      };
      g.rows.push(r);
      m.set(r.sectorId, g);
    }
    return [...m.values()]
      .sort((a, b) => a.order - b.order || a.sectorName.localeCompare(b.sectorName))
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [filtered, groupBySector]);

  const totalStocks = filtered.reduce((n, r) => n + r.stockCount, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter — industry, sector, or id"
          aria-label="Filter industries"
          className="px-3 py-1.5 text-[13px] rounded-md border hairline w-[280px]"
          style={{ background: "var(--color-card)", color: "var(--color-ink)" }}
        />
        <button
          type="button"
          onClick={() => setGroupBySector((v) => !v)}
          className="px-2.5 py-1 text-[12px] rounded-md border hairline"
          style={{ color: "var(--color-muted)" }}
          title="Grouped keeps our sector order; A–Z ignores sectors entirely, which is faster when you half-remember the name."
        >
          {groupBySector ? "Grouped by sector" : "A–Z"}
        </button>
        <span className="text-[12px] muted-text tabular-nums">
          {filtered.length} industries · {totalStocks.toLocaleString("en-IN")} stocks
        </span>
      </div>

      {filtered.length === 0 && (
        <p className="mt-6 text-[13px] muted-text">
          Nothing matches &ldquo;{q}&rdquo;. The filter reads industry name, sector name and id —
          not company names. For a company, use the search box in the header.
        </p>
      )}

      <div className="mt-6 space-y-7">
        {groups.map((g) => (
          <section key={g.sectorId || "all"}>
            {groupBySector && (
              <div className="flex items-baseline gap-2 mb-2">
                <h2 className="font-display text-[16px]" style={{ color: "var(--color-ink)" }}>
                  {g.sectorName}
                </h2>
                <span className="text-[11px] muted-text tabular-nums">
                  {g.rows.length} {g.rows.length === 1 ? "industry" : "industries"}
                </span>
              </div>
            )}
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {g.rows.map((r) => (
                <Link
                  key={r.id}
                  href={`/industry/${r.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border hairline hover:opacity-80 transition-opacity"
                  style={{ background: "var(--color-card)" }}
                >
                  <span className="min-w-0">
                    <span
                      className="block text-[13px] font-medium truncate"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {r.name}
                    </span>
                    {!groupBySector && (
                      <span className="block text-[11px] muted-text truncate">{r.sectorName}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 shrink-0 tabular-nums text-[12px]">
                    <span className="muted-text">{r.stockCount}</span>
                    <span
                      className="font-medium"
                      style={{ color: bandColor(r.avgComposite) }}
                      title="Aggregate composite percentile for the industry, from the latest weekly snapshot."
                    >
                      {r.avgComposite == null ? "—" : Math.round(r.avgComposite)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
