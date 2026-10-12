/**
 * Shared chrome for the /dashboard zones.
 *
 * Every zone renders inside the same <Zone> frame so the streaming shell can
 * paint the frames (and their skeletons) before any loader resolves — the
 * frame's height must therefore not depend on the data. `ZoneSkeleton` mirrors
 * the frame exactly for that reason.
 */
import Link from "next/link";
import type { ReactNode } from "react";

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
      className="rounded-md border hairline p-3"
      style={{ backgroundColor: "var(--color-card)" }}
    >
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-[13px] font-semibold">
          {title}
          {count != null && (
            <span className="muted-text font-normal tabular-nums"> {count}</span>
          )}
        </h2>
        {meta && <span className="muted-text text-[11px] tabular-nums truncate">{meta}</span>}
        {href && (
          <Link
            href={href}
            className="ml-auto shrink-0 text-[11px]"
            style={{ color: "var(--color-accent-700)" }}
          >
            Open
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Same frame, placeholder body. Rows ≈ the zone's typical row count. */
export function ZoneSkeleton({ title, rows = 3 }: { title: string; rows?: number }) {
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
    <div
      className="rounded-md border hairline px-3 py-2"
      style={{ backgroundColor: "var(--color-card)" }}
    >
      <div className="text-[11px] muted-text">{label}</div>
      <div className="font-mono text-[16px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] tabular-nums" style={{ color }}>
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
    <table className="w-full text-[12.5px] table-fixed">
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
                  ? "pb-1 font-normal muted-text text-[11px] text-left"
                  : "pb-1 font-normal muted-text text-[11px] text-right"
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
                    ? "py-1 tabular-nums text-left truncate"
                    : "py-1 tabular-nums text-right truncate"
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
  return <p className="muted-text text-[12px] py-2">{children}</p>;
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
