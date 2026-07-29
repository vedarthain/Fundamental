import type { Metadata } from "next";
import { loadLatestMomentum } from "@/lib/momentum";
import { loadLatestTrendLeaders } from "@/lib/trendLeaders";
import { loadLatestSupportFloor } from "@/lib/supportFloor";
import { loadRotation } from "@/lib/rotation";
import { loadAllStocks } from "@/lib/allStocks";
import { loadSparklines } from "@/lib/sparklines";
import { sql } from "@/lib/db";
import ScannerTabs, { type Tab } from "./ScannerTabs";

export const dynamic = "force-dynamic";

// Defined server-side, NOT imported from the "use client" ScannerTabs module:
// value exports from a client module become client-reference proxies in a
// Server Component, so `.includes` would be undefined at runtime.
const SCANNER_TABS: readonly Tab[] = ["igniting", "trend", "floor", "fallen", "sectors", "peers", "all"];

export const metadata: Metadata = {
  title: "Scanner — EquityRoots",
  description:
    "Two daily scanners: stocks igniting today on abnormal volume, and durable uptrends caught at the start (fresh golden cross) — each with its fundamental score so pumps and weak trends stand out.",
};

// /tools/scanner — daily scanners under one tabbed roof, each cron-built
// post-close. Each scanner keeps ~1 year of daily snapshots and can browse its
// own history via an independent search-param (the loaders fall back to the
// latest when the param is absent):
//   mDate → Igniting today   tDate → Trend Leaders   fDate → At Support
//   rDate → Sectors / Peer groups (rotation)
function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : null;
}

export default async function MomentumPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tabParam = one(sp.tab);
  const initialTab: Tab = SCANNER_TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "igniting";
  const [momentum, trend, floor, rotation, allStocks, n500] = await Promise.all([
    loadLatestMomentum(one(sp.mDate)),
    loadLatestTrendLeaders(one(sp.tDate)),
    loadLatestSupportFloor(one(sp.fDate)),
    loadRotation(one(sp.rDate)),
    loadAllStocks(),
    sql<{ symbol: string }[]>`SELECT symbol FROM app.index_constituent WHERE index_code = 'NIFTY500'`,
  ]);

  // Per-row mini price charts — one batched golden query per tab, each on the
  // window that matches that scanner's clock: Igniting shows the base → the
  // breakout (~3M), Trend shows the whole uptrend (1Y), At Support shows the
  // approach to the tested floor (~7M). Rendered inline in each table row.
  const [momentumSpark, trendSpark, floorSpark] = await Promise.all([
    loadSparklines(momentum.signals.map((s) => s.symbol), 95),
    loadSparklines(trend.signals.map((s) => s.symbol), 365),
    loadSparklines(floor.signals.map((s) => s.symbol), 210),
  ]);

  return (
    <ScannerTabs
      momentumSnapDate={momentum.snapDate}
      momentumSignals={momentum.signals}
      momentumDates={momentum.dates}
      momentumSpark={momentumSpark}
      trendSnapDate={trend.snapDate}
      trendSignals={trend.signals}
      trendDates={trend.dates}
      trendSpark={trendSpark}
      floorSnapDate={floor.snapDate}
      floorSignals={floor.signals}
      floorDates={floor.dates}
      floorSpark={floorSpark}
      rotation={rotation}
      allStocksSnapDate={allStocks.snapDate}
      allStocks={allStocks.rows}
      nifty500={n500.map((r) => r.symbol)}
      initialTab={initialTab}
    />
  );
}
