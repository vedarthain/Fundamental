"use client";

/**
 * usePagedSparklines — lazy, per-page sparkline fetcher for the All-stocks table.
 *
 * Unlike the fixed-list scanner tabs (≤60 symbols fetched once), All-stocks is
 * the whole universe sorted/filtered/paged client-side, so batching every symbol
 * up front would be a monster golden query. Instead this fetches ONLY the visible
 * page's symbols at the chosen window, on demand, and caches each series by
 * `${symbol}|${days}` — so paging back or reordering re-renders instantly and
 * only ever-new (symbol, window) pairs hit the API.
 *
 * A monotonic request token drops out-of-order replies (page fast, or flip the
 * window mid-flight, and the slow reply must not overwrite the page you're on).
 */
import { useEffect, useRef, useState } from "react";
import type { SparkPoint } from "@/components/Sparkline";

type SparkMap = Record<string, SparkPoint[]>;

export function usePagedSparklines(symbols: string[], days: number) {
  const [data, setData] = useState<SparkMap>({});
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, SparkPoint[]>>(new Map());
  const reqToken = useRef(0);

  // `key` encodes the exact (page symbols, window) we need to satisfy.
  const key = `${symbols.join(",")}@${days}`;

  useEffect(() => {
    const ck = (s: string) => `${s}|${days}`;
    const viewFromCache = (): SparkMap => {
      const v: SparkMap = {};
      for (const s of symbols) {
        const hit = cache.current.get(ck(s));
        if (hit) v[s] = hit;
      }
      return v;
    };

    const missing = symbols.filter((s) => !cache.current.has(ck(s)));
    setData(viewFromCache()); // paint whatever we already have immediately

    if (missing.length === 0) {
      setLoading(false);
      return;
    }

    const token = ++reqToken.current;
    setLoading(true);
    const qs = new URLSearchParams({ syms: missing.join(","), days: String(days) });
    fetch(`/api/scanner/sparklines?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { data: SparkMap }) => {
        if (token !== reqToken.current) return; // superseded — drop stale reply
        for (const [s, series] of Object.entries(j.data)) cache.current.set(ck(s), series);
        setData(viewFromCache());
        setLoading(false);
      })
      .catch(() => {
        if (token === reqToken.current) setLoading(false);
      });
    // symbols/days are folded into `key`; depending on the array identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading };
}
