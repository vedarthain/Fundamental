"use client";

/**
 * useIndexCandles — fetch one index's OHLC candles for the Themes grid.
 *
 * The index is pinned in slot 1 of the grid, so we fetch it once per
 * (index_code, window) and cache — paging the constituents beside it never
 * re-hits this. Mirrors useGraphCandles' request-token guard so a slow reply
 * for an old theme/window can't overwrite the current one.
 */
import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/candles";

export function useIndexCandles(code: string, days: number) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, Candle[]>>(new Map());
  const reqToken = useRef(0);

  useEffect(() => {
    if (!code) {
      setCandles([]);
      return;
    }
    const ck = `${code}|${days}`;
    const hit = cache.current.get(ck);
    if (hit) {
      setCandles(hit);
      setLoading(false);
      return;
    }

    const token = ++reqToken.current;
    setLoading(true);
    const qs = new URLSearchParams({ code, days: String(days) });
    fetch(`/api/scanner/index-ohlc?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { candles: Candle[] }) => {
        if (token !== reqToken.current) return; // superseded
        cache.current.set(ck, j.candles ?? []);
        setCandles(j.candles ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (token === reqToken.current) setLoading(false);
      });
  }, [code, days]);

  return { candles, loading };
}
