"use client";

/**
 * Client-side session hook.
 *
 * Calls /api/auth/me once on mount, caches the result on globalThis so
 * subsequent components in the same tab share the lookup. Re-fetches when
 * the user signs in or out (we fire a custom event that all hook
 * instances listen for).
 *
 * SSR returns { user: null, loading: true } — components should treat
 * `loading` as "don't decide yet" so they don't flash a "Sign in" link to
 * an authenticated user.
 */

import { useCallback, useEffect, useState } from "react";

type SessionUser = {
  id: number;
  email: string;
  displayName: string | null;
};

type SessionState = { user: SessionUser | null; isAdmin: boolean };

// Per-tab cache so a page with five components doesn't make five /me calls.
declare global {
  var __er_session_cache: { state: SessionState; fetchedAt: number } | undefined;
}
const SESSION_CHANGED = "er-session-changed";

async function fetchMe(): Promise<SessionState> {
  try {
    const r = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    if (!r.ok) return { user: null, isAdmin: false };
    const data: { user: SessionUser | null; isAdmin?: boolean } = await r.json();
    return { user: data.user ?? null, isAdmin: !!data.isAdmin };
  } catch {
    return { user: null, isAdmin: false };
  }
}

/** Notify all useSession() instances that the session changed. Call after
 *  login, signup, or logout to make the nav reflect the new state. */
export function broadcastSessionChange() {
  if (typeof window === "undefined") return;
  globalThis.__er_session_cache = undefined;
  window.dispatchEvent(new Event(SESSION_CHANGED));
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ user: null, isAdmin: false });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await fetchMe();
    globalThis.__er_session_cache = { state: s, fetchedAt: Date.now() };
    setState(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Use cache if it's fresh (<60s). Cheap-out for repeated mounts on
    // navigation within the same SPA session.
    const cached = globalThis.__er_session_cache;
    if (cached && Date.now() - cached.fetchedAt < 60_000) {
      setState(cached.state);
      setLoading(false);
    } else {
      refresh();
    }

    const onChange = () => refresh();
    window.addEventListener(SESSION_CHANGED, onChange);
    return () => window.removeEventListener(SESSION_CHANGED, onChange);
  }, [refresh]);

  return { user: state.user, isAdmin: state.isAdmin, loading, refresh };
}
