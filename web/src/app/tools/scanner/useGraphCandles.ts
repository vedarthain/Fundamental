"use client";

/**
 * useGraphCandles — lazy, per-page OHLCV fetcher for the Graph tab's 2×2 grid.
 *
 * The Graph tab browses ~2,100 names 4 at a time, so we fetch only the visible
 * page's ≤4 symbols at the chosen window, on demand, and cache each series by
 * `${symbol}|${days}`. Paging back or flipping the window re-renders instantly
 * and only ever-new (symbol, window) pairs hit /api/scanner/ohlc.
 *
 * A monotonic request token drops out-of-order replies (page fast, or change the
 * window mid-flight, and the slow reply must not overwrite the page you're on).
 *
 * Mirrors usePagedSparklines' contract; the payload is Candle[] not SparkPoint[].
 */
import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/candles";

type CandleMap = Record<string, Candle[]>;

export function useGraphCandles(symbols: string[], days: number) {
  const [data, setData] = useState<CandleMap>({});
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, Candle[]>>(new Map());
  const reqToken = useRef(0);

  const key = `${symbols.join(",")}@${days}`;

  useEffect(() => {
    const ck = (s: string) => `${s}|${days}`;
    const cachedFor = (): CandleMap => {
      const v: CandleMap = {};
      for (const s of symbols) {
        const hit = cache.current.get(ck(s));
        if (hit) v[s] = hit;
      }
      return v;
    };

    const missing = symbols.filter((s) => !cache.current.has(ck(s)));

    // Merge, never blank: keep prior charts on screen (dimmed by `loading`) and
    // swap freshly-cached series in place — no flash to the empty state.
    setData((prev) => ({ ...prev, ...cachedFor() }));

    if (missing.length === 0) {
      setLoading(false);
      return;
    }

    const token = ++reqToken.current;
    setLoading(true);
    const qs = new URLSearchParams({ syms: missing.join(","), days: String(days) });
    fetch(`/api/scanner/ohlc?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { data: CandleMap }) => {
        if (token !== reqToken.current) return; // superseded — drop stale reply
        for (const [s, series] of Object.entries(j.data)) cache.current.set(ck(s), series);
        setData((prev) => ({ ...prev, ...cachedFor() }));
        setLoading(false);
      })
      .catch(() => {
        if (token === reqToken.current) setLoading(false);
      });
    // symbols/days are folded into `key`; depending on array identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading };
}
