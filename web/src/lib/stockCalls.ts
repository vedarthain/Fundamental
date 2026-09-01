"use client";

/**
 * Stock "calls" state — a per-user, server-backed Buy/Sell conviction log.
 *
 * Unlike the watchlist (which has a signed-out localStorage fallback), a call
 * snapshots a server-side price anchor, so it is signed-in ONLY. Signed-out
 * users see the toggle in its neutral/greyed state and clicking is a no-op.
 *
 * A single module-level store is shared by every CallToggle on the page (there
 * can be dozens on the scanner grid): the first mount fetches /api/calls once,
 * all instances subscribe, and a toggle on one card reflects on all of them.
 *
 * Toggle cycle: none → Buy → Sell → none. Re-tagging (Buy→Sell) re-anchors the
 * date + price server-side (a new call), so the % move restarts from there.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { CallSide, StockCall } from "@/app/api/calls/route";

export type { CallSide, StockCall };

export type CallEntry = {
  side: CallSide;
  anchor_date: string;
  anchor_price: number;
  company_name: string | null;
  sector: string | null;
  industry: string | null;
  ltp: number | null;
  pct_move: number | null;
  cleared_at: string | null;
  cleared_price: number | null;
  cleared_pct: number | null;
};

type CallsState = {
  calls: Record<string, CallEntry>;
  hydrated: boolean;
  signedIn: boolean;
};

let state: CallsState = { calls: {}, hydrated: false, signedIn: false };
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;

function emit(): void {
  for (const l of listeners) l();
}
function setState(patch: Partial<CallsState>): void {
  state = { ...state, ...patch };
  emit();
}

/**
 * Fetch result is a three-way outcome, NOT a boolean:
 *   ok      — signed in, here are the calls.
 *   unauth  — the server explicitly said 401: genuinely signed out.
 *   error   — a 5xx / network blip: we DON'T know the auth state.
 *
 * The distinction matters: an `error` must never masquerade as "signed out",
 * or one transient hiccup greys out every toggle for a logged-in user until a
 * hard reload. Callers preserve prior state on `error`.
 */
type FetchResult =
  | { kind: "ok"; calls: StockCall[] }
  | { kind: "unauth" }
  | { kind: "error" };

async function fetchServerCalls(): Promise<FetchResult> {
  try {
    const r = await fetch("/api/calls", { credentials: "include" });
    if (r.status === 401) return { kind: "unauth" };
    if (!r.ok) return { kind: "error" };
    const data: { calls: StockCall[] } = await r.json();
    return { kind: "ok", calls: Array.isArray(data.calls) ? data.calls : [] };
  } catch {
    return { kind: "error" };
  }
}

function toRecord(list: StockCall[]): Record<string, CallEntry> {
  const rec: Record<string, CallEntry> = {};
  for (const c of list) {
    rec[c.symbol] = {
      side: c.side,
      anchor_date: c.anchor_date,
      anchor_price: c.anchor_price,
      company_name: c.company_name,
      sector: c.sector,
      industry: c.industry,
      ltp: c.ltp,
      pct_move: c.pct_move,
      cleared_at: c.cleared_at,
      cleared_price: c.cleared_price,
      cleared_pct: c.cleared_pct,
    };
  }
  return rec;
}

/** The initial server fetch. Deduped: concurrent callers share it. On a
 *  transient error we do NOT mark hydrated — the promise is released so the
 *  next mount (or a nav) retries, rather than stranding every toggle as
 *  "signed out" forever. */
function ensureLoaded(): void {
  if (state.hydrated || loadPromise) return;
  loadPromise = (async () => {
    const res = await fetchServerCalls();
    if (res.kind === "ok") {
      setState({ signedIn: true, calls: toRecord(res.calls), hydrated: true });
    } else if (res.kind === "unauth") {
      setState({ signedIn: false, calls: {}, hydrated: true });
    }
    // res.kind === "error": leave hydrated=false so a later subscribe() retries.
  })().finally(() => {
    // Release the dedupe latch. If we hydrated, ensureLoaded's early return
    // guards against a refetch; if we hit an error, the next mount tries again.
    loadPromise = null;
  });
}

/** Re-pull from the server (after a mutation) to refresh LTP + % move. A
 *  transient error preserves the current calls + signedIn — a failed refresh
 *  must never wipe a working, signed-in session. */
async function reload(): Promise<void> {
  const res = await fetchServerCalls();
  if (res.kind === "ok") {
    setState({ signedIn: true, calls: toRecord(res.calls) });
  } else if (res.kind === "unauth") {
    setState({ signedIn: false, calls: {} });
  }
  // res.kind === "error": keep existing state untouched.
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureLoaded();
  return () => {
    listeners.delete(cb);
  };
}

