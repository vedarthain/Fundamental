"use client";

/**
 * Watchlist state — localStorage-backed list of stock symbols the current
 * device's user has saved.
 *
 * Stored as a JSON array of bare NSE symbols (no .NS suffix) under the key
 * `equityroots:watchlist:v1`. The version suffix lets us evolve the shape
 * later (add metadata, multiple watchlists, etc.) without bricking old
 * stored state.
 *
 * Cross-tab sync via the `storage` event so adding a stock in one tab
 * updates the badge count + watchlist page in any other open tab.
 *
 * Zero server impact: no Neon writes, no API calls.  When auth lands later,
 * we'll add a one-time "sync localStorage → DB on first login" path so
 * users don't lose their pre-login watchlists.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "equityroots:watchlist:v1";
const MAX_SYMBOLS = 100;  // soft cap; UI prevents adding more

function readStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

function writeStorage(syms: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(syms));
  } catch {
    // Quota errors etc. — silently no-op; UI will show "couldn't save"
    // through a toast in a follow-up.
  }
}

/**
 * Hook: returns the current watchlist + mutation helpers.  Auto-syncs across
 * tabs via the `storage` event. Symbol names are normalised to uppercase.
 */
export function useWatchlist() {
  // On the server (SSR), watchlist is empty.  After mount we hydrate from
  // localStorage. This avoids hydration mismatch warnings.
  const [symbols, setSymbols] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSymbols(readStorage());
    setHydrated(true);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setSymbols(readStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const set = useCallback((next: string[]) => {
    const deduped = Array.from(new Set(next.map((s) => s.toUpperCase()))).slice(0, MAX_SYMBOLS);
    setSymbols(deduped);
    writeStorage(deduped);
  }, []);

  const isWatched = useCallback(
    (sym: string) => symbols.includes(sym.toUpperCase()),
    [symbols],
  );

  const add = useCallback((sym: string) => {
    const upper = sym.toUpperCase();
    setSymbols((prev) => {
      if (prev.includes(upper)) return prev;
      const next = [...prev, upper].slice(0, MAX_SYMBOLS);
      writeStorage(next);
      return next;
    });
  }, []);

  const remove = useCallback((sym: string) => {
    const upper = sym.toUpperCase();
    setSymbols((prev) => {
      if (!prev.includes(upper)) return prev;
      const next = prev.filter((s) => s !== upper);
      writeStorage(next);
      return next;
    });
  }, []);

  const toggle = useCallback((sym: string) => {
    const upper = sym.toUpperCase();
    setSymbols((prev) => {
      const next = prev.includes(upper)
        ? prev.filter((s) => s !== upper)
        : [...prev, upper].slice(0, MAX_SYMBOLS);
      writeStorage(next);
      return next;
    });
  }, []);

  return {
    symbols,
    count: symbols.length,
    hydrated,        // false during SSR + briefly on mount; UI can show skeleton
    isWatched,
    add,
    remove,
    toggle,
    set,
    isFull: symbols.length >= MAX_SYMBOLS,
    maxSize: MAX_SYMBOLS,
  };
}
