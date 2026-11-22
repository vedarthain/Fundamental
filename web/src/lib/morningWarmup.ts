import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { loadPortfolio, loadPerformanceStats, loadPortfolioSymbols } from "@/lib/portfolio";
import { loadPersistenceForSymbols } from "@/lib/persistence";
import { loadQuotes } from "@/lib/watchlistQuote";

const MAX_SYMBOLS = 1000;

async function warmWatchlistForUser(userId: number): Promise<{ symbols: number }> {
  const [wl, held, callSyms] = await Promise.all([
    sql<{ symbol: string }[]>`
      SELECT symbol FROM app.user_watchlist
       WHERE user_id = ${userId}
       ORDER BY added_at DESC
       LIMIT ${MAX_SYMBOLS}
    `.catch(() => [] as { symbol: string }[]),
    loadPortfolioSymbols(userId).catch(() => [] as string[]),
    sql<{ symbol: string }[]>`
      SELECT DISTINCT symbol FROM app.stock_call
       WHERE user_id = ${userId} AND cleared_at IS NULL
    `.catch(() => [] as { symbol: string }[]),
  ]);
  const base = wl.map((r) => r.symbol);
  const extra = [
    ...held.map((s) => s.toUpperCase()),
    ...callSyms.map((r) => r.symbol.toUpperCase()),
  ];
  const symbols = Array.from(new Set([...base, ...extra])).slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) return { symbols: 0 };

  const sortedKey = [...symbols].sort().join(",");
  const cachedPersistence = unstable_cache(
    async (syms: string[]) => Array.from((await loadPersistenceForSymbols(syms)).entries()),
    ["watchlist:persistence:v1", sortedKey],
    { revalidate: 3600, tags: ["panel-cache"] },
  );
  const cachedQuotes = unstable_cache(
    async (syms: string[], isLean: boolean) => Array.from((await loadQuotes(syms, isLean)).entries()),
    ["watchlist:quotes:v1", sortedKey, "true"],
    { revalidate: 120, tags: ["market", "panel-cache"] },
  );
  const cachedQuotesFull = unstable_cache(
    async (syms: string[], isLean: boolean) => Array.from((await loadQuotes(syms, isLean)).entries()),
    ["watchlist:quotes:v1", sortedKey, "false"],
    { revalidate: 120, tags: ["market", "panel-cache"] },
  );

  // Also warm the @portfolio symbol list quotes used by /portfolio Returns tab
  const heldKey = [...new Set(held.map((s) => s.toUpperCase()))].sort().join(",");
  const cachedPortfolioQuotes = heldKey
    ? unstable_cache(
        async (syms: string[], isLean: boolean) => Array.from((await loadQuotes(syms, isLean)).entries()),
        ["watchlist:quotes:v1", heldKey, "true"],
        { revalidate: 120, tags: ["market", "panel-cache"] },
      )([
        ...new Set(held.map((s) => s.toUpperCase())),
      ], true)
    : Promise.resolve([]);

  await Promise.all([
    cachedPersistence(symbols),
    cachedQuotes(symbols, true),
    cachedQuotesFull(symbols, false),
    cachedPortfolioQuotes,
  ]);
  return { symbols: symbols.length };
}

async function warmCallsInternal(): Promise<{ gems: number; portfolio: number }> {
  const token =
    process.env.REVALIDATE_TOKEN ||
    process.env.INTRADAY_CRON_TOKEN ||
    process.env.CRON_SECRET ||
    "";
  if (!token) return { gems: 0, portfolio: 0 };
  const port = process.env.PORT || "3000";
  const res = await fetch(
    `http://127.0.0.1:${port}/api/admin/calls?warm=1&token=${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return { gems: 0, portfolio: 0 };
  const data = (await res.json()) as { gems?: number; portfolio?: number };
  return { gems: data.gems ?? 0, portfolio: data.portfolio ?? 0 };
}

export async function runMorningWarmup(userId = 1) {
  const t0 = Date.now();
  const [pf, wl, calls] = await Promise.all([
    loadPortfolio(userId).then(async (p) => {
      await loadPerformanceStats(userId, p).catch(() => null);
      return { holdings: p.instruments.length, currentValue: p.totals.currentValue };
    }),
    warmWatchlistForUser(userId).catch(() => ({ symbols: 0 })),
    warmCallsInternal().catch(() => ({ gems: 0, portfolio: 0 })),
  ]);
  return {
    ok: true,
    durationMs: Date.now() - t0,
    portfolio: pf,
    watchlist: wl,
    calls,
  };
}
