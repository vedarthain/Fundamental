"use client";

/**
 * Starred stocks — a lightweight, local-only "pin to top" store.
 *
 * Deliberately SEPARATE from the watchlist (@/lib/watchlist): the watchlist is
 * a cross-device, auth-backed list of names you're tracking; a star here is a
 * purely-local ordering hint used by the Scanner's Graph tab to float a stock
 * to the top of its industry. No server, no auth, no sync — just localStorage
 * under `equityroots:starred:v1`, mirrored across tabs via the `storage` event.
 *
 * Same shared-store shape as useWatchlist so many StarButtons on one page read
 * one snapshot and a toggle on any button reflects on all of them at once.
 */

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "equityroots:starred:v1";

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

// ── Shared module store ────────────────────────────────────────────────

type StarState = { symbols: string[]; hydrated: boolean };

let state: StarState = { symbols: [], hydrated: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}
function setState(patch: Partial<StarState>): void {
  state = { ...state, ...patch };
  emit();
}

/** Read localStorage once, on first subscription. */
function ensureLoaded(): void {
  if (state.hydrated) return;
  setState({ symbols: readLocal(), hydrated: true });
}

function onStorage(e: StorageEvent): void {
  if (e.key !== STORAGE_KEY) return;
  setState({ symbols: readLocal() });
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

const SERVER_STATE: StarState = { symbols: [], hydrated: false };
function getSnapshot(): StarState {
  return state;
}
function getServerSnapshot(): StarState {
  return SERVER_STATE;
}

function mutateToggle(upper: string): void {
  const next = state.symbols.includes(upper)
    ? state.symbols.filter((s) => s !== upper)
    : [...state.symbols, upper];
  setState({ symbols: next });
  writeLocal(next);
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useStarred() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { symbols, hydrated } = snap;

  const isStarred = useCallback(
    (sym: string) => symbols.includes(sym.toUpperCase()),
    [symbols],
  );
  const toggle = useCallback((sym: string) => mutateToggle(sym.toUpperCase()), []);

  return { symbols, count: symbols.length, hydrated, isStarred, toggle };
}
