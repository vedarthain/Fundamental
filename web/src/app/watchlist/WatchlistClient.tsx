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

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWatchlist } from "@/lib/watchlist";
import { band, bandColor, tierLabel } from "@/lib/score";
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
};

const TIER_ORDER = ["veteran", "mature", "mid", "new"] as const;

export function WatchlistClient() {
  const { symbols, hydrated, remove, count } = useWatchlist();
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
                <WatchRow key={r.symbol} row={r} onRemove={() => remove(r.symbol)} />
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
        Open any stock page and click <span className="font-medium">Watch</span> to add it here. Your list is saved on this device.
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
        {tierLabel(tier)}s
      </span>
      <span className="tabular-nums text-[11px] muted-text">· {count}</span>
    </div>
  );
}

function WatchRow({ row, onRemove }: { row: Row; onRemove: () => void }) {
  const compositeBand = band(row.composite_pct);
  const compositeColor = bandColor(compositeBand);
  return (
    <div className="px-4 md:px-5 py-3 hover:bg-[var(--color-paper)]/60 transition-colors">
      <div className="flex items-start gap-3">
        <Link href={`/stock/${row.symbol}`} className="flex-1 min-w-0 block">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-[14px] tabular-nums">{row.symbol}</span>
            <span className="muted-text text-[12px] truncate">{row.company_name}</span>
          </div>
          <div className="text-[10.5px] muted-text mt-0.5">
            {row.sector_name} · {row.industry_name}
            {row.current_price != null && (
              <> · ₹{row.current_price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</>
            )}
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

      {/* Returns row */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] tabular-nums">
        <ReturnPill label="Q" value={row.quality_pct}   pct />
        <ReturnPill label="V" value={row.valuation_pct} pct />
        <ReturnPill label="M" value={row.momentum_pct}  pct />
        <span className="muted-text">·</span>
        <ReturnPill label="1W" value={row.ret_1w} signed />
        <ReturnPill label="1M" value={row.ret_1m} signed />
        <ReturnPill label="1Y" value={row.ret_1y} signed />
      </div>
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
