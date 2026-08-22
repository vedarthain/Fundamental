"use client";

/**
 * Calls screen — the table behind the /watchlist "Calls" tab.
 *
 * Active calls split into Buy / Sell sections; each column header sorts. Shows
 * the date the call was made, the anchored price, live LTP, and the raw % move
 * since. The Call cell is the live CallToggle (switch side / cancel a mis-tag).
 *
 * The row's "✓" clears the call to HISTORY ("I acted on / purchased this"): it
 * leaves the Buy/Sell list and drops into the Cleared section below, which
 * keeps the realized move (anchor → the price snapshotted at clear time). A
 * cleared row's "×" purges it from history for good.
 */
import { useState } from "react";
import Link from "next/link";
import { useCalls } from "@/lib/stockCalls";
import { CallToggle } from "@/components/CallToggle";
import { displayCompanyName } from "@/lib/score";

const BUY = "#0a8f2f";
const SELL = "#c0392b";

type CallRow = ReturnType<typeof useCalls>["list"][number];
type SortKey = "symbol" | "anchor_date" | "anchor_price" | "ltp" | "pct_move";

function money(n: number | null): string {
  if (n == null) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pctFmt(n: number | null): { text: string; color: string } {
  if (n == null) return { text: "—", color: "var(--color-muted)" };
  const sign = n > 0 ? "+" : "";
  const color = n > 0 ? BUY : n < 0 ? SELL : "var(--color-muted)";
  return { text: `${sign}${n.toFixed(1)}%`, color };
}
/** YYYY-MM-DD (or ISO) → "5 Jul '26". */
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const yr = d.toLocaleDateString("en-IN", { year: "2-digit", timeZone: "UTC" });
  return `${day} '${yr}`;
}

function sortRows(rows: CallRow[], key: SortKey, dir: 1 | -1): CallRow[] {
  return [...rows].sort((a, b) => {
    let av: string | number | null;
    let bv: string | number | null;
    if (key === "symbol") {
      av = a.symbol;
      bv = b.symbol;
    } else {
      av = a[key];
      bv = b[key];
    }
    // Nulls always sink to the bottom regardless of direction.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
    return ((av as number) - (bv as number)) * dir;
  });
}

