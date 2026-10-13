/**
 * Shared chrome for the /dashboard widgets.
 *
 * Every widget is a FIXED-HEIGHT box whose body scrolls. That is the whole
 * layout contract: a widget must never grow to fit its data, because the point
 * of this page is that the whole picture fits one screen. If you need to show
 * more rows, raise the row cap and let the box scroll — do not remove the
 * height, or the grid goes ragged and the page starts stretching again.
 *
 * The fixed height is also what lets the streaming shell work: `ZoneSkeleton`
 * occupies exactly the same box as the resolved widget, so zones filling in
 * cause no layout shift.
 */
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Uniform widget body height. One grid row = BODY_H + the header strip.
 *
 * 240 is derived, not chosen: the tallest row in any widget is a signal row
 * (11.5px symbol + 10px note + 6px padding ≈ 34px), and the floor is "seven
 * names visible without scrolling" — 7 × 34 = 238. The book's rows are single
 * line, so it clears seven easily even after the KPI strip. If you shrink this,
 * the signal tiles fall to six rows.
 */
export const BODY_H = 240;

export function Zone({
  title,
  href,
  count,
  meta,
  children,
}: {
  title: string;
  href?: string;
  count?: number;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-md border hairline px-2 pt-1.5 pb-2 flex flex-col"
      style={{ backgroundColor: "var(--color-card)" }}
    >
      <div className="flex items-baseline gap-1.5 mb-1 shrink-0">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide">
          {title}
          {count != null && (
            <span className="muted-text font-normal tabular-nums normal-case"> {count}</span>
          )}
        </h2>
        {meta && (
          <span className="muted-text text-[10px] tabular-nums truncate">{meta}</span>
        )}
        {href && (
          <Link
            href={href}
            className="ml-auto shrink-0 text-[10px]"
            style={{ color: "var(--color-accent-700)" }}
          >
            Open
          </Link>
        )}
      </div>
      {/*
        `overscroll-auto`, NOT `overscroll-contain`. Contain stops scroll
        CHAINING: once the tile hits its own top or bottom, further wheel/touch
        movement is swallowed instead of passing to the page, so a reader with a
        finger inside a tile cannot scroll the dashboard at all and has to move
        off the box first. On a page made almost entirely of scrollable tiles
        that is a trap, which is exactly how it was reported. Chaining is the
        behaviour we want here: the tile scrolls, and when it is done the page
        takes over.
      */}
      <div className="overflow-y-auto overscroll-auto" style={{ height: BODY_H }}>
        {children}
      </div>
    </section>
  );
}

/** Same box, placeholder body — identical height, so nothing shifts on fill. */
export function ZoneSkeleton({ title, rows = 8 }: { title: string; rows?: number }) {
  return (
    <Zone title={title}>
      <div className="animate-pulse space-y-1.5" aria-hidden>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-4 rounded"
            style={{ backgroundColor: "var(--color-border-default)", opacity: 0.45 }}
          />
        ))}
      </div>
      <span className="sr-only">Loading {title}</span>
    </Zone>
  );
}

/** Borderless inline stat — the widget already supplies the box. */
export function Kpi({
  label,
  value,
  sub,
  up,
}: {
  label: string;
  value: string;
  sub?: string;
  up?: boolean;
}) {
  const color =
    up == null ? undefined : up ? "var(--color-delta-up)" : "var(--color-delta-down)";
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] muted-text uppercase tracking-wide truncate">{label}</div>
      <div
        className="font-mono text-[12.5px] font-semibold tabular-nums truncate leading-tight"
        style={{ color }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[9.5px] tabular-nums leading-tight" style={{ color }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * `table-fixed` with only the first column unsized: on a phone the name column
 * must be the only thing that flexes, or a long company name pushes the numbers
 * off-screen. Numeric columns get a fixed percentage so every zone's tables
 * line up with each other.
 */
export function MiniTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  const numericWidth = `${Math.floor(62 / Math.max(1, headers.length - 1))}%`;
  return (
    <table className="w-full text-[11.5px] table-fixed">
      <colgroup>
        {headers.map((h, i) => (
          <col key={h} style={i === 0 ? undefined : { width: numericWidth }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={h}
              className={
                i === 0
                  ? "pb-0.5 font-normal muted-text text-[9.5px] uppercase tracking-wide text-left"
                  : "pb-0.5 font-normal muted-text text-[9.5px] uppercase tracking-wide text-right"
              }
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="border-t hairline">
            {row.map((cell, ci) => (
              <td
                key={ci}
                className={
                  ci === 0
                    ? "py-[3px] tabular-nums text-left truncate"
                    : "py-[3px] tabular-nums text-right truncate"
                }
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SymbolLink({ symbol, label }: { symbol: string | null; label?: string }) {
  const text = label ?? symbol ?? "—";
  if (!symbol) return <span className="truncate">{text}</span>;
  return (
    <Link
      href={`/stock/${encodeURIComponent(symbol)}`}
      className="font-mono font-medium truncate"
    >
      {text}
    </Link>
  );
}

export function Delta({ v, digits = 1 }: { v: number | null; digits?: number }) {
  if (v == null) return <span className="muted-text">—</span>;
  const up = v >= 0;
  return (
    <span style={{ color: up ? "var(--color-delta-up)" : "var(--color-delta-down)" }}>
      {pct(v, digits)}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted-text text-[11px] py-1">{children}</p>;
}

// ── formatters ──────────────────────────────────────────────────────────────

export function inr(v: number): string {
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function signed(v: number): string {
  const body = Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return (v >= 0 ? "+₹" : "-₹") + body;
}

export function pct(v: number, digits = 1): string {
  return (v >= 0 ? "+" : "") + v.toFixed(digits) + "%";
}

export function cr(v: number): string {
  const abs = Math.abs(Math.round(v)).toLocaleString("en-IN");
  return (v >= 0 ? "+" : "-") + "₹" + abs + " Cr";
}

export function num(v: number | null, digits = 0): string {
  return v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