const SERVER_STATE: CallsState = { calls: {}, hydrated: false, signedIn: false };
function getSnapshot(): CallsState {
  return state;
}
function getServerSnapshot(): CallsState {
  return SERVER_STATE;
}

async function serverSet(symbol: string, side: CallSide): Promise<void> {
  await fetch("/api/calls", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, side }),
  });
}
/** DELETE — purge a row entirely (cancel a mis-tag / remove from history). */
async function serverDelete(symbol: string): Promise<void> {
  await fetch(`/api/calls?symbol=${encodeURIComponent(symbol)}`, {
    method: "DELETE",
    credentials: "include",
  });
}
/** PATCH — clear (close) an active call, keeping it as history. */
async function serverClearToHistory(symbol: string): Promise<void> {
  await fetch("/api/calls", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
  });
}

/** The active side for a symbol — a cleared call reads as no side (neutral). */
function activeSide(symbol: string): CallSide | null {
  const e = state.calls[symbol];
  return e && e.cleared_at == null ? e.side : null;
}

/**
 * Set a specific side, or cancel it when the same side is tapped again. This
 * powers the segmented "B | S" control: tap B → Buy, tap S → Sell, tap the
 * lit segment → back to neutral (a true DELETE — this is a quick "undo my
 * mis-tag", NOT the "I acted on it" clear-to-history, which is mutateClear).
 * Tapping a side on a *cleared* symbol reactivates it (POST re-anchors).
 */
function mutateSet(symbol: string, side: CallSide): void {
  if (!state.signedIn) return; // signed-out toggles are inert
  const cur = activeSide(symbol);
  const calls = { ...state.calls };

  if (cur === side) {
    // Tapping the already-active side cancels (purges) the call.
    delete calls[symbol];
    setState({ calls });
    serverDelete(symbol).then(reload).catch((e) => console.error("call cancel failed", e));
    return;
  }

  // Optimistic: light the tapped side now; the reload fills the real anchor.
  const prev = calls[symbol];
  calls[symbol] = {
    side,
    anchor_date: new Date().toISOString().slice(0, 10),
    anchor_price: prev?.anchor_price ?? 0,
    company_name: prev?.company_name ?? null,
    sector: prev?.sector ?? null,
    industry: prev?.industry ?? null,
    ltp: prev?.ltp ?? null,
    pct_move: 0,
    cleared_at: null,
    cleared_price: null,
    cleared_pct: null,
  };
  setState({ calls });
  serverSet(symbol, side).then(reload).catch((e) => console.error("call set failed", e));
}

/**
 * Clear a call to history ("I acted on / purchased this"). Keeps the row,
 * stamps it cleared with the exit price. Optimistically stamps cleared_at now;
 * the reload fills the real cleared_price + realized %.
 */
function mutateClear(symbol: string): void {
  if (!state.signedIn) return;
  const prev = state.calls[symbol];
  if (!prev || prev.cleared_at != null) return; // nothing active to clear
  const calls = { ...state.calls };
  calls[symbol] = {
    ...prev,
    cleared_at: new Date().toISOString(),
    cleared_price: prev.ltp,
    cleared_pct: prev.pct_move,
  };
  setState({ calls });
  serverClearToHistory(symbol).then(reload).catch((e) => console.error("call clear failed", e));
}

/** Permanently remove a row (used to purge a cleared entry from history). */
function mutateDelete(symbol: string): void {
  if (!state.signedIn) return;
  const calls = { ...state.calls };
  delete calls[symbol];
  setState({ calls });
  serverDelete(symbol).then(reload).catch((e) => console.error("call delete failed", e));
}

/** Hook: shared calls state + the toggle helper. */
export function useCalls() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { calls, hydrated, signedIn } = snap;

  const sideOf = useCallback(
    // A cleared call reads as neutral — the toggle shows no active side.
    (symbol: string): CallSide | null => {
      const e = calls[symbol.toUpperCase()];
      return e && e.cleared_at == null ? e.side : null;
    },
    [calls],
  );
  const setSide = useCallback(
    (symbol: string, side: CallSide) => mutateSet(symbol.toUpperCase(), side),
    [],
  );
  // Clear-to-history ("I acted on it") vs. permanent remove (purge from history).
  const clear = useCallback((symbol: string) => mutateClear(symbol.toUpperCase()), []);
  const remove = useCallback((symbol: string) => mutateDelete(symbol.toUpperCase()), []);

  // A materialised list for the Calls screen. Server order is preserved
  // (active first, then cleared history); the client splits on cleared_at.
  const list = Object.entries(calls).map(([symbol, e]) => ({ symbol, ...e }));

  return { calls, list, sideOf, setSide, clear, remove, hydrated, signedIn };
}
