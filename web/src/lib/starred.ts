"use client";

/**
 * Starred stocks — the Scanner's "Favourites", dual-mode (server when signed
 * in, localStorage when not).
 *
 * A star floats a stock to the top of its industry on the Scanner's Graph tab.
 * It used to be purely local (localStorage `equityroots:starred:v1`), so stars
 * were trapped in one browser — sign in elsewhere and they were gone.
 *
 * Now:
 *   - Signed in  → source of truth is app.user_scanner_favourite in Neon.
 *     toggle hits /api/scanner-favourites; the local cache mirrors but is
 *     never authoritative. Favourites follow the user across devices.
 *   - Signed out → falls back to localStorage `equityroots:starred:v1`
 *     (the original pre-auth behaviour), mirrored across tabs via `storage`.
 *
 * On first sign-in (login or signup) mergeLocalStarredIntoServer() POSTs any
 * local stars to the server and clears the local key — a one-time migration.
 *
 * Deliberately SEPARATE from the watchlist (@/lib/watchlist): a star is a
 * scanner-ordering preference; a watch is a tracked name with cost-basis +
 * notes. Same shared-store shape though, so many StarButtons on one page read
 * one snapshot and one fetch hits the server per page load.
 */

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "equityroots:starred:v1";

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

async function fetchServerStarred(): Promise<{ signedIn: boolean; symbols: string[] }> {
  try {
    const r = await fetch("/api/scanner-favourites", { credentials: "include" });
    if (!r.ok) return { signedIn: false, symbols: [] };
    const data: { signedIn: boolean; symbols: string[] } = await r.json();
    return { signedIn: !!data.signedIn, symbols: Array.isArray(data.symbols) ? data.symbols : [] };
  } catch {
    return { signedIn: false, symbols: [] };
  }
}

async function serverAdd(symbol: string): Promise<void> {
  await fetch("/api/scanner-favourites", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
  });
}

async function serverRemove(symbol: string): Promise<void> {
  await fetch(`/api/scanner-favourites?symbol=${encodeURIComponent(symbol)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

/**
 * One-time merge: push any localStorage stars to the server, then drop the
 * local copy. Safe to call repeatedly — a no-op when the local list is empty.
 * Call after successful login/signup.
 */
export async function mergeLocalStarredIntoServer(): Promise<void> {
  const local = readLocal();
  if (local.length === 0) return;
  try {
    await fetch("/api/scanner-favourites", {
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

// ── Shared module store ────────────────────────────────────────────────
//
// One module-level store shared by every StarButton: the first mount fires a
// single /api/scanner-favourites fetch (deduped), subsequent mounts reuse it,
// and a toggle on any button reflects on all of them at once.

type StarState = { symbols: string[]; hydrated: boolean; signedIn: boolean };

let state: StarState = { symbols: [], hydrated: false, signedIn: false };
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;

function emit(): void {
  for (const l of listeners) l();
}
function setState(patch: Partial<StarState>): void {
  state = { ...state, ...patch };
  emit();
}

/** Fire the one-and-only server fetch. Deduped: concurrent callers share it. */
function ensureLoaded(): void {
  if (state.hydrated || loadPromise) return;
  loadPromise = (async () => {
    const { signedIn, symbols } = await fetchServerStarred();
    setState({
      signedIn,
      symbols: signedIn ? symbols : readLocal(),
      hydrated: true,
    });
  })();
}

// Signed-out cross-tab sync: mirror localStorage writes into the store.
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

const SERVER_STATE: StarState = { symbols: [], hydrated: false, signedIn: false };
function getSnapshot(): StarState {
  return state;
}
function getServerSnapshot(): StarState {
  return SERVER_STATE;
}

function mutateToggle(upper: string): void {
  const has = state.symbols.includes(upper);
  const next = has ? state.symbols.filter((s) => s !== upper) : [...state.symbols, upper];
  setState({ symbols: next });
  if (state.signedIn) {
    const p = has ? serverRemove(upper) : serverAdd(upper);
    p.catch((e) => console.error("starred toggle failed", e));
  } else {
    writeLocal(next);
  }
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useStarred() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { symbols, hydrated, signedIn } = snap;

  const isStarred = useCallback(
    (sym: string) => symbols.includes(sym.toUpperCase()),
    [symbols],
  );
  const toggle = useCallback((sym: string) => mutateToggle(sym.toUpperCase()), []);

  return { symbols, count: symbols.length, hydrated, signedIn, isStarred, toggle };
}
