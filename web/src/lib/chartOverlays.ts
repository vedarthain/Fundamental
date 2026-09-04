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
import type { ChartPriceAlert } from "@/components/PriceChart";

const DRAW_KEY = "er:chartDrawings:v1";
const EMPTY_DRAWINGS: Drawing[] = [];
const EMPTY_LINES: AlertLine[] = [];
const EMPTY_ALERTS: ChartPriceAlert[] = [];
// Fired (same-tab) after a price alert is created/deleted so every mounted
// chart re-reads its lines without a full server round-trip.
const ALERTS_EVENT = "er:priceAlerts";

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
    const read = () => loadAlertLines().then((m) => alive && setBy(m));
    read();
    // Re-read when any chart mutates alerts (create/delete dispatches this).
    window.addEventListener(ALERTS_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(ALERTS_EVENT, read);
    };
  }, []);

  return useCallback((symbol: string) => by[symbol] ?? EMPTY_LINES, [by]);
}

// ── Full price alerts (with id) — for charts that CREATE/DELETE them ─────────
// usePriceAlertLines is display-only (price + status). A chart that lets the
// user add/remove alerts needs the row id too, so it uses this hook instead.
// Shares one /api/alerts/price round-trip across mounts, same as the lines.
let fullCache: Record<string, ChartPriceAlert[]> | null = null;
let fullPromise: Promise<Record<string, ChartPriceAlert[]>> | null = null;

function loadFullAlerts(): Promise<Record<string, ChartPriceAlert[]>> {
  if (fullCache) return Promise.resolve(fullCache);
  if (!fullPromise) {
    fullPromise = fetch("/api/alerts/price")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { alerts?: PriceAlert[] } | null) => {
        const m: Record<string, ChartPriceAlert[]> = {};
        for (const a of j?.alerts ?? []) {
          (m[a.symbol] ??= []).push({
            id: a.id,
            price: a.price,
            direction: a.direction,
            status: a.status,
          });
        }
        fullCache = m;
        return m;
      })
      .catch(() => ({}) as Record<string, ChartPriceAlert[]>);
  }
  return fullPromise;
}

/**
 * Invalidate every cached view of the user's price alerts and notify all
 * mounted chart hooks to re-read. Call after a successful create/delete so the
 * armed/triggered lines update app-wide without a server refresh.
 */
export function refreshPriceAlerts(): void {
  alertsCache = null;
  alertsPromise = null;
  fullCache = null;
  fullPromise = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ALERTS_EVENT));
}

/**
 * Per-symbol price alerts WITH ids, plus a `refresh()` to re-sync after a
 * mutation. `enabled=false` skips the fetch (e.g. a chart that already receives
 * alerts as a server prop). Getter is stable: `get(symbol) → ChartPriceAlert[]`.
 */
export function usePriceAlerts(enabled = true): {
  get: (symbol: string) => ChartPriceAlert[];
  refresh: () => void;
} {
  const [by, setBy] = useState<Record<string, ChartPriceAlert[]>>(fullCache ?? {});

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const read = () => loadFullAlerts().then((m) => alive && setBy(m));
    read();
    window.addEventListener(ALERTS_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(ALERTS_EVENT, read);
    };
  }, [enabled]);

  const get = useCallback((symbol: string) => by[symbol] ?? EMPTY_ALERTS, [by]);
  return { get, refresh: refreshPriceAlerts };
}
