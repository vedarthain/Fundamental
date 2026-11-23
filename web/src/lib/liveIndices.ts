import { requireFreshToken } from "@/lib/upstox";
import { withinPingerWindow } from "@/lib/marketHours";
import { sql } from "@/lib/db";

export type IndexQuote = {
  code: string;
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
  byCode: Record<string, IndexQuote>;
  source: "upstox" | "yahoo" | "mixed" | "eod";
  fetchedAt: string;
};

const UPSTOX_QUOTES_URL = "https://api.upstox.com/v2/market-quote/quotes";
const TTL_MS = 5 * 60 * 1000; // 5 minutes

// All 23 tracked NSE indices fetched in ONE single Upstox /quotes request every 5 min (zero extra API calls/cost).
const UPSTOX_INDEX_KEYS: Array<{
  code: string;
  key: string;
  label: string;
}> = [
  { code: "NIFTY50", key: "NSE_INDEX|Nifty 50", label: "NIFTY" },
  { code: "NIFTYBANK", key: "NSE_INDEX|Nifty Bank", label: "BANKNIFTY" },
  { code: "NIFTY100", key: "NSE_INDEX|Nifty 100", label: "NIFTY 100" },
  { code: "NIFTY500", key: "NSE_INDEX|Nifty 500", label: "NIFTY 500" },
  { code: "NIFTYNEXT50", key: "NSE_INDEX|Nifty Next 50", label: "NIFTY NEXT 50" },
  { code: "NIFTYMIDCAP100", key: "NSE_INDEX|NIFTY MIDCAP 100", label: "MIDCAP 100" },
  { code: "NIFTYSMALLCAP100", key: "NSE_INDEX|NIFTY SMLCAP 100", label: "SMALLCAP 100" },
  { code: "NIFTYAUTO", key: "NSE_INDEX|Nifty Auto", label: "NIFTY AUTO" },
  { code: "NIFTYENERGY", key: "NSE_INDEX|Nifty Energy", label: "NIFTY ENERGY" },
  { code: "NIFTYFMCG", key: "NSE_INDEX|Nifty FMCG", label: "NIFTY FMCG" },
  { code: "NIFTYIT", key: "NSE_INDEX|Nifty IT", label: "NIFTY IT" },
  { code: "NIFTYMETAL", key: "NSE_INDEX|Nifty Metal", label: "NIFTY METAL" },
  { code: "NIFTYPHARMA", key: "NSE_INDEX|Nifty Pharma", label: "NIFTY PHARMA" },
  { code: "NIFTYREALTY", key: "NSE_INDEX|Nifty Realty", label: "NIFTY REALTY" },
  { code: "NIFTYFINSERVICE", key: "NSE_INDEX|Nifty Fin Service", label: "NIFTY FIN SERVICE" },
  { code: "NIFTYFINSRV2550", key: "NSE_INDEX|Nifty FinSrv25 50", label: "NIFTY FINSRV 25/50" },
  { code: "NIFTYHEALTHCARE", key: "NSE_INDEX|NIFTY HEALTHCARE", label: "NIFTY HEALTHCARE" },
  { code: "NIFTYCONSDUR", key: "NSE_INDEX|NIFTY CONSR DURBL", label: "NIFTY CONSR DURBL" },
  { code: "NIFTYOILGAS", key: "NSE_INDEX|NIFTY OIL AND GAS", label: "NIFTY OIL & GAS" },
  { code: "NIFTYPVTBANK", key: "NSE_INDEX|Nifty Pvt Bank", label: "NIFTY PVT BANK" },
  { code: "NIFTYPSUBANK", key: "NSE_INDEX|Nifty PSU Bank", label: "NIFTY PSU BANK" },
  { code: "NIFTYMEDIA", key: "NSE_INDEX|Nifty Media", label: "NIFTY MEDIA" },
  { code: "NIFTYMIDSMALLHEALTH", key: "NSE_INDEX|Nifty MidSml Hlth", label: "NIFTY MIDSML HLTH" },
];

type CachedEntry = {
  payload: LiveIndicesPayload;
  expiresAt: number;
};

let cache: CachedEntry | null = null;

