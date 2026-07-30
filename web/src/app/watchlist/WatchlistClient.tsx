"use client";

/**
 * Client-side watchlist renderer.  Reads symbols from localStorage,
 * fetches their card data from /api/watchlist, renders rows grouped by
 * maturity tier (same visual language as /sectors).
 *
 * States:
 *   - hydrating (initial SSR + first mount): skeleton
 *   - empty (no symbols saved): empty-state copy + CTA
 *   - loading (have symbols, fetching data): inline spinner
 *   - loaded: tier-grouped rows
 *   - error: friendly retry button
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWatchlist, saveWatchlistNote } from "@/lib/watchlist";
import { band, bandColor, tierLabelPlural } from "@/lib/score";
import { WatchlistButton } from "@/components/WatchlistButton";

type Row = {
  symbol: string;
  company_name: string | null;
  sector_name: string | null;
  industry_name: string | null;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
  /** Persistence fields — 4-snapshot trend. Null if <2 snapshots of
   *  history (recent listing, missing data). */
  raw_delta: number | null;
  cluster_avg_delta: number | null;
  cluster_adjusted: number | null;
  snaps_improving: number;
  /** Per-user metadata (signed-in only). */
  added_at: string | null;
  close_on_add: number | null;
  close_on_add_date: string | null;
  note: string | null;
  /** Fresh daily quote from golden. */
  ltp: number | null;
  ret_1d: number | null;
  high_52w: number | null;
  low_52w: number | null;
  from_high_pct: number | null;
  from_low_pct: number | null;
};

const TIER_ORDER = ["veteran", "mature", "mid", "new"] as const;

