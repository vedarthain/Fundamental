"use client";

/**
 * Scanner "P" tags — a lightweight, one-tap marker on the Scanner's Graph tab,
 * dual-mode (server when signed in, localStorage when not).
 *
 * A sibling of @/lib/starred (Favourites). Same shape, same dual-mode plumbing.
 * The only difference is intent and colour: a star pins a name to watch; a "P"
 * tag flags a name as a portfolio candidate you want to eyeball on the charts.
 *
 * IMPORTANT — this is NOT the real portfolio. Actual holdings (quantity, cost
 * basis, P&L) are managed on the Portfolio tab and live in app.portfolio_holding.
 * This tag is a scanner-view marker only, so tapping it can never pollute the
 * Portfolio page with a phantom zero-quantity holding.
 *
 *   - Signed in  → source of truth is app.user_scanner_portfolio in Neon.
 *   - Signed out → localStorage `equityroots:portfolioTag:v1`, tab-synced.
 *
 * On first sign-in mergeLocalPortfolioTagIntoServer() folds any local tags in
 * (once), then clears the local key. The store also self-heals for sessions
 * that were already signed in when this shipped (see ensureLoaded).
 */

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "equityroots:portfolioTag:v1";

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

async function fetchServerTags(): Promise<{ signedIn: boolean; symbols: string[] }> {
  try {
    const r = await fetch("/api/scanner-portfolio", { credentials: "include" });
    if (!r.ok) return { signedIn: false, symbols: [] };
    const data: { signedIn: boolean; symbols: string[] } = await r.json();
    return { signedIn: !!data.signedIn, symbols: Array.isArray(data.symbols) ? data.symbols : [] };
  } catch {
    return { signedIn: false, symbols: [] };
  }
}

async function serverAdd(symbol: string): Promise<void> {
  await fetch("/api/scanner-portfolio", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
  });
}

async function serverRemove(symbol: string): Promise<void> {
  await fetch(`/api/scanner-portfolio?symbol=${encodeURIComponent(symbol)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

/**
 * One-time merge: push any localStorage tags to the server, then drop the
 * local copy. Safe to call repeatedly — a no-op when the local list is empty.
 * Call after successful login/signup.
 */
export async function mergeLocalPortfolioTagIntoServer(): Promise<void> {
  const local = readLocal();
  if (local.length === 0) return;
  try {
    await fetch("/api/scanner-portfolio", {
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

type TagState = { symbols: string[]; hydrated: boolean; signedIn: boolean };

let state: TagState = { symbols: [], hydrated: false, signedIn: false };
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;

function emit(): void {
  for (const l of listeners) l();
}
function setState(patch: Partial<TagState>): void {
  state = { ...state, ...patch };
  emit();
}

/** Fire the one-and-only server fetch. Deduped: concurrent callers share it. */
function ensureLoaded(): void {
  if (state.hydrated || loadPromise) return;
  loadPromise = (async () => {
    const { signedIn, symbols } = await fetchServerTags();

    // Self-healing merge for users already signed in when this shipped: the
    // login/signup merge only fires on the auth form, so an existing session
    // would otherwise read the empty server list and drop its local tags.
    if (signedIn) {
      const local = readLocal();
      if (local.length > 0) {
        const union = Array.from(new Set([...symbols, ...local]));
        setState({ signedIn, symbols: union, hydrated: true });
        try {
          await fetch("/api/scanner-portfolio", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbols: local }),
          });
          clearLocal();
        } catch {
          // Leave local in place so the merge retries on the next load.
        }
        return;
      }
    }

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

const SERVER_STATE: TagState = { symbols: [], hydrated: false, signedIn: false };
function getSnapshot(): TagState {
  return state;
}
function getServerSnapshot(): TagState {
  return SERVER_STATE;
}

function mutateToggle(upper: string): void {
  const has = state.symbols.includes(upper);
  const next = has ? state.symbols.filter((s) => s !== upper) : [...state.symbols, upper];
  setState({ symbols: next });
  if (state.signedIn) {
    const p = has ? serverRemove(upper) : serverAdd(upper);
    p.catch((e) => console.error("portfolio tag toggle failed", e));
  } else {
    writeLocal(next);
  }
}

// ── Hook ───────────────────────────────────────────────────────────────

export function usePortfolioTag() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { symbols, hydrated, signedIn } = snap;

  const isTagged = useCallback(
    (sym: string) => symbols.includes(sym.toUpperCase()),
    [symbols],
  );
  const toggle = useCallback((sym: string) => mutateToggle(sym.toUpperCase()), []);

  return { symbols, count: symbols.length, hydrated, signedIn, isTagged, toggle };
}
