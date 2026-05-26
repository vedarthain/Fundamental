"use client";

/**
 * Watchlist state — dual-mode (server when signed in, localStorage when not).
 *
 * When the user is signed in: the source of truth is app.user_watchlist in
 * Neon. add/remove/toggle hit /api/watchlist; the local cache is kept in
 * sync but never authoritative. The list follows the user across devices.
 *
 * When the user is signed out: falls back to localStorage under the key
 * `equityroots:watchlist:v1` — the original pre-auth behaviour. This lets
 * anonymous visitors still use the WatchlistButton on /stock pages.
 *
 * On first sign-in (login or signup), we call mergeLocalWatchlistIntoServer
 * which POSTs any local symbols to the server and clears the local key.
 * One-time migration — never runs again for that browser.
 *
 * Cross-tab sync (signed-out mode): `storage` event.
 * Cross-tab sync (signed-in mode): not implemented yet — opening the
 * watchlist in two tabs and adding in one won't update the other until
 * a refresh. Acceptable for v1; can add via BroadcastChannel later.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "equityroots:watchlist:v1";
const MAX_SYMBOLS = 100;

// ── localStorage helpers ───────────────────────────────────────────────

function readLocal(): string[] {
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

function writeLocal(syms: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(syms));
  } catch {
    // Quota errors etc. — silently no-op.
  }
}

function clearLocal(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ── Server-side mode helpers ───────────────────────────────────────────

async function fetchServerWatchlist(): Promise<{ signedIn: boolean; symbols: string[] }> {
  try {
    const r = await fetch("/api/watchlist", { credentials: "include" });
    if (!r.ok) return { signedIn: false, symbols: [] };
    const data: { signedIn: boolean; symbols: string[] } = await r.json();
    return { signedIn: !!data.signedIn, symbols: Array.isArray(data.symbols) ? data.symbols : [] };
  } catch {
    return { signedIn: false, symbols: [] };
  }
}

async function serverAdd(symbol: string): Promise<void> {
  await fetch("/api/watchlist", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
  });
}

async function serverRemove(symbol: string): Promise<void> {
  await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

/**
 * One-time merge: push any localStorage symbols to the server, then drop
 * the local copy. Safe to call repeatedly — if the local list is empty
 * this is a no-op. Call after successful login/signup.
 */
export async function mergeLocalWatchlistIntoServer(): Promise<void> {
  const local = readLocal();
  if (local.length === 0) return;
  try {
    await fetch("/api/watchlist", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: local }),
    });
    clearLocal();
  } catch {
    // Leave the local copy in place so the merge can retry next sign-in.
  }
}

// ── Hook ───────────────────────────────────────────────────────────────

/**
 * Hook: returns the current watchlist + mutation helpers.
 *
 * Mode (server vs local) is decided by the first /api/watchlist call on
 * mount, which also reports signedIn=true|false. From then on, mutations
 * are routed to the correct backend.
 */
export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { signedIn: si, symbols: serverSyms } = await fetchServerWatchlist();
      if (cancelled) return;
      if (si) {
        setSignedIn(true);
        setSymbols(serverSyms);
      } else {
        setSignedIn(false);
        setSymbols(readLocal());
      }
      setHydrated(true);
    })();

    const onStorage = (e: StorageEvent) => {
      // Only relevant for signed-out mode. Signed-in mode ignores
      // localStorage writes.
      if (e.key !== STORAGE_KEY) return;
      if (!signedIn) setSymbols(readLocal());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
    // We intentionally only run this on mount. signedIn changes are driven
    // by the broadcastSessionChange flow which triggers a page navigation,
    // remounting the hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isWatched = useCallback(
    (sym: string) => symbols.includes(sym.toUpperCase()),
    [symbols],
  );

  const add = useCallback(
    (sym: string) => {
      const upper = sym.toUpperCase();
      setSymbols((prev) => {
        if (prev.includes(upper)) return prev;
        const next = [...prev, upper].slice(0, MAX_SYMBOLS);
        if (signedIn) {
          serverAdd(upper).catch((e) => console.error("watchlist add failed", e));
        } else {
          writeLocal(next);
        }
        return next;
      });
    },
    [signedIn],
  );

  const remove = useCallback(
    (sym: string) => {
      const upper = sym.toUpperCase();
      setSymbols((prev) => {
        if (!prev.includes(upper)) return prev;
        const next = prev.filter((s) => s !== upper);
        if (signedIn) {
          serverRemove(upper).catch((e) => console.error("watchlist remove failed", e));
        } else {
          writeLocal(next);
        }
        return next;
      });
    },
    [signedIn],
  );

  const toggle = useCallback(
    (sym: string) => {
      const upper = sym.toUpperCase();
      setSymbols((prev) => {
        const has = prev.includes(upper);
        const next = has ? prev.filter((s) => s !== upper) : [...prev, upper].slice(0, MAX_SYMBOLS);
        if (signedIn) {
          (has ? serverRemove(upper) : serverAdd(upper)).catch((e) =>
            console.error("watchlist toggle failed", e),
          );
        } else {
          writeLocal(next);
        }
        return next;
      });
    },
    [signedIn],
  );

  const set = useCallback(
    (next: string[]) => {
      const deduped = Array.from(new Set(next.map((s) => s.toUpperCase()))).slice(0, MAX_SYMBOLS);
      setSymbols(deduped);
      if (!signedIn) writeLocal(deduped);
      // No bulk-replace endpoint server-side; v1 doesn't need it.
    },
    [signedIn],
  );

  return {
    symbols,
    count: symbols.length,
    hydrated,
    signedIn,
    isWatched,
    add,
    remove,
    toggle,
    set,
    isFull: symbols.length >= MAX_SYMBOLS,
    maxSize: MAX_SYMBOLS,
  };
}
