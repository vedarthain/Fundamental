"use client";

/**
 * useGraphReturns — precomputed 1D / 1W returns for the Graph tab's visible
 * page, fetched from /api/scanner/returns and cached per symbol.
 *
 * These are deliberately independent of the chart's chosen window: 1D/1W are
 * fixed daily/weekly moves (from the panel cache + golden), so they stay
 * populated even on the long, weekly-rolled ranges where the candle series
 * can't yield a true one-day figure. Values are fractions (0.012 = +1.2%).
 *
 * Mirrors useGraphCandles: merge-never-blank + a monotonic request token so a
 * slow reply can't overwrite a newer page.
 */
import { useEffect, useRef, useState } from "react";

export type StockReturns = { ret_1d: number | null; ret_1w: number | null };
type ReturnsMap = Record<string, StockReturns>;

export function useGraphReturns(symbols: string[]) {
  const [data, setData] = useState<ReturnsMap>({});
  const cache = useRef<Map<string, StockReturns>>(new Map());
  const reqToken = useRef(0);

  const key = symbols.join(",");

  useEffect(() => {
    const cachedFor = (): ReturnsMap => {
      const v: ReturnsMap = {};
      for (const s of symbols) {
        const hit = cache.current.get(s);
        if (hit) v[s] = hit;
      }
      return v;
    };

    const missing = symbols.filter((s) => !cache.current.has(s));
    setData((prev) => ({ ...prev, ...cachedFor() }));
    if (missing.length === 0) return;

    const token = ++reqToken.current;
    const qs = new URLSearchParams({ syms: missing.join(",") });
    fetch(`/api/scanner/returns?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { data: ReturnsMap }) => {
        if (token !== reqToken.current) return;
        for (const [s, r] of Object.entries(j.data)) cache.current.set(s, r);
        setData((prev) => ({ ...prev, ...cachedFor() }));
      })
      .catch(() => {});
    // symbols folded into `key`; array identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data };
}
