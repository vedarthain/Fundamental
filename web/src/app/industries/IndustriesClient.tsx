"use client";

/**
 * The sector → industry → detail tree.
 *
 * WHY A TREE AND NOT THE FLAT LIST THIS PAGE SHIPPED WITH
 *
 * The flat A–Z answered "find me Media & Entertainment" in four keystrokes,
 * which was the complaint it was built for. It could not answer "which of
 * BFSI's eleven groups is cheapest" — 46 rows of three numbers each is a wall,
 * and the sector was an attribute you had to read rather than an axis you
 * could collapse. The tree makes the hierarchy navigable while keeping the
 * filter, so both questions work: column one narrows the universe, the filter
 * bypasses it entirely.
 *
 * THE FILTER STILL SPANS EVERYTHING, ON PURPOSE. A tree that forces a sector
 * choice first is /sectors, and rebuilding /sectors here would be pointless.
 * So typing narrows ALL THREE columns at once: sectors with no match disappear,
 * the industry column shows the matches inside the selected sector, and the
 * first match is auto-selected. Matching the sector name too means "BFSI"
 * surfaces all eleven financial groups; matching the id means a URL someone has
 * seen before ("media_entertainment") is a valid query.
 *
 * WHERE IT STOPS. No stock rows. /industry/<id> is the stock-level page and it
 * already exists — duplicating its table here would be two places rendering
 * the same panel cache, which is how two surfaces start disagreeing about a
 * company's tier. Column three ends with a link to it.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

export type IndustryIndexRow = {
  id: string;
  name: string;
  sectorId: string;
  sectorName: string;
  sectorOrder: number;
  stockCount: number;
  marketCapCr: number | null;
  avgQuality: number | null;
  avgValuation: number | null;
  avgMomentum: number | null;
  avgComposite: number | null;
};

export type IndustryStockRow = {
  symbol: string;
  companyName: string | null;
  marketCapCr: number | null;
  currentPrice: number | null;
  qualityPct: number | null;
  valuationPct: number | null;
  momentumPct: number | null;
  compositePct: number | null;
  maturityTier: string | null;
  /** FRACTIONS (0.0255 = +2.55%), from lib/trailingReturns off golden's newest
   *  close — never the panel cache's own ret_* columns, which are anchored to
   *  the weekly snapshot and had the wrong sign on 37% of 1W values. */
  ret1d: number | null;
  ret1w: number | null;
  ret1m: number | null;
  ret1y: number | null;
};

export type SectorNode = {
  id: string;
  name: string;
  order: number;
  industryCount: number;
  stockCount: number;
  marketCapCr: number;
  avgComposite: number | null;
};

/** 20 rows. NBFCs / Lenders is 183 names and the largest group is 395; at that
 *  length the table stops being readable and the reader loses their place
 *  scrolling. Twenty is roughly one screen, so a page is a unit you can
 *  actually compare across. */
const PAGE_SIZE = 20;

/** Percentile → the same four-band colour the rest of the site uses. Null is
 *  not a band: an industry with no composite renders muted, never green. */
function bandColor(pct: number | null): string {
  if (pct == null) return "var(--color-muted)";
  if (pct >= 70) return "var(--color-score-excellent)";
  if (pct >= 50) return "var(--color-score-good, var(--color-delta-up))";
  if (pct >= 30) return "var(--color-score-mid, #d4951a)";
  return "var(--color-score-poor, #b91c1c)";
}

/** Matches /sectors' own formatting so a market cap does not read differently
 *  on two pages: lakh-crore above ₹1,00,000 Cr, plain crore below. */
/** The four return columns sit on a faint wash so the eye reads "scores" and
 *  "price moves" as two blocks rather than ten undifferentiated numbers. A
 *  color-mix off --color-muted rather than a literal grey, so it inverts with
 *  the theme instead of turning into a light stripe on a dark page. 6% is
 *  deliberately below the threshold where it competes with the red/green of
 *  the values sitting on it. */
const RET_WASH = "color-mix(in srgb, var(--color-muted) 6%, transparent)";

/** A return arrives as a fraction and renders as a signed percentage. Null is
 *  "—", never 0.0% — a name with no anchor bar did not go nowhere, we just
 *  cannot say. The sign is always printed so +0.0 and −0.0 stay legible. */
