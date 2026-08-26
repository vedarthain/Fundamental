"use client";

/**
 * scannerBookmarks — dual-mode "saved spots" for the scanner's Graph and Themes
 * surfaces (server when signed in, localStorage when not).
 *
 * Each surface already auto-resumes its single LAST position (Graph via
 * er:graphNav, Themes via er:themeNav). Bookmarks are the explicit,
 * multi-slot complement: flag several interesting industries / themes and jump
 * back to any of them. A bookmark captures LOCATION + view settings only
 * (industry/theme + page + window + grid size) — not the transient filters
 * (NIFTY-500 / portfolio / watch / score), which would silently change what the
 * grid shows on restore.
 *
 * Persistence mirrors the watchlist: when signed in, the source of truth is
 * app.user_scanner_bookmark (via /api/scanner/bookmarks) so a saved spot follows
 * the user across devices. When signed out, it falls back to localStorage — the
 * original per-device behaviour. On first load while signed in, any pre-existing
 * localStorage spot is carried up to the server once so it isn't lost.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** A saved position in the Graph tab. `ind` anchors the sector; `page` is the
 *  sector-wide absolute page index (same fields the auto-resume persists). */
export type GraphBookmark = {
  id: string;
  label: string;
  ind: string;
  page: number;
  days: number;
  perPage: number;
  created: number;
};

/** A saved position in the Themes tab. */
export type ThemeBookmark = {
  id: string;
  label: string;
  code: string;
  page: number;
  days: number;
  created: number;
};

export const GRAPH_BOOKMARKS_KEY = "er:graphBookmarks:v1";
export const THEME_BOOKMARKS_KEY = "er:themeBookmarks:v1";

// One saved spot per surface — a new save overwrites the previous one.
const MAX = 1;

function loadList<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function saveList<T>(key: string, list: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore quota / unavailable storage */
  }
}

/** Short, collision-resistant id for a new bookmark. */
export function newBookmarkId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Server-side mode helpers ───────────────────────────────────────────────

/** Fetch a surface's list from the server. `signedIn: false` means the caller
 *  should use its localStorage fallback (signed out, or the request failed). */
async function fetchServer<T>(key: string): Promise<{ signedIn: boolean; items: T[] }> {
  try {
    const r = await fetch(`/api/scanner/bookmarks?key=${encodeURIComponent(key)}`, {
      credentials: "include",
    });
    if (!r.ok) return { signedIn: false, items: [] };
    const d = (await r.json()) as { signedIn?: boolean; items?: T[] };
    return { signedIn: !!d.signedIn, items: Array.isArray(d.items) ? d.items : [] };
  } catch {
    return { signedIn: false, items: [] };
  }
}

/** Replace a surface's whole list on the server (signed-in only). */
async function putServer<T>(key: string, items: T[]): Promise<void> {
  await fetch(`/api/scanner/bookmarks`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, items }),
  });
}

/** A dual-mode bookmark list for one scanner surface: server-backed and
 *  cross-device when signed in, localStorage-backed per-device when not.
 *  Reactive within the mounting component; not synced across browser tabs
 *  (single-surface use). Hydrates in an effect (not a useState initializer) to
 *  avoid an SSR/client mismatch — newest first. */
export function useBookmarks<T extends { id: string; label: string }>(key: string) {
  const [items, setItems] = useState<T[]>([]);
  // Which store the mutations write to. Decided by the single hydration fetch.
  const signedInRef = useRef(false);

  useEffect(() => {
    let alive = true;
    signedInRef.current = false;
    setItems([]);
    (async () => {
      const local = loadList<T>(key);
      const server = await fetchServer<T>(key);
      if (!alive) return;
      if (server.signedIn) {
        signedInRef.current = true;
        // One-time carry-up: if the server has nothing yet but this browser
        // holds a saved spot, push it so the user's existing bookmark survives
        // the move to server storage.
        if (server.items.length === 0 && local.length > 0) {
          putServer(key, local).catch((e) => console.error("bookmark carry-up failed", e));
          setItems(local);
        } else {
          setItems(server.items);
        }
      } else {
        signedInRef.current = false;
        setItems(local);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  const persist = useCallback(
    (next: T[]) => {
      if (signedInRef.current) {
        putServer(key, next).catch((e) => console.error("bookmark save failed", e));
      } else {
        saveList(key, next);
      }
    },
    [key],
  );

  const add = useCallback(
    (item: T) => {
      setItems((prev) => {
        const next = [item, ...prev].slice(0, MAX);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const remove = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((b) => b.id !== id);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const rename = useCallback(
    (id: string, label: string) => {
      setItems((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, label } : b));
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return { items, add, remove, rename };
}