async function fetchFromUpstox(): Promise<Record<string, IndexQuote>> {
  const out: Record<string, IndexQuote> = {};
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

async function fetchFromDbEod(): Promise<LiveIndicesPayload> {
  const byCode: Record<string, IndexQuote> = {};
  const labelByCode = new Map(UPSTOX_INDEX_KEYS.map((x) => [x.code, x.label]));
  let asOfIso = new Date().toISOString();
  try {
    const rows = await sql<
      { code: string; close: number; pct_change: number | null; date: string }[]
    >`
      WITH latest_date AS (SELECT MAX(date) AS d FROM app.market_index_history)
      SELECT h.index_code AS code,
             h.close::float AS close,
             h.pct_change::float AS pct_change,
             h.date::text AS date
        FROM app.market_index_history h
        JOIN latest_date l ON l.d = h.date
    `;
    for (const r of rows) {
      const price = Number(r.close);
      if (!Number.isFinite(price) || price <= 0) continue;
      const pct = Number.isFinite(Number(r.pct_change)) ? Number(r.pct_change) : 0;
      const prevClose = pct !== -100 ? Math.round((price / (1 + pct / 100)) * 100) / 100 : price;
      const changePts = Math.round((price - prevClose) * 100) / 100;
      const changePct = Math.round(pct * 100) / 100;
      byCode[r.code] = {
        code: r.code,
        symbol: r.code,
        label: labelByCode.get(r.code) ?? r.code,
        price,
        prevClose,
        changePts,
        changePct,
      };
      if (r.date) asOfIso = `${r.date}T10:00:00.000Z`; // 15:30 IST
    }
  } catch {
    // Fail soft
  }
  return {
    nifty: byCode.NIFTY50 ?? null,
    bankNifty: byCode.NIFTYBANK ?? null,
    byCode,
    source: "eod",
    fetchedAt: asOfIso,
  };
}

async function persistIndicesToDb(byCode: Record<string, IndexQuote>): Promise<void> {
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const entries = Object.values(byCode);
  if (entries.length === 0) return;

  for (const q of entries) {
    if (!q.price || q.price <= 0) continue;
    try {
      await sql`
        INSERT INTO app.market_index_history (index_code, date, close, prev_close, pct_change, display_name)
        VALUES (${q.code}, ${todayStr}, ${q.price}, ${q.prevClose}, ${q.changePct}, ${q.label})
        ON CONFLICT (index_code, date) DO UPDATE SET
          close = EXCLUDED.close,
          prev_close = EXCLUDED.prev_close,
          pct_change = EXCLUDED.pct_change,
          display_name = EXCLUDED.display_name
      `;
    } catch {
      // Non-fatal, ignore DB conflict
    }
  }
}

export async function getLiveIndices(): Promise<LiveIndicesPayload> {
  const now = Date.now();
  const marketOpen = withinPingerWindow();

  // If in-memory cache is still fresh, serve it immediately
  if (cache && cache.expiresAt > now && (cache.payload.nifty || cache.payload.bankNifty)) {
    return cache.payload;
  }

  // Fetch live / settled closing quotes from Upstox (or Yahoo Finance as fallback)
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

  // If both Upstox and Yahoo failed to provide NIFTY, fall back to DB EOD
  if (!byCode.NIFTY50 && !byCode.NIFTYBANK) {
    if (cache && (cache.payload.nifty || cache.payload.bankNifty)) {
      return cache.payload;
    }
    return fetchFromDbEod();
  }

  const source: LiveIndicesPayload["source"] =
    gotUpstox && usedYahoo ? "mixed" : gotUpstox ? "upstox" : "yahoo";

  let equityFetchedIso: string | null = null;
  try {
    const r = await sql<{ ts: string | null }[]>`
      SELECT MAX(price_fetched_at)::text AS ts
        FROM app.screener_meta
       WHERE price_fetched_at IS NOT NULL
    `;
    if (r[0]?.ts) {
      equityFetchedIso = r[0].ts;
    }
  } catch {
    // ignore
  }

  const payload: LiveIndicesPayload = {
    nifty: byCode.NIFTY50 ?? cache?.payload.nifty ?? null,
    bankNifty: byCode.NIFTYBANK ?? cache?.payload.bankNifty ?? null,
    byCode: Object.keys(byCode).length > 0 ? byCode : (cache?.payload.byCode ?? {}),
    source,
    fetchedAt: equityFetchedIso ?? new Date().toISOString(),
  };

  if (payload.nifty || payload.bankNifty) {
    const ttl = marketOpen ? TTL_MS : 30 * 60 * 1000;
    cache = { payload, expiresAt: now + ttl };
    // Asynchronously persist quotes to DB so DB-driven views also reflect today's close
    persistIndicesToDb(byCode).catch(() => {});
  }

  return payload;
}
