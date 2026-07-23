import type { Metadata } from "next";
import { loadLatestMomentum } from "@/lib/momentum";
import { loadLatestTrendLeaders } from "@/lib/trendLeaders";
import { sql } from "@/lib/db";
import ScannerTabs from "./ScannerTabs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scanner — EquityRoots",
  description:
    "Two daily scanners: stocks igniting today on abnormal volume, and durable uptrends caught at the start (fresh golden cross) — each with its fundamental score so pumps and weak trends stand out.",
};

// /tools/momentum — two daily scanners under one tabbed roof:
//   Igniting today → app.momentum_signal   (one-day volume explosion)
//   Trend Leaders  → app.trend_leader_signal (fresh golden cross, slow burn)
// Both caches are cron-built post-close; this page just reads the latest of each.
export default async function MomentumPage() {
  const [momentum, trend, n500] = await Promise.all([
    loadLatestMomentum(),
    loadLatestTrendLeaders(),
    sql<{ symbol: string }[]>`SELECT symbol FROM app.index_constituent WHERE index_code = 'NIFTY500'`,
  ]);
  return (
    <ScannerTabs
      momentumSnapDate={momentum.snapDate}
      momentumSignals={momentum.signals}
      trendSnapDate={trend.snapDate}
      trendSignals={trend.signals}
      nifty500={n500.map((r) => r.symbol)}
    />
  );
}