export function WatchlistClient() {
  const { symbols, hydrated, remove, count, signedIn } = useWatchlist();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Snapshot date from the API response so we can tell the user when the
  // prices/scores were computed.  Same value /sectors and the top ribbon
  // show — keeps the "as-of" date consistent across surfaces.
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);

  // Fetch whenever the symbol list changes (post-hydration only — avoid
  // a wasted fetch with empty symbols during SSR).
  useEffect(() => {
    if (!hydrated) return;
    if (symbols.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/watchlist?symbols=${encodeURIComponent(symbols.join(","))}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then((data: { rows: Row[]; snapshot_date?: string | null }) => {
        setRows(data.rows);
        setSnapshotDate(data.snapshot_date ?? null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [hydrated, symbols.join(",")]);  // join so changing order doesn't refetch unnecessarily

  // Render states ─────────────────────────────────────────────────────────
  if (!hydrated) {
    return <Skeleton />;
  }

  if (count === 0) {
    return <EmptyState />;
  }

  if (loading && rows === null) {
    return <Skeleton />;
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[14px] mb-2">Couldn&apos;t load your watchlist</div>
        <div className="muted-text text-[12px] mb-4">{error}</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-[12px] underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // If some symbols didn't return rows (e.g., a stock got delisted from the
  // universe), show what we have + flag the missing ones explicitly.
  const found = new Set((rows || []).map((r) => r.symbol));
  const missing = symbols.filter((s) => !found.has(s));

  // Bucket rows by maturity tier
  const byTier = new Map<string, Row[]>();
  for (const r of rows || []) {
    const t = r.maturity_tier || "—";
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(r);
  }
  for (const arr of byTier.values()) {
    arr.sort((a, b) => (b.composite_pct ?? 0) - (a.composite_pct ?? 0));
  }
  const orderedTiers = [
    ...TIER_ORDER.filter((t) => byTier.has(t)),
    ...Array.from(byTier.keys()).filter((t) => !(TIER_ORDER as readonly string[]).includes(t)),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap text-[12px] muted-text tabular-nums">
        <span>
          {count} {count === 1 ? "stock" : "stocks"} on your watchlist
        </span>
        {snapshotDate && (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border"
            style={{
              borderColor: "var(--color-border-default)",
              backgroundColor: "var(--color-paper)",
            }}
            title="Scoring snapshot date (Q/V/M percentiles). Refreshed weekly; LTP price refreshes daily — see the top ribbon."
          >
            <span className="opacity-70">Scores snapshot</span>
            <span className="font-medium" style={{ color: "var(--color-ink)" }}>
              {formatSnapshotDate(snapshotDate)}
            </span>
          </span>
        )}
        {loading && <span>· refreshing…</span>}
      </div>

      {orderedTiers.map((tier) => {
        const bucket = byTier.get(tier)!;
        return (
          <section key={tier} className="card overflow-hidden">
            <TierHeader tier={tier} count={bucket.length} />
            <div className="divide-y hairline">
              {bucket.map((r) => (
                <WatchRow
                  key={r.symbol}
                  row={r}
                  signedIn={signedIn}
                  onRemove={() => remove(r.symbol)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {missing.length > 0 && (
        <section className="card p-4">
          <div className="text-[12px] muted-text mb-2">
            {missing.length} symbol{missing.length === 1 ? "" : "s"} in your watchlist no longer appear in our universe (delisted, renamed, or scoring paused):
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((sym) => (
              <span
                key={sym}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] tabular-nums"
                style={{ borderColor: "var(--color-border-default)", backgroundColor: "var(--color-paper)" }}
              >
                {sym}
                <button
                  type="button"
                  onClick={() => remove(sym)}
                  className="muted-text hover:text-[var(--color-ink)] ml-0.5"
                  aria-label={`Remove ${sym}`}
                  title="Remove from watchlist"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD → "Mon, 24 May 2026" for human-readable "as of" badges. */
function formatSnapshotDate(iso: string): string {
  // Anchor at noon UTC so a date string parses to the same day regardless of
  // the viewer's timezone — avoids "Sat 24 May" turning into "Fri 23" in -ve
  // offsets.
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="card p-4">
          <div className="h-4 bg-[var(--color-paper)] rounded animate-pulse mb-3 w-1/3" />
          <div className="space-y-2">
            <div className="h-3 bg-[var(--color-paper)] rounded animate-pulse w-full" />
            <div className="h-3 bg-[var(--color-paper)] rounded animate-pulse w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-10 text-center">
      <div className="text-[20px] font-display mb-2">No stocks on your watchlist yet</div>
      <p className="muted-text text-[13.5px] max-w-md mx-auto mb-5">
        Open any stock page and click <span className="font-medium">Watch</span> to add it here. Your list is saved to your account when you&apos;re signed in, otherwise on this device.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px]">
        <Link
          href="/sectors"
          className="px-3 py-1.5 rounded-md border font-medium transition-colors hover:bg-[var(--color-paper)]"
          style={{ borderColor: "var(--color-border-default)" }}
        >
          Browse Sectors
        </Link>
        <Link
          href="/tools/screener"
          className="px-3 py-1.5 rounded-md border font-medium transition-colors hover:bg-[var(--color-paper)]"
          style={{ borderColor: "var(--color-border-default)" }}
        >
          Open Screener
        </Link>
      </div>
    </div>
  );
}

function TierHeader({ tier, count }: { tier: string; count: number }) {
  const colors: Record<string, { stripe: string; bg: string; label: string }> = {
    veteran: { stripe: "#2e9a47", bg: "rgba(46,154,71,0.10)",  label: "#206b32" },
    mature:  { stripe: "#3a9290", bg: "rgba(58,146,144,0.10)", label: "#236663" },
    mid:     { stripe: "#c08e2c", bg: "rgba(192,142,44,0.12)", label: "#8a6116" },
    new:     { stripe: "#7882b8", bg: "rgba(120,130,184,0.12)", label: "#3f4978" },
  };
  const c = colors[tier] ?? { stripe: "var(--color-muted)", bg: "var(--color-paper)", label: "var(--color-muted)" };
  return (
    <div
      className="px-4 md:px-5 py-2.5 flex items-center gap-2.5 border-b hairline"
      style={{ backgroundColor: c.bg }}
    >
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: c.stripe }} />
      <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: c.label }}>
        {tierLabelPlural(tier)}
      </span>
      <span className="tabular-nums text-[11px] muted-text">· {count}</span>
    </div>
  );
}

function WatchRow({
  row,
  signedIn,
  onRemove,
}: {
  row: Row;
  signedIn: boolean;
  onRemove: () => void;
}) {
  const compositeBand = band(row.composite_pct);
  const compositeColor = bandColor(compositeBand);
  const ltp = row.ltp ?? row.current_price;
  // Performance since you added the stock: LTP vs the close captured on add-day.
  // 0% on the day you add (LTP == close_on_add), then moves with the stock.
  const sinceAdd =
    ltp != null && row.close_on_add != null && row.close_on_add !== 0
      ? Math.round((ltp / row.close_on_add - 1) * 1000) / 10
      : null;
  return (
    <div className="px-4 md:px-5 py-3 hover:bg-[var(--color-paper)]/60 transition-colors">
      <div className="flex items-start gap-3">
        <Link href={`/stock/${row.symbol}`} className="flex-1 min-w-0 block">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-[14px] tabular-nums">{row.symbol}</span>
            <span className="muted-text text-[12px] truncate">{row.company_name}</span>
          </div>
          <div className="text-[10.5px] muted-text mt-0.5">
            {row.sector_name ?? "—"} · {row.industry_name ?? "—"}
          </div>
        </Link>

        {/* Composite score badge */}
        {row.composite_pct != null && (
          <span
            className="inline-block min-w-[40px] text-center px-2 py-0.5 rounded-md tabular-nums font-medium text-[12px]"
            style={{
              backgroundColor: compositeColor,
              color: compositeBand === "neutral" ? "var(--color-ink)" : "white",
            }}
            title="Composite peer-cluster score"
          >
            {Math.round(row.composite_pct)}
          </span>
        )}

        {/* Quick remove */}
        <button
          type="button"
          onClick={onRemove}
          className="muted-text hover:text-[var(--color-delta-down)] transition-colors text-[16px] leading-none px-1"
          aria-label={`Remove ${row.symbol} from watchlist`}
          title="Remove from watchlist"
        >
          ×
        </button>
      </div>

      {/* Price context strip: what you added at, where it is now, and how far
          it sits from its 52-week extremes. */}
      <div className="mt-2.5 grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-2 tabular-nums">
        <Metric
          label="Added"
          title={row.added_at ? `Added ${formatSnapshotDate(row.added_at.slice(0, 10))}` : undefined}
          value={row.added_at ? formatShortDate(row.added_at.slice(0, 10)) : "—"}
        />
        <Metric
          label="Close @ add"
          title={
            row.close_on_add_date
              ? `Closing price on ${formatSnapshotDate(row.close_on_add_date)} — your reference point`
              : "Captured when you added the stock"
          }
          value={fmtPrice(row.close_on_add)}
        />
        <Metric label="LTP" title="Latest daily close (split-adjusted)" value={fmtPrice(ltp)} />
        <Metric
          label="Since add"
          title={
            row.close_on_add != null
              ? `LTP vs your add-day close ₹${row.close_on_add.toLocaleString("en-IN", { maximumFractionDigits: 2 })} — your P&L since watching`
              : "Set when you add the stock"
          }
          value={fmtSignedPct(sinceAdd)}
          color={deltaColor(sinceAdd)}
        />
        <Metric
          label="From 52W H"
          title={
            row.high_52w != null
              ? `52-week high ₹${row.high_52w.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
              : undefined
          }
          value={fmtSignedPct(row.from_high_pct)}
        />
        <Metric
          label="From 52W L"
          title={
            row.low_52w != null
              ? `52-week low ₹${row.low_52w.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
              : undefined
          }
          value={fmtSignedPct(row.from_low_pct)}
        />
      </div>

      {/* Scores + longer-horizon returns (weekly panel). */}
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] tabular-nums">
        <ReturnPill label="Q" value={row.quality_pct}   pct />
        <ReturnPill label="V" value={row.valuation_pct} pct />
        <ReturnPill label="M" value={row.momentum_pct}  pct />
        <span className="muted-text">·</span>
        <ReturnPill label="1D" value={row.ret_1d == null ? null : row.ret_1d / 100} signed />
        <ReturnPill label="1W" value={row.ret_1w} signed />
        <ReturnPill label="1M" value={row.ret_1m} signed />
        <ReturnPill label="1Y" value={row.ret_1y} signed />
      </div>

      {/* Editable note — signed-in only (it lives on the server row). */}
      {signedIn ? (
        <NoteEditor symbol={row.symbol} initial={row.note} />
      ) : (
        row.note == null && (
          <div className="mt-2 text-[10.5px] muted-text italic">
            Sign in to record a reference note and your add-day price for this stock.
          </div>
        )
      )}

      {/* Persistence row — multi-snapshot trend.  Frames as "context for
          review", not a buy/sell signal: muted color, no green/red,
          explicit "vs cluster" framing so users don't read the raw
          delta as the headline number. */}
      {row.raw_delta != null && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] tabular-nums muted-text">
          <span title="4-snapshot composite_pct change minus the cluster's average change. Positive = beating peers.">
            vs cluster{" "}
            <span
              className="font-semibold"
              style={{
                color: (row.cluster_adjusted ?? 0) >= 0
                  ? "var(--color-accent-600)"
                  : "var(--color-muted)",
              }}
            >
              {row.cluster_adjusted == null
                ? "—"
                : `${row.cluster_adjusted >= 0 ? "+" : ""}${row.cluster_adjusted.toFixed(1)}`}
            </span>
          </span>
          <span title="Raw 4-snapshot composite percentile change">
            raw{" "}
            <span className="font-medium" style={{ color: "var(--color-ink)" }}>
              {row.raw_delta >= 0 ? "+" : ""}{row.raw_delta.toFixed(1)}
            </span>
          </span>
          <span title="Snapshot-to-snapshot transitions where composite_pct increased">
            improving{" "}
            <span className="font-medium" style={{ color: "var(--color-ink)" }}>
              {row.snaps_improving}/{Math.max(0, Math.min(3, row.snaps_improving + (row.cluster_adjusted == null ? 0 : 3 - row.snaps_improving)))}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// ── Metric cell + formatters ────────────────────────────────────────────────

function Metric({
  label,
  value,
  title,
  color,
}: {
  label: string;
  value: string;
  title?: string;
  color?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[9.5px] uppercase tracking-wide muted-text leading-tight">{label}</div>
      <div className="text-[12px] font-medium leading-tight mt-0.5" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

/** ₹-prefixed price with up to 2 decimals; "—" when null. */
function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Signed percent (+/−, 1 dp), "—" when null. */
function fmtSignedPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function deltaColor(v: number | null): string | undefined {
  if (v == null || v === 0) return undefined;
  return v > 0 ? "var(--color-delta-up)" : "var(--color-delta-down)";
}

/** YYYY-MM-DD → "24 May '26" (compact, for the metric strip). */
function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  const yr = d.toLocaleDateString("en-IN", { year: "2-digit", timeZone: "UTC" });
  return `${day} '${yr}`;
}

// ── Editable note ────────────────────────────────────────────────────────────

function NoteEditor({ symbol, initial }: { symbol: string; initial: string | null }) {
  const [val, setVal] = useState(initial ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initial ?? "");

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const flush = (next: string) => {
    if (next === lastSaved.current) return;
    setStatus("saving");
    saveWatchlistNote(symbol, next)
      .then(() => {
        lastSaved.current = next;
        setStatus("saved");
      })
      .catch(() => setStatus("error"));
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value.slice(0, 500);
    setVal(next);
    setStatus("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), 800);
  };

  const onBlur = () => {
    if (timer.current) clearTimeout(timer.current);
    flush(val);
  };

  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between mb-1">
        <label className="text-[9.5px] uppercase tracking-wide muted-text" htmlFor={`note-${symbol}`}>
          Note
        </label>
        <span className="text-[9.5px] muted-text tabular-nums">
          {status === "saving" && "saving…"}
          {status === "saved" && "saved ✓"}
          {status === "error" && <span style={{ color: "var(--color-delta-down)" }}>save failed</span>}
        </span>
      </div>
      <textarea
        id={`note-${symbol}`}
        value={val}
        onChange={onChange}
        onBlur={onBlur}
        rows={2}
        maxLength={500}
        placeholder="Why you're watching this — thesis, level to buy, catalyst to wait for…"
        className="w-full rounded-md border hairline bg-transparent px-2.5 py-1.5 text-[12px] leading-[1.5] resize-y focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
      />
    </div>
  );
}

function ReturnPill({
  label, value, pct = false, signed = false,
}: { label: string; value: number | null; pct?: boolean; signed?: boolean }) {
  if (value == null) {
    return (
      <span className="muted-text">
        {label}: <span className="opacity-60">—</span>
      </span>
    );
  }
  if (pct) {
    return (
      <span>
        <span className="muted-text">{label}: </span>
        <span className="font-medium">{Math.round(value)}</span>
      </span>
    );
  }
  if (signed) {
    const v = value * 100;
    const color = v >= 0 ? "var(--color-delta-up)" : "var(--color-delta-down)";
    const sign = v >= 0 ? "+" : "";
    const txt = Math.abs(v) >= 10 ? Math.round(v).toString() : v.toFixed(1);
    return (
      <span>
        <span className="muted-text">{label}: </span>
        <span className="font-medium" style={{ color }}>{sign}{txt}%</span>
      </span>
    );
  }
  return <span>{label}: {value}</span>;
}

// WatchlistButton is reused on /stock pages so users can still toggle there;
// the row's × button is just a faster way to prune from this page.
void WatchlistButton;
