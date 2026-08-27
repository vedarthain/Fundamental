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

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "equityroots:watchlist:v1";
const MAX_SYMBOLS = 1000;

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
  const r = await fetch("/api/watchlist", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
  });
  // Throw on non-2xx (esp. 401 when the session has silently expired) so the
  // caller can fall back to localStorage instead of silently dropping the add.
  if (!r.ok) throw new Error(`watchlist add failed: ${r.status}`);
}

async function serverRemove(symbol: string): Promise<void> {
  const r = await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!r.ok) throw new Error(`watchlist remove failed: ${r.status}`);
}

/**
 * Persist a free-text note for a watched symbol (signed-in only — the note
 * lives on the server watchlist row). Fire-and-forget from the caller's view;
 * returns the saved value (server trims + caps it) or throws on a hard failure
 * so the UI can surface a retry. Signed-out callers get a 401 and should not
 * call this (the note editor is hidden when signed out).
 */
export async function saveWatchlistNote(symbol: string, note: string): Promise<void> {
  const r = await fetch("/api/watchlist", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: symbol.toUpperCase(), note }),
  });
  if (!r.ok) throw new Error(`note save failed: ${r.status}`);
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

/**
 * One-time carry-over from the retired Scanner "Favourites" store. Stars used
 * to live under `equityroots:starred:v1` (see the deleted @/lib/starred). Now
 * that starring == watching, fold any leftover local stars into the watchlist
 * and drop the old key. Server-side favourites are migrated by db migration
 * 0054; this only rescues symbols a signed-out browser had starred locally.
 * Safe to call repeatedly — a no-op once the old key is gone.
 */
const LEGACY_STARRED_KEY = "equityroots:starred:v1";
export async function mergeLegacyStarredIntoWatchlist(): Promise<void> {
  if (typeof window === "undefined") return;
  let legacy: string[] = [];
  try {
    const raw = window.localStorage.getItem(LEGACY_STARRED_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) legacy = parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return;
  }
  if (legacy.length === 0) {
    try { window.localStorage.removeItem(LEGACY_STARRED_KEY); } catch { /* ignore */ }
    return;
  }
  try {
    await fetch("/api/watchlist", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: legacy }),
    });
    window.localStorage.removeItem(LEGACY_STARRED_KEY);
  } catch {
    // Leave the legacy key in place so the carry-over retries next sign-in.
  }
}

// ── Shared store ───────────────────────────────────────────────────────
//
// Every WatchlistButton (there can be dozens on the scanner) used to call
// useWatchlist independently, and each instance fired its OWN /api/watchlist
// request on mount — N identical DB-backed round-trips per page, and the
// heart only filled once each button's own fetch resolved.
//
// This module-level store collapses that to a SINGLE fetch shared by all
// hook instances: the first mount kicks off `ensureLoaded()`, subsequent
// mounts reuse the same in-flight promise (or the already-loaded state).
// Mutations update the shared snapshot and notify every subscriber, so a
// heart toggled on one button reflects on all of them immediately — which
// also fixes the previous cross-component desync.

type WatchState = { symbols: string[]; hydrated: boolean; signedIn: boolean };

let state: WatchState = { symbols: [], hydrated: false, signedIn: false };
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function setState(patch: Partial<WatchState>): void {
  state = { ...state, ...patch };
  emit();
}

/** Fire the one-and-only server fetch. Deduped: concurrent callers share it. */
function ensureLoaded(): void {
  if (state.hydrated || loadPromise) return;
  loadPromise = (async () => {
    const { signedIn, symbols } = await fetchServerWatchlist();
    if (!signedIn) {
      setState({ signedIn: false, symbols: readLocal(), hydrated: true });
      return;
    }
    // Signed in: the server list is authoritative. But self-heal any leftover
    // localStorage symbols — these get stranded when a session silently expires
    // mid-session (adds then fall back to localStorage) and no fresh login fires
    // the one-time merge. Reconcile on EVERY signed-in load so the list can
    // never drift out of the DB again. ON CONFLICT DO NOTHING server-side makes
    // re-pushing already-saved names harmless.
    const local = readLocal();
    let merged = symbols;
    if (local.length > 0) {
      await mergeLocalWatchlistIntoServer(); // POSTs local, clears the key on success
      merged = Array.from(new Set([...symbols, ...local])).slice(0, MAX_SYMBOLS);
    }
    setState({ signedIn: true, symbols: merged, hydrated: true });
  })();
}

// Signed-out cross-tab sync: mirror localStorage writes into the store.
// One shared handler, attached while any subscriber is mounted.
function onStorage(e: StorageEvent): void {
  if (e.key !== STORAGE_KEY) return;
  if (!state.signedIn) setState({ symbols: readLocal() });
}

function subscribe(cb: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(cb);
  ensureLoaded();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

// Server snapshot: the store is inert during SSR, so return a stable empty.
const SERVER_STATE: WatchState = { symbols: [], hydrated: false, signedIn: false };
function getSnapshot(): WatchState {
  return state;
}
function getServerSnapshot(): WatchState {
  return SERVER_STATE;
}

// ── Mutations (operate on the shared store) ────────────────────────────

function mutateAdd(upper: string): void {
  if (state.symbols.includes(upper)) return;
  const next = [...state.symbols, upper].slice(0, MAX_SYMBOLS);
  setState({ symbols: next });
  if (state.signedIn) {
    serverAdd(upper).catch((e) => {
      console.error("watchlist add failed", e);
      // Session likely died — stash the symbol in localStorage so the next
      // signed-in load (ensureLoaded) merges it back onto the server instead of
      // silently losing it. This is the exact hole that stranded a full list.
      writeLocal(Array.from(new Set([...readLocal(), upper])).slice(0, MAX_SYMBOLS));
    });
  } else {
    writeLocal(next);
  }
}

function mutateRemove(upper: string): void {
  if (!state.symbols.includes(upper)) return;
  const next = state.symbols.filter((s) => s !== upper);
  setState({ symbols: next });
  if (state.signedIn) serverRemove(upper).catch((e) => console.error("watchlist remove failed", e));
  else writeLocal(next);
}

// ── Hook ───────────────────────────────────────────────────────────────

/**
 * Hook: returns the current watchlist + mutation helpers.
 *
 * All instances share one module-level store (see above), so the server is
 * hit exactly once per page load regardless of how many buttons render.
 * Mode (server vs local) is decided by that single /api/watchlist call.
 */
export function useWatchlist() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { symbols, hydrated, signedIn } = snap;

  const isWatched = useCallback(
    (sym: string) => symbols.includes(sym.toUpperCase()),
    [symbols],
  );

  const add = useCallback((sym: string) => mutateAdd(sym.toUpperCase()), []);
  const remove = useCallback((sym: string) => mutateRemove(sym.toUpperCase()), []);
  const toggle = useCallback((sym: string) => {
    const upper = sym.toUpperCase();
    if (state.symbols.includes(upper)) mutateRemove(upper);
    else mutateAdd(upper);
  }, []);

  const set = useCallback((next: string[]) => {
    const deduped = Array.from(new Set(next.map((s) => s.toUpperCase()))).slice(0, MAX_SYMBOLS);
    setState({ symbols: deduped });
    if (!state.signedIn) writeLocal(deduped);
    // No bulk-replace endpoint server-side; v1 doesn't need it.
  }, []);

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
