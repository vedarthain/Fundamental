/**
 * /market — public market overview.
 *
 * Public top-of-page (visible to anyone):
 *   - Indices strip + sectoral indices grid (1D / 1W / 1M / 1Y)
 *   - Advance / decline ratio (1W)
 *   - Top gainers + top losers with PEER-CLUSTER + QUALITY context
 *     (the differentiator vs every other Indian market page — we show
 *     a 10% move next to the stock's Q-percentile so a viewer can tell
 *     whether the move is on a quality compounder or a junk pop)
 *   - Sector heatmap (1W per meta-cluster)
 *   - FII / DII flow (latest + 30-day strip)
 *
 * Signed-in extras follow in a later phase: watchlist movers, "stocks
 * near 52W high in your watchlist's sectors", quality+momentum filter.
 *
 * Server component: one /api/market/overview call, fully cached (1h TTL,
 * tagged so /api/revalidate purges after the daily refresh).
 */
import { headers } from "next/headers";
import type { Metadata } from "next";
import { MarketClient } from "./MarketClient";
import { PriceDateBadge } from "./PriceDateBadge";
import type { OverviewResponse } from "../api/market/overview/route";

export const dynamic = "force-dynamic";
// Page itself is render-on-each-request because we want the signed-in
// portion to react to the session cookie. The expensive data fetch is
// cached inside the API route, so this dynamic flag is essentially free.

export const metadata: Metadata = {
  title: "Market — Indices, gainers, FII/DII · EquityRoots",
  description:
    "Today's NSE indices, top gainers + losers with peer-cluster and quality context, advance/decline, and FII/DII institutional flows.",
};

async function buildBaseUrl(): Promise<string> {
  // We're a server component → relative fetch needs an absolute URL.
  // Build it from the request headers so this works on Vercel, localhost,
  // and preview deployments without environment-specific config.
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function fetchOverview(): Promise<OverviewResponse | null> {
  try {
    const base = await buildBaseUrl();
    const r = await fetch(`${base}/api/market/overview`, { next: { revalidate: 0 } });
    if (!r.ok) return null;
    return (await r.json()) as OverviewResponse;
  } catch {
    return null;
  }
}

// Signed-in extras moved to client-side fetch (see SignedInExtras.tsx).
// Server only awaits the public overview, so the HTML ships as soon as
// /api/market/overview resolves — no double cold-start penalty for
// signed-in users.

export default async function MarketPage() {
  // /market is now fully public — the signed-in personal cards moved to
  // /watchlist. One server-side await: the cached public overview.
  const data = await fetchOverview();

  if (!data) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 md:px-6 py-10">
        <h1 className="font-display text-[26px] tracking-tight">Market</h1>
        <p className="muted-text text-[13px] mt-2">
          Could not load the market snapshot right now. Try again in a moment.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1300px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <h1 className="font-display text-[26px] md:text-[30px] leading-[1.1] tracking-tight">
            Market
          </h1>
          <p className="muted-text text-[13px] mt-1 max-w-2xl">
            Today&apos;s indices, top movers with their{" "}
            <span className="font-medium" style={{ color: "var(--color-ink)" }}>
              peer-cluster + quality
            </span>{" "}
            context, and institutional flows. Updated daily after market close.
          </p>
        </div>
        <FreshnessBadges
          snapshotDate={data.snapshotDate}
          ltpDate={data.ltpDate}
        />
      </header>

      <MarketClient data={data} />
    </div>
  );
}

function FreshnessBadges({
  snapshotDate,
  ltpDate,
}: {
  snapshotDate: string | null;
  ltpDate: string | null;
}) {
  function fmt(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(`${iso}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  }
  return (
    <div className="flex items-center gap-2 text-[11px] tabular-nums">
      {/* Live during market hours (intraday pingers), EOD close otherwise. */}
      <PriceDateBadge ltpDate={ltpDate} />
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border"
        style={{
          borderColor: "var(--color-border-default)",
          backgroundColor: "var(--color-paper)",
        }}
        title="Scoring snapshot used for Q/V/M percentiles"
      >
        <span className="muted-text">Scores</span>
        <span className="font-medium" style={{ color: "var(--color-ink)" }}>
          {fmt(snapshotDate)}
        </span>
      </span>
    </div>
  );
}
