"use client";

/**
 * useSparklineWindow — client state for the per-tab sparkline time-window toggle.
 *
 * Seeded with the server-rendered default window (so first paint needs no fetch),
 * then refetches /api/scanner/sparklines on each window change. Caches per-`days`
 * in a ref so flipping back to a window you've already viewed is instant and
 * free. While a new window loads, the OLD data stays on screen dimmed (`loading`)
 * rather than flashing to "—" — a window switch shouldn't blank the table.
 *
 * A monotonic request token guards against out-of-order responses: click 5Y then
 * quickly 1Y and the slow 5Y reply must not clobber the 1Y you actually want.
 */
import { useCallback, useRef, useState } from "react";
import type { SparkPoint } from "@/components/Sparkline";

type SparkMap = Record<string, SparkPoint[]>;

export function useSparklineWindow(symbols: string[], initialDays: number, initialData: SparkMap) {
  const [days, setDays] = useState(initialDays);
  const [data, setData] = useState<SparkMap>(initialData ?? {});
  const [loading, setLoading] = useState(false);

  // Per-`days` cache, seeded with the server-rendered default.
  const cache = useRef<Map<number, SparkMap>>(new Map([[initialDays, initialData ?? {}]]));
  const reqToken = useRef(0);
  const symsKey = symbols.join(",");

  const select = useCallback(
    (nextDays: number) => {
      if (nextDays === days) return;
      setDays(nextDays);

      const cached = cache.current.get(nextDays);
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }
      if (symbols.length === 0) {
        setData({});
        return;
      }

      const token = ++reqToken.current;
      setLoading(true);
      const qs = new URLSearchParams({ syms: symsKey, days: String(nextDays) });
      fetch(`/api/scanner/sparklines?${qs.toString()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j: { data: SparkMap }) => {
          if (token !== reqToken.current) return; // superseded — drop stale reply
          cache.current.set(nextDays, j.data);
          setData(j.data);
          setLoading(false);
        })
        .catch(() => {
          if (token !== reqToken.current) return;
          setLoading(false); // keep old data on screen; toggle just no-ops on failure
        });
    },
    [days, symbols.length, symsKey],
  );

  return { days, data, loading, select };
}
