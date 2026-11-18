import { requireFreshToken } from "@/lib/upstox";

export type IndexQuote = {
  code: "NIFTY50" | "NIFTYBANK" | "NIFTYMIDCAP100" | "NIFTY500";
  symbol: string;
  label: string;
  price: number;
  prevClose: number;
  changePts: number;
  changePct: number;
};

export type LiveIndicesPayload = {
  nifty: IndexQuote | null;
  bankNifty: IndexQuote | null;
  byCode: Partial<Record<IndexQuote["code"], IndexQuote>>;
  source: "upstox" | "yahoo" | "mixed";
  fetchedAt: string;
};

const UPSTOX_QUOTES_URL = "https://api.upstox.com/v2/market-quote/quotes";
const TTL_MS = 5 * 60 * 1000; // 5 minutes

const UPSTOX_INDEX_KEYS: Array<{
  code: IndexQuote["code"];
  key: string;
  label: string;
}> = [
  { code: "NIFTY50", key: "NSE_INDEX|Nifty 50", label: "NIFTY" },
  { code: "NIFTYBANK", key: "NSE_INDEX|Nifty Bank", label: "BANKNIFTY" },
  { code: "NIFTYMIDCAP100", key: "NSE_INDEX|NIFTY MIDCAP 100", label: "MIDCAP 100" },
  { code: "NIFTY500", key: "NSE_INDEX|NIFTY 500", label: "NIFTY 500" },
];

type CachedEntry = {
  payload: LiveIndicesPayload;
  expiresAt: number;
};

let cache: CachedEntry | null = null;

async function fetchFromUpstox(): Promise<Partial<Record<IndexQuote["code"], IndexQuote>>> {
  const out: Partial<Record<IndexQuote["code"], IndexQuote>> = {};
  let token: string;
  try {
    token = await requireFreshToken();
  } catch {
    return out;
  }

  const keys = UPSTOX_INDEX_KEYS.map((x) => x.key);
  const qs = new URLSearchParams({ instrument_key: keys.join(",") });
  try {
    const res = await fetch(`${UPSTOX_QUOTES_URL}?${qs.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Api-Version": "2.0",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return out;

    const json = (await res.json()) as {
      status?: string;
      data?: Record<
        string,
        {
          instrument_token?: string;
          last_price?: number;
          net_change?: number;
          ohlc?: { close?: number };
        }
      >;
    };
    if (json?.status !== "success" || !json.data) return out;

    const byToken = new Map<
      string,
      { last_price?: number; net_change?: number; ohlc?: { close?: number } }
    >();
    for (const v of Object.values(json.data)) {
      if (v.instrument_token) byToken.set(v.instrument_token, v);
    }

    for (const spec of UPSTOX_INDEX_KEYS) {
      const row = byToken.get(spec.key);
      const price = Number(row?.last_price);
      if (!Number.isFinite(price) || price <= 0) continue;

      let changePts: number;
      let prevClose: number;
      if (typeof row?.net_change === "number" && Number.isFinite(row.net_change)) {
        changePts = Math.round(row.net_change * 100) / 100;
        prevClose = Math.round((price - changePts) * 100) / 100;
      } else {
        const ohlcClose = Number(row?.ohlc?.close);
        if (!Number.isFinite(ohlcClose) || ohlcClose <= 0) continue;
        prevClose = ohlcClose;
        changePts = Math.round((price - prevClose) * 100) / 100;
      }

      if (prevClose <= 0) continue;
      const changePct = Math.round((changePts / prevClose) * 10000) / 100;
      out[spec.code] = {
        code: spec.code,
        symbol: spec.key,
        label: spec.label,
        price,
        prevClose,
        changePts,
        changePct,
      };
    }
  } catch {
    // Fall through to Yahoo fallback for missing keys.
  }
  return out;
}

async function fetchYahooIndex(
  code: IndexQuote["code"],
  yahooSym: string,
  label: string,
): Promise<IndexQuote | null> {
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
    return { code, symbol: yahooSym, label, price, prevClose, changePts, changePct };
  } catch {
    return null;
  }
}

export async function getLiveIndices(): Promise<LiveIndicesPayload> {
  const now = Date.now();
  if (cache && cache.expiresAt > now && (cache.payload.nifty || cache.payload.bankNifty)) {
    return cache.payload;
  }

  const byCode = await fetchFromUpstox();
  const gotUpstox = Object.keys(byCode).length > 0;
  let usedYahoo = false;

  if (!byCode.NIFTY50 || !byCode.NIFTYBANK) {
    const [yNifty, yBank] = await Promise.all([
      byCode.NIFTY50 ? Promise.resolve(null) : fetchYahooIndex("NIFTY50", "^NSEI", "NIFTY"),
      byCode.NIFTYBANK
        ? Promise.resolve(null)
        : fetchYahooIndex("NIFTYBANK", "^NSEBANK", "BANKNIFTY"),
    ]);
    if (yNifty) {
      byCode.NIFTY50 = yNifty;
      usedYahoo = true;
    }
    if (yBank) {
      byCode.NIFTYBANK = yBank;
      usedYahoo = true;
    }
  }

  const source: LiveIndicesPayload["source"] =
    gotUpstox && usedYahoo ? "mixed" : gotUpstox ? "upstox" : "yahoo";

  const payload: LiveIndicesPayload = {
    nifty: byCode.NIFTY50 ?? cache?.payload.nifty ?? null,
    bankNifty: byCode.NIFTYBANK ?? cache?.payload.bankNifty ?? null,
    byCode: Object.keys(byCode).length > 0 ? byCode : (cache?.payload.byCode ?? {}),
    source,
    fetchedAt: new Date().toISOString(),
  };

  if (payload.nifty || payload.bankNifty) {
    cache = { payload, expiresAt: now + TTL_MS };
  }

  return payload;
}