function fmtRet(f: number | null): string {
  if (f == null) return "—";
  const pct = f * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function retColor(f: number | null): string {
  if (f == null) return "var(--color-muted)";
  if (f > 0) return "var(--color-delta-up)";
  if (f < 0) return "var(--color-delta-down)";
  return "var(--color-muted)";
}

function fmtMcap(cr: number | null): string {
  if (cr == null || cr === 0) return "—";
  return cr >= 1_00_000
    ? `₹${(cr / 1_00_000).toFixed(1)}L Cr`
    : `₹${Math.round(cr).toLocaleString("en-IN")} Cr`;
}

/** The per-stock table's sortable columns. `symbol` is the tiebreaker in every
 *  ordering, so two names with the same score never swap places between
 *  renders. */
type StockSortKey =
  | "symbol"
  | "compositePct"
  | "qualityPct"
  | "valuationPct"
  | "momentumPct"
  | "marketCapCr"
  | "ret1d"
  | "ret1w"
  | "ret1m"
  | "ret1y";

function byStock(key: StockSortKey, dir: 1 | -1) {
  return (a: IndustryStockRow, b: IndustryStockRow): number => {
    // The symbol column is a string sort, so dir multiplies localeCompare
    // rather than a subtraction. Kept as its own branch because coercing a
    // symbol through the numeric path below would silently return 0 for every
    // pair and leave the table in whatever order the query happened to give.
    if (key === "symbol") return dir * -1 * a.symbol.localeCompare(b.symbol);
    const av = a[key];
    const bv = b[key];
    // Nulls sink in BOTH directions rather than being coerced to 0. Migration
    // 0087's rule: render an absent score as absent, never as zero — a stock
    // with no valuation percentile is not the cheapest name in the group.
    if (av == null && bv == null) return a.symbol.localeCompare(b.symbol);
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir * (av - bv) || a.symbol.localeCompare(b.symbol);
  };
}

export function IndustriesClient({
  rows,
  sectors,
  stocksByIndustry,
  breadcrumb,
}: {
  rows: IndustryIndexRow[];
  sectors: SectorNode[];
  stocksByIndustry: Record<string, IndustryStockRow[]>;
  /** Rendered inside the filter row, not above it — see page.tsx. A node
   *  rather than a string because it contains a <Link>, and this file is a
   *  client component that should not be deciding the page's URL structure. */
  breadcrumb?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  // Empty, not sectors[0].id: `sectors` arrives in the ETL's display order
  // while the column renders A–Z, so seeding from it opened on Financials
  // while the first row on screen was Consumer. Falling through to
  // visibleSectors[0] keeps "selected" and "first in the list" the same thing.
  const [sectorId, setSectorId] = useState<string>("");
  const [industryId, setIndustryId] = useState<string>("");
  const [stockSort, setStockSort] = useState<{ key: StockSortKey; dir: 1 | -1 }>({
    key: "compositePct",
    dir: -1,
  });
  const [page, setPage] = useState(0);
  // A SECOND search box, scoped to the open peer group. The one at the top of
  // the page filters industries and deliberately does not read company names
  // (that is what the header's global search is for); inside a 395-row table
  // the question changes to "is BOSCHLTD in here, and where does it rank",
  // which neither of the other two answers.
  const [stockQ, setStockQ] = useState("");

  const needle = q.trim().toLowerCase();
  const matches = useMemo(
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

  // Only sectors that still hold a match are offered. A sector tab that opens
  // an empty second column is a dead end the reader has to back out of.
  //
  // A–Z, NOT mc.display_order. /sectors uses display order because it is a
  // browse — the order encodes which sectors we think matter most. This page
  // is a lookup, and in a lookup the only order a reader can predict is the
  // alphabet: scanning nine tabs for "Materials" should not require knowing
  // we rank it sixth. The industry column and the sector column therefore
  // sort the same way, which is the point of a tree.
  const visibleSectors = useMemo(() => {
    const live = new Set(matches.map((r) => r.sectorId));
    return sectors.filter((s) => live.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [sectors, matches]);

  // Selection is derived, not stored, whenever the stored value has been
  // filtered away — so typing never leaves the right-hand columns showing a
  // row that no longer matches. useState holds the INTENT; these two consts
  // hold what is actually renderable.
  const activeSector =
    visibleSectors.find((s) => s.id === sectorId) ?? visibleSectors[0] ?? null;

  const industries = useMemo(
    () =>
      matches
        .filter((r) => r.sectorId === activeSector?.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [matches, activeSector],
  );

  const activeIndustry =
    industries.find((r) => r.id === industryId) ?? industries[0] ?? null;

  const stockNeedle = stockQ.trim().toLowerCase();
  const stocks = useMemo(() => {
    const list = activeIndustry ? stocksByIndustry[activeIndustry.id] ?? [] : [];
    const kept =
      stockNeedle === ""
        ? list
        : list.filter(
            (s) =>
              s.symbol.toLowerCase().includes(stockNeedle) ||
              (s.companyName ?? "").toLowerCase().includes(stockNeedle),
          );
    return kept.slice().sort(byStock(stockSort.key, stockSort.dir));
  }, [activeIndustry, stocksByIndustry, stockSort, stockNeedle]);

  // Paging happens AFTER the sort, never before — the sort is over the whole
  // peer group, so page 1 of "Score ↓" is the top 20 of 395 rather than the
  // top 20 of whichever 20 the page happened to hold. Getting that backwards
  // is the classic paginated-table bug and it reads as plausible data.
  const pageCount = Math.max(1, Math.ceil(stocks.length / PAGE_SIZE));
  // Clamped rather than reset: changing industry or sort can leave `page`
  // past the end (page 9 of NBFCs, then a 4-stock group), and a table that
  // renders empty because of stale state looks like missing data.
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = stocks.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // First click on a column sorts high-to-low (the direction a reader wants
  // from a score), second flips it. There is no third state: unlike the
  // verdict queue there is no "urgency" ordering to fall back to here.
  // Re-sorting returns to page 1, because the reason you re-sorted is to see
  // the new top of the list.
  const onStockSort = (key: StockSortKey) => {
    setPage(0);
    setStockSort((s) => (s.key === key ? { key, dir: s.dir === -1 ? 1 : -1 } : { key, dir: -1 }));
  };
  const arrow = (key: StockSortKey) =>
    stockSort.key !== key ? "" : stockSort.dir === -1 ? " ↓" : " ↑";

  // ← and → page the table. Scoped to window rather than the table because
  // the reader's hands are on the keyboard precisely when they are NOT
  // clicking into it — but it bails the moment focus is in a field, or a
  // modifier is held, so typing "ANDHRA" into either search box and pressing
  // → to move the caret cannot also skip a page. The bail list is by tag
  // rather than by id so a future input on this page inherits it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (el as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      if (pageCount <= 1) return;
      e.preventDefault();
      setPage((p) => {
        const cur = Math.min(p, pageCount - 1);
        return e.key === "ArrowRight"
          ? Math.min(cur + 1, pageCount - 1)
          : Math.max(cur - 1, 0);
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageCount]);

  // One definition, rendered at the top of the table AND the bottom. The top
  // copy is the one that matters: with 20 rows on screen the bottom pager is
  // below the fold on a short viewport, so "which page am I on" was only
  // answerable by scrolling to the control you just used.
  const Pager = () =>
    pageCount <= 1 ? null : (
      <div className="flex items-center gap-2 text-[12px] shrink-0">
        <button
          type="button"
          onClick={() => setPage(safePage - 1)}
          disabled={safePage === 0}
          aria-label="Previous page"
          className="px-2 py-0.5 rounded-md border hairline disabled:opacity-40"
          style={{ color: "var(--color-muted)" }}
        >
          ←
        </button>
        <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>
          Page {safePage + 1} / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => setPage(safePage + 1)}
          disabled={safePage >= pageCount - 1}
          aria-label="Next page"
          className="px-2 py-0.5 rounded-md border hairline disabled:opacity-40"
          style={{ color: "var(--color-muted)" }}
        >
          →
        </button>
        <span className="muted-text tabular-nums">
          {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, stocks.length)} of{" "}
          {stocks.length}
        </span>
      </div>
    );

  const Th = ({
    label,
    k,
    align = "right",
    wash = false,
  }: {
    label: string;
    k: StockSortKey;
    align?: "left" | "right";
    wash?: boolean;
  }) => (
    // Sticky lives on the TH, not the THEAD. `position: sticky` on a
    // <thead> is ignored by WebKit and by Chrome's table layout — the header
    // scrolled away with the rows, which is the bug this fixes. Each cell
    // sticks individually and carries its own OPAQUE background, because a
    // transparent sticky header lets 20 stock rows scroll visibly through the
    // column labels. The wash is layered over the card colour rather than
    // replacing it for the same reason.
    <th
      className={`sticky top-[84px] z-20 px-2 py-1.5 font-normal border-b hairline ${
        align === "left" ? "text-left" : "text-right"
      }`}
      style={{
        background: wash
          ? `linear-gradient(${RET_WASH}, ${RET_WASH}), var(--color-card)`
          : "var(--color-card)",
      }}
    >
      <button
        type="button"
        onClick={() => onStockSort(k)}
        className="hover:underline"
        style={{ color: stockSort.key === k ? "var(--color-accent-700)" : "inherit" }}
      >
        {label}
        {arrow(k)}
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {breadcrumb}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter — industry, sector, or id"
          aria-label="Filter industries"
          className="px-3 py-1.5 text-[13px] rounded-md border hairline w-[280px]"
          style={{ background: "var(--color-card)", color: "var(--color-ink)" }}
        />
        {/* This is the page's only header now — the h1 and standfirst were
            removed to get the table above the fold — so it carries the sector
            count the blurb used to state. It counts what is VISIBLE, not the
            universe, so it doubles as feedback while typing. */}
        <span className="text-[12px] muted-text tabular-nums">
          {matches.length} of {rows.length} industries · {visibleSectors.length} of{" "}
          {sectors.length} sectors
        </span>
        {needle !== "" && matches.length === 0 && (
          <span className="text-[12px] muted-text">
            Nothing matches &ldquo;{q}&rdquo; — the filter reads industry, sector and id, not
            company names. For a company, use the header search.
          </span>
        )}
      </div>

      {/* The two navigation columns are deliberately narrow — 180/210px — and
          the detail pane takes everything left over. They hold a name and two
          small numbers; giving them 560px between them spent the stock table's
          six columns on whitespace, which is what the first cut did.

          THE PAGE SCROLLS NORMALLY. An earlier cut pinned all three panes
          inside one 100vh box with their own scrollbars; that traps the wheel
          — the heading never leaves, the page itself cannot move, and
          overscrolling a pane bounces. Instead the two nav columns are
          `sticky` and the detail pane is an ordinary block: scroll down and the
          breadcrumb, heading and blurb leave as they should, then the sector
          and industry columns park under the site header while the stock table
          keeps going.

          84px is where the site header's sticky bottom edge sits — a 28px
          snapshot ribbon (top-7) plus a 56px header row (h-14) from
          app/layout.tsx. Both offsets below derive from it, so if that header
          changes height these two numbers are what need changing. */}
      <div className="mt-5 grid gap-3 lg:grid-cols-[180px_210px_minmax(0,1fr)] lg:items-start">
        {/* ── Column 1: sectors ─────────────────────────────────────────── */}
        <nav
          aria-label="Sectors"
          className="flex flex-col gap-1 lg:sticky lg:top-[92px] lg:max-h-[calc(100vh-104px)] lg:overflow-y-auto pr-0.5"
        >
          <div className="text-[10.5px] uppercase tracking-wide muted-text px-1 pb-1">
            Sector
          </div>
          {visibleSectors.map((s) => {
            const on = s.id === activeSector?.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={on}
                onClick={() => {
                  setSectorId(s.id);
                  setIndustryId("");
                  setPage(0);
                }}
                className="text-left px-3 py-2 rounded-md border transition-colors"
                style={
                  on
                    ? {
                        borderColor: "var(--color-accent-300)",
                        background: "var(--color-accent-50)",
                      }
                    : {
                        borderColor: "var(--color-border-default)",
                        background: "var(--color-card)",
                      }
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-[13px] font-medium truncate"
                    style={{ color: on ? "var(--color-accent-700)" : "var(--color-ink)" }}
                  >
                    {s.name}
                  </span>
                  <span
                    className="text-[12px] tabular-nums font-medium shrink-0"
                    style={{ color: bandColor(s.avgComposite) }}
                  >
                    {s.avgComposite == null ? "—" : Math.round(s.avgComposite)}
                  </span>
                </div>
                <div className="text-[11px] muted-text tabular-nums">
                  {s.industryCount} {s.industryCount === 1 ? "industry" : "industries"} ·{" "}
                  {s.stockCount} stocks
                </div>
              </button>
            );
          })}
        </nav>

        {/* ── Column 2: industries in the chosen sector ─────────────────── */}
        <nav
          aria-label="Industries"
          className="flex flex-col gap-1 lg:sticky lg:top-[92px] lg:max-h-[calc(100vh-104px)] lg:overflow-y-auto pr-0.5"
        >
          <div className="text-[10.5px] uppercase tracking-wide muted-text px-1 pb-1">
            Industry
          </div>
          {industries.map((r) => {
            const on = r.id === activeIndustry?.id;
            return (
              <button
                key={r.id}
                type="button"
                aria-current={on}
                onClick={() => {
                  setIndustryId(r.id);
                  setPage(0);
                }}
                className="text-left px-3 py-2 rounded-md border transition-colors"
                style={
                  on
                    ? {
                        borderColor: "var(--color-accent-300)",
                        background: "var(--color-accent-50)",
                      }
                    : {
                        borderColor: "var(--color-border-default)",
                        background: "var(--color-card)",
                      }
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-[13px] truncate"
                    style={{ color: on ? "var(--color-accent-700)" : "var(--color-ink)" }}
                  >
                    {r.name}
                  </span>
                  <span
                    className="text-[12px] tabular-nums font-medium shrink-0"
                    style={{ color: bandColor(r.avgComposite) }}
                  >
                    {r.avgComposite == null ? "—" : Math.round(r.avgComposite)}
                  </span>
                </div>
                <div className="text-[11px] muted-text tabular-nums">
                  {r.stockCount} stocks · {fmtMcap(r.marketCapCr)}
                </div>
              </button>
            );
          })}
        </nav>

        {/* ── Column 3: the chosen industry's own numbers ───────────────── */}
        <section
          className="rounded-md border hairline p-4"
          style={{ background: "var(--color-card)" }}
        >
          {activeIndustry == null ? (
            <p className="text-[13px] muted-text">
              Pick an industry to see its aggregates.
            </p>
          ) : (
            <>
              {/* ONE LINE. The four score cards plus a heading, a sub-line and
                  a paragraph of caveat ran ~240px before the first stock row —
                  on a 900px viewport that is a third of the screen spent
                  restating four numbers the table repeats per row. The caveat
                  survives as the title= on the scores, which is where a reader
                  looks only when a number surprises them. */}
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="text-[11px] uppercase tracking-wide muted-text">
                  {activeIndustry.sectorName}
                </span>
                <h2 className="font-display text-[19px] tracking-tight leading-none">
                  {activeIndustry.name}
                </h2>
                <span className="text-[11.5px] muted-text tabular-nums">
                  {activeIndustry.stockCount} stocks · {fmtMcap(activeIndustry.marketCapCr)}
                </span>
                <span
                  className="flex items-baseline gap-2 text-[11.5px] tabular-nums"
                  title="Percentile aggregates for the whole peer group, 0–100, from the latest weekly snapshot — not averages of raw ratios. A high Valuation score means the group screens cheap relative to the market, not expensive."
                >
                  {(
                    [
                      ["Q", activeIndustry.avgQuality],
                      ["V", activeIndustry.avgValuation],
                      ["M", activeIndustry.avgMomentum],
                      ["Score", activeIndustry.avgComposite],
                    ] as [string, number | null][]
                  ).map(([label, v]) => (
                    <span key={label}>
                      <span className="muted-text">{label} </span>
                      <span style={{ color: bandColor(v), fontWeight: 600 }}>
                        {v == null ? "—" : Math.round(v)}
                      </span>
                    </span>
                  ))}
                </span>
              </div>

              {/* EVERY stock in the group, not a top-N. A peer group's tail is
                  the part a reader cannot get anywhere else — a leaderboard of
                  ten tells you who is winning, which /ideas already does. The
                  rows are already in memory (loaded with the tree), so the
                  cost of showing all 183 NBFCs is scroll, not a request. */}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <input
                  type="search"
                  value={stockQ}
                  onChange={(e) => {
                    setStockQ(e.target.value);
                    setPage(0);
                  }}
                  placeholder={`Find in ${activeIndustry.name} — symbol or company`}
                  aria-label="Find a stock in this industry"
                  className="px-2.5 py-1 text-[12.5px] rounded-md border hairline w-[260px]"
                  style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}
                />
                <Pager />
                <span className="flex items-baseline gap-3 text-[12px] ml-auto">
                  <Link
                    href={`/industry/${activeIndustry.id}`}
                    className="hover:underline"
                    style={{ color: "var(--color-accent-700)" }}
                  >
                    Full peer-group page →
                  </Link>
                  <Link
                    href={`/sectors?sector=${activeIndustry.sectorId}&industry=${activeIndustry.id}`}
                    className="hover:underline muted-text"
                  >
                    In Sectors
                  </Link>
                </span>
              </div>

              {stocks.length === 0 ? (
                // Two different emptinesses, and conflating them would report
                // a data bug every time a search missed. The filter is the
                // likely cause; the missing-panel case is the one worth
                // naming a table for.
                stockNeedle !== "" ? (
                  <p className="mt-2 text-[12.5px] muted-text">
                    No stock in {activeIndustry.name} matches &ldquo;{stockQ}&rdquo;. It may sit
                    in another peer group — the header search covers the whole universe.
                  </p>
                ) : (
                  <p className="mt-2 text-[12.5px] muted-text">
                    The aggregate says {activeIndustry.stockCount} stocks but the per-stock
                    panel has none for this snapshot. That is a half-finished weekly compute,
                    not an empty group — check <code>app.cluster_stocks_panel_cache</code>.
                  </p>
                )
              ) : (
                // No max-height on this div: the pane itself is the scroll
                // container now, so a second one would nest two scrollbars and
                // strand the sticky header halfway down the screen.
                <div className="mt-2 rounded-md border hairline">
                  <table className="w-full text-[12.5px] border-collapse">
                    <thead className="text-[11px] uppercase tracking-wide muted-text">
                      <tr>
                        <Th label="Stock" k="symbol" align="left" />
                        <Th label="M-cap" k="marketCapCr" />
                        <Th label="Qual" k="qualityPct" />
                        <Th label="Val" k="valuationPct" />
                        <Th label="Mom" k="momentumPct" />
                        <Th label="Score" k="compositePct" />
                        <Th label="1D" k="ret1d" wash />
                        <Th label="1W" k="ret1w" wash />
                        <Th label="1M" k="ret1m" wash />
                        <Th label="1Y" k="ret1y" wash />
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((s) => (
                        <tr key={s.symbol} className="border-b hairline">
                          <td className="px-2 py-1.5">
                            {/* New tab, deliberately. Everything else on this
                                page is a same-tab move because it changes what
                                the three columns show; a stock page leaves the
                                tree entirely, and the reader walking a 40-name
                                peer group is comparing names — sending them
                                back and forth loses the sector, the industry,
                                the sort and the page they were on. rel is
                                noopener for the usual reason: target=_blank
                                without it hands window.opener to the new
                                document. */}
                            <Link
                              href={`/stock/${s.symbol}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                              style={{ color: "var(--color-ink)" }}
                            >
                              <span className="font-medium">{s.symbol}</span>
                              {s.companyName && (
                                <span className="muted-text"> · {s.companyName}</span>
                              )}
                            </Link>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums muted-text whitespace-nowrap">
                            {fmtMcap(s.marketCapCr)}
                          </td>
                          {(
                            [
                              s.qualityPct,
                              s.valuationPct,
                              s.momentumPct,
                              s.compositePct,
                            ] as (number | null)[]
                          ).map((v, i) => (
                            <td
                              key={i}
                              className="px-2 py-1.5 text-right tabular-nums"
                              style={{ color: bandColor(v), fontWeight: i === 3 ? 600 : 400 }}
                            >
                              {v == null ? "—" : Math.round(v)}
                            </td>
                          ))}
                          {([s.ret1d, s.ret1w, s.ret1m, s.ret1y] as (number | null)[]).map(
                            (v, i) => (
                              <td
                                key={`r${i}`}
                                className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
                                style={{ color: retColor(v), background: RET_WASH }}
                              >
                                {fmtRet(v)}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Second copy, below the rows — the pager states the RANGE and
                  not just the page number, because "21–40 of 395" tells a
                  reader where they are in the group and a bare "Page 2" does
                  not. Both copies render only above one page: a 4-stock
                  industry showing disabled arrows is chrome answering a
                  question nobody asked. */}
              {pageCount > 1 && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <Pager />
                  <span className="text-[11px] muted-text">← → page through</span>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
