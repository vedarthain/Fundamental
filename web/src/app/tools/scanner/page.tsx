import type { Metadata } from "next";
import { loadLatestMomentum } from "@/lib/momentum";
import { loadLatestTrendLeaders } from "@/lib/trendLeaders";
import { loadLatestSupportFloor } from "@/lib/supportFloor";
import { loadRotation } from "@/lib/rotation";
import { loadAllStocks } from "@/lib/allStocks";
import { loadGraphUniverse } from "@/lib/graphUniverse";
import { loadDividendUniverse } from "@/lib/dividendScanner";
import { loadThemes } from "@/lib/themes";
import { loadSparklines } from "@/lib/sparklines";
import { loadPortfolioSymbols } from "@/lib/portfolio";
import { getSession } from "@/lib/auth";
import { IGNITING_DEFAULT_DAYS, TREND_DEFAULT_DAYS, FLOOR_DEFAULT_DAYS } from "./sparkWindows";
import { sql } from "@/lib/db";
import { unstable_cache } from "next/cache";
import ScannerTabs, { type Tab } from "./ScannerTabs";

export const dynamic = "force-dynamic";

// The Scanner is a post-close daily tool built from app.cluster_stocks_panel_cache
// and the per-scanner snapshot tables — none of it changes within a session. Yet
// the page is force-dynamic (each tab keeps its own history search-param), so
// WITHOUT caching every visit re-ran all eight tab loaders + three sparkline
// batches against Neon: ~10s per click. Wrap each loader in the Data Cache
// instead — keyed by its date arg, revalidated hourly, and tagged "panel-cache"
// so the daily cron purge (see /api/revalidate) busts it the moment new scores
// land. The page stays dynamic; only the DB round-trips are memoised.
const CACHE_TAGS = ["scanner", "panel-cache"];
const HOUR = 3600;

const cachedMomentum = unstable_cache(loadLatestMomentum, ["scanner:momentum:v1"], { revalidate: HOUR, tags: CACHE_TAGS });
const cachedTrend = unstable_cache(loadLatestTrendLeaders, ["scanner:trend:v1"], { revalidate: HOUR, tags: CACHE_TAGS });
const cachedFloor = unstable_cache(loadLatestSupportFloor, ["scanner:floor:v1"], { revalidate: HOUR, tags: CACHE_TAGS });
const cachedRotation = unstable_cache(loadRotation, ["scanner:rotation:v1"], { revalidate: HOUR, tags: CACHE_TAGS });
const cachedAllStocks = unstable_cache(loadAllStocks, ["scanner:allStocks:v1"], { revalidate: HOUR, tags: CACHE_TAGS });
const cachedGraphUniverse = unstable_cache(loadGraphUniverse, ["scanner:graph:v1"], { revalidate: HOUR, tags: CACHE_TAGS });
const cachedDividendUniverse = unstable_cache(loadDividendUniverse, ["scanner:dividends:v1"], { revalidate: HOUR, tags: CACHE_TAGS });
const cachedThemes = unstable_cache(loadThemes, ["scanner:themes:v1"], { revalidate: HOUR, tags: CACHE_TAGS });
const cachedSparklines = unstable_cache(loadSparklines, ["scanner:sparklines:v1"], { revalidate: HOUR, tags: CACHE_TAGS });
const cachedN500 = unstable_cache(
  async () => sql<{ symbol: string }[]>`SELECT symbol FROM app.index_constituent WHERE index_code = 'NIFTY500'`,
  ["scanner:n500:v1"],
  { revalidate: HOUR, tags: CACHE_TAGS },
);

// Defined server-side, NOT imported from the "use client" ScannerTabs module:
// value exports from a client module become client-reference proxies in a
// Server Component, so `.includes` would be undefined at runtime.
const SCANNER_TABS: readonly Tab[] = ["igniting", "trend", "floor", "fallen", "sectors", "all", "graph", "themes", "dividends"];

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
  // "peers" folded into the "sectors" tab (a toggle inside it now switches
  // Sectors ⇄ Peer groups). Redirect the old deep-link so a bookmarked
  // ?tab=peers still lands somewhere real instead of a blank panel.
  const normalizedTab = tabParam === "peers" ? "sectors" : tabParam;
  const initialTab: Tab = SCANNER_TABS.includes(normalizedTab as Tab) ? (normalizedTab as Tab) : "igniting";
  // Per-user real holdings — kept OUT of the shared unstable_cache above (which
  // is keyed only by date and shared across all visitors). Drives the auto-lit
  // "P" marker + Portfolio filter on the Graph tab. Cheap symbol-only query.
  const session = await getSession();

  const [momentum, trend, floor, rotation, allStocks, graphUniverse, dividendUniverse, themes, n500, portfolioSymbols] = await Promise.all([
    cachedMomentum(one(sp.mDate)),
    cachedTrend(one(sp.tDate)),
    cachedFloor(one(sp.fDate)),
    cachedRotation(one(sp.rDate)),
    cachedAllStocks(),
    cachedGraphUniverse(),
    cachedDividendUniverse(),
    cachedThemes(),
    cachedN500(),
    session ? loadPortfolioSymbols(session.userId) : Promise.resolve([]),
  ]);

  // Per-row mini price charts — one batched golden query per tab, each on that
  // tab's DEFAULT window (from sparkWindows.ts, the single source of truth the
  // client toggle also imports). This renders first paint; the WindowPicker in
  // each client refetches /api/scanner/sparklines when the user changes window.
  const [momentumSpark, trendSpark, floorSpark] = await Promise.all([
    cachedSparklines(momentum.signals.map((s) => s.symbol), IGNITING_DEFAULT_DAYS),
    cachedSparklines(trend.signals.map((s) => s.symbol), TREND_DEFAULT_DAYS),
    cachedSparklines(floor.signals.map((s) => s.symbol), FLOOR_DEFAULT_DAYS),
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
      graphUniverse={graphUniverse}
      dividendUniverse={dividendUniverse}
      themes={themes}
      nifty500={n500.map((r) => r.symbol)}
      portfolioSymbols={portfolioSymbols}
      initialTab={initialTab}
    />
  );
}
