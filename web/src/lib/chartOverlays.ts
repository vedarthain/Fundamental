"use client";

/**
 * Shared read-only chart overlays — so the lines a user draws (or the price
 * alerts they arm) in the scanner Graph tab render on EVERY CandleChart across
 * the app (watchlist detail, alerts screen, …), not just the Graph tab.
 *
 * Two sources, both keyed by symbol:
 *   - Drawings  — hlines + trend lines, persisted in localStorage by GraphClient
 *                 (key "er:chartDrawings:v1"). Price/date-anchored, so they
 *                 re-project onto any timeframe or chart size.
 *   - Alert lines — server-backed price alerts (/api/alerts/price), drawn as
 *                 green (armed) / orange (triggered) rules.
 *
 * These hooks are DISPLAY-ONLY: editing still happens on the Graph tab (which
 * owns the toolbar + persistence). Everyone else just reflects the same state.
 */
import { useCallback, useEffect, useState } from "react";
import type { Drawing, AlertLine } from "@/app/tools/scanner/CandleChart";
import type { PriceAlert } from "@/lib/price-alerts";

const DRAW_KEY = "er:chartDrawings:v1";
const EMPTY_DRAWINGS: Drawing[] = [];
const EMPTY_LINES: AlertLine[] = [];

/**
 * Per-symbol chart drawings from localStorage. Updates on cross-tab `storage`
 * events and a same-tab `er:chartDrawings` custom event (dispatched by the Graph
 * tab when it writes), so a line drawn there shows elsewhere without a reload.
 * Returns a stable getter: `getDrawings(symbol) → Drawing[]`.
 */
export function useChartDrawings(): (symbol: string) => Drawing[] {
  const [map, setMap] = useState<Record<string, Drawing[]>>({});

  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(DRAW_KEY);
        setMap(raw ? (JSON.parse(raw) as Record<string, Drawing[]>) : {});
      } catch {
        /* ignore corrupt/unavailable storage */
      }
    };
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === DRAW_KEY) read();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("er:chartDrawings", read);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("er:chartDrawings", read);
    };
  }, []);

  return useCallback((symbol: string) => map[symbol] ?? EMPTY_DRAWINGS, [map]);
}

// Module-level cache so many charts mounting at once (a watchlist of expanded
// rows) share a single /api/alerts/price round-trip.
let alertsCache: Record<string, AlertLine[]> | null = null;
let alertsPromise: Promise<Record<string, AlertLine[]>> | null = null;

function loadAlertLines(): Promise<Record<string, AlertLine[]>> {
  if (alertsCache) return Promise.resolve(alertsCache);
  if (!alertsPromise) {
    alertsPromise = fetch("/api/alerts/price")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { alerts?: PriceAlert[] } | null) => {
        const m: Record<string, AlertLine[]> = {};
        for (const a of j?.alerts ?? []) {
          (m[a.symbol] ??= []).push({ price: a.price, status: a.status });
        }
        alertsCache = m;
        return m;
      })
      .catch(() => ({}) as Record<string, AlertLine[]>);
  }
  return alertsPromise;
}

/**
 * Per-symbol armed/triggered price-alert lines from the server. Cached across
 * mounts. Returns a stable getter: `getAlertLines(symbol) → AlertLine[]`.
 */
export function usePriceAlertLines(): (symbol: string) => AlertLine[] {
  const [by, setBy] = useState<Record<string, AlertLine[]>>(alertsCache ?? {});

  useEffect(() => {
    let alive = true;
    loadAlertLines().then((m) => {
      if (alive) setBy(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  return useCallback((symbol: string) => by[symbol] ?? EMPTY_LINES, [by]);
}
