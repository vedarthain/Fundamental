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

// Per-tab cache so a page with five components doesn't make five /me calls.
declare global {
  var __er_session_cache: { user: SessionUser | null; fetchedAt: number } | undefined;
}
const SESSION_CHANGED = "er-session-changed";

async function fetchMe(): Promise<SessionUser | null> {
  try {
    const r = await fetch("/api/auth/me", { credentials: "include" });
    if (!r.ok) return null;
    const data: { user: SessionUser | null } = await r.json();
    return data.user;
  } catch {
    return null;
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
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const u = await fetchMe();
    globalThis.__er_session_cache = { user: u, fetchedAt: Date.now() };
    setUser(u);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Use cache if it's fresh (<60s). Cheap-out for repeated mounts on
    // navigation within the same SPA session.
    const cached = globalThis.__er_session_cache;
    if (cached && Date.now() - cached.fetchedAt < 60_000) {
      setUser(cached.user);
      setLoading(false);
    } else {
      refresh();
    }

    const onChange = () => refresh();
    window.addEventListener(SESSION_CHANGED, onChange);
    return () => window.removeEventListener(SESSION_CHANGED, onChange);
  }, [refresh]);

  return { user, loading, refresh };
}
