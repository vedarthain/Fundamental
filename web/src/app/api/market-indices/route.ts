import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type IndexQuote = {
  symbol: string;
  label: string;
  price: number;
  prevClose: number;
  changePts: number;
  changePct: number;
};

type CachedPayload = {
  nifty: IndexQuote | null;
  bankNifty: IndexQuote | null;
  fetchedAt: string;
  expiresAt: number;
};

let cache: CachedPayload | null = null;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchYahooIndex(yahooSym: string, label: string): Promise<IndexQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
          };
        }>;
      };
    };
    const meta = json?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    const prevClose = Number(meta?.chartPreviousClose ?? meta?.previousClose);
    if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose <= 0) return null;

    const changePts = Math.round((price - prevClose) * 100) / 100;
    const changePct = Math.round(((price - prevClose) / prevClose) * 10000) / 100;
    return { symbol: yahooSym, label, price, prevClose, changePts, changePct };
  } catch {
    return null;
  }
}

export async function GET() {
  const now = Date.now();
  if (cache && cache.expiresAt > now && (cache.nifty || cache.bankNifty)) {
    return NextResponse.json(
      { nifty: cache.nifty, bankNifty: cache.bankNifty, fetchedAt: cache.fetchedAt },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
    );
  }

  const [nifty, bankNifty] = await Promise.all([
    fetchYahooIndex("^NSEI", "NIFTY"),
    fetchYahooIndex("^NSEBANK", "BANKNIFTY"),
  ]);

  const payload: CachedPayload = {
    nifty: nifty ?? cache?.nifty ?? null,
    bankNifty: bankNifty ?? cache?.bankNifty ?? null,
    fetchedAt: new Date().toISOString(),
    expiresAt: now + TTL_MS,
  };
  if (payload.nifty || payload.bankNifty) {
    cache = payload;
  }

  return NextResponse.json(
    { nifty: payload.nifty, bankNifty: payload.bankNifty, fetchedAt: payload.fetchedAt },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
  );
}