function Section({
  title,
  color,
  rows,
  sortKey,
  sortDir,
  onSort,
  onClear,
}: {
  title: string;
  color: string;
  rows: CallRow[];
  sortKey: SortKey;
  sortDir: 1 | -1;
  onSort: (k: SortKey) => void;
  onClear: (symbol: string) => void;
}) {
  const H = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <th className={`px-2.5 py-1.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-0.5 hover:text-[var(--color-ink)] ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        {label}
        <span className="text-[9px] w-2 inline-block">{sortKey === k ? (sortDir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color }}>
        {title}
        <span className="muted-text font-normal tabular-nums">({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <div className="card px-3 py-3 text-[12px] muted-text">None.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b hairline muted-text text-[10.5px] uppercase tracking-wide">
                <H k="symbol" label="Stock" align="left" />
                <th className="px-2.5 py-1.5 font-medium text-center">Call</th>
                <H k="anchor_date" label="Date" />
                <H k="anchor_price" label="Anchor" />
                <H k="ltp" label="LTP" />
                <H k="pct_move" label="% move" />
                <th className="px-2.5 py-1.5 font-medium text-center w-8" aria-label="Clear" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const p = pctFmt(c.pct_move);
                return (
                  <tr key={c.symbol} className="border-b hairline last:border-0 hover:bg-[var(--color-paper)]">
                    <td className="px-2.5 py-1.5 min-w-0">
                      <Link href={`/stock/${c.symbol}`} className="font-semibold hover:underline">
                        {c.symbol}
                      </Link>
                      <div className="text-[10.5px] muted-text truncate max-w-[200px]">
                        {displayCompanyName(c.company_name, c.symbol)}
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5 text-center">
                      <CallToggle symbol={c.symbol} size="sm" />
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums muted-text">{c.anchor_date}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{money(c.anchor_price)}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{money(c.ltp)}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold" style={{ color: p.color }}>
                      {p.text}
                    </td>
                    <td className="px-2.5 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => onClear(c.symbol)}
                        className="muted-text hover:text-[var(--color-accent-600)] transition-colors text-[13px] leading-none px-1"
                        aria-label={`Clear ${c.side === "B" ? "Buy" : "Sell"} call on ${c.symbol} (mark as acted on)`}
                        title="Clear — mark as acted on, keep in history"
                      >
                        ✓
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Cleared / history section — calls you've acted on. Keeps entry, the price we
 *  snapshotted at clear time, and the realized raw move. The "×" purges a row. */
function ClearedSection({
  rows,
  onRemove,
}: {
  rows: CallRow[];
  onRemove: (symbol: string) => void;
}) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (b.cleared_at ?? "").localeCompare(a.cleared_at ?? ""));
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold muted-text">
        Cleared
        <span className="font-normal tabular-nums">({rows.length})</span>
        <span className="font-normal text-[10.5px] opacity-80">— calls you&apos;ve acted on</span>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b hairline muted-text text-[10.5px] uppercase tracking-wide">
              <th className="px-2.5 py-1.5 font-medium text-left">Stock</th>
              <th className="px-2.5 py-1.5 font-medium text-center">Was</th>
              <th className="px-2.5 py-1.5 font-medium text-right">Anchor</th>
              <th className="px-2.5 py-1.5 font-medium text-right">Cleared @</th>
              <th className="px-2.5 py-1.5 font-medium text-right">Cleared</th>
              <th className="px-2.5 py-1.5 font-medium text-right">Captured</th>
              <th className="px-2.5 py-1.5 font-medium text-center w-8" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const p = pctFmt(c.cleared_pct);
              return (
                <tr key={c.symbol} className="border-b hairline last:border-0 hover:bg-[var(--color-paper)]">
                  <td className="px-2.5 py-1.5 min-w-0">
                    <Link href={`/stock/${c.symbol}`} className="font-semibold hover:underline">
                      {c.symbol}
                    </Link>
                    <div className="text-[10.5px] muted-text truncate max-w-[200px]">
                      {displayCompanyName(c.company_name, c.symbol)}
                    </div>
                  </td>
                  <td className="px-2.5 py-1.5 text-center">
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                      style={{ background: c.side === "B" ? BUY : SELL }}
                    >
                      {c.side}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{money(c.anchor_price)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{money(c.cleared_price)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums muted-text">{shortDate(c.cleared_at)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold" style={{ color: p.color }}>
                    {p.text}
                  </td>
                  <td className="px-2.5 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => onRemove(c.symbol)}
                      className="muted-text hover:text-[var(--color-delta-down)] transition-colors text-[15px] leading-none px-1"
                      aria-label={`Remove ${c.symbol} from call history`}
                      title="Remove from history"
                    >
                      ×
                    </button>
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

export function CallsClient() {
  const { list, clear, remove, hydrated, signedIn } = useCalls();
  const [sortKey, setSortKey] = useState<SortKey>("pct_move");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === "symbol" ? 1 : -1); // names default A→Z, numbers high→low
    }
  };

  if (!hydrated) {
    return <div className="card p-8 text-center muted-text text-[13px]">Loading your calls…</div>;
  }
  if (!signedIn) {
    return (
      <div className="card p-8 text-center muted-text text-[13px]">
        Sign in to make and track Buy/Sell calls.
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[14px] mb-2">No calls yet</div>
        <div className="muted-text text-[12.5px] max-w-md mx-auto">
          Tag a stock <span style={{ color: BUY, fontWeight: 700 }}>B</span>uy or{" "}
          <span style={{ color: SELL, fontWeight: 700 }}>S</span>ell from its page or the scanner
          grid. We snapshot the price the moment you tag it, then track the raw % move from there.
        </div>
      </div>
    );
  }

  const active = list.filter((c) => c.cleared_at == null);
  const cleared = list.filter((c) => c.cleared_at != null);
  const buys = sortRows(active.filter((c) => c.side === "B"), sortKey, sortDir);
  const sells = sortRows(active.filter((c) => c.side === "S"), sortKey, sortDir);

  return (
    <div className="max-w-[760px] space-y-4">
      <Section title="Buy calls" color={BUY} rows={buys} sortKey={sortKey} sortDir={sortDir} onSort={onSort} onClear={clear} />
      <Section title="Sell calls" color={SELL} rows={sells} sortKey={sortKey} sortDir={sortDir} onSort={onSort} onClear={clear} />
      <ClearedSection rows={cleared} onRemove={remove} />
    </div>
  );
}
