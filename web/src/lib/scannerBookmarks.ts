"use client";

/**
 * scannerBookmarks — localStorage-backed "saved spots" for the scanner's Graph
 * and Themes surfaces.
 *
 * Each surface already auto-resumes its single LAST position (Graph via
 * er:graphNav, Themes via er:themeNav). Bookmarks are the explicit,
 * multi-slot complement: flag several interesting industries / themes and jump
 * back to any of them. A bookmark captures LOCATION + view settings only
 * (industry/theme + page + window + grid size) — not the transient filters
 * (NIFTY-500 / portfolio / watch / score), which would silently change what the
 * grid shows on restore.
 *
 * Client-only, per-device (no auth) — same fallback model as the watchlist.
 */
import { useCallback, useEffect, useState } from "react";

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

/** A localStorage-backed bookmark list for one scanner surface. Reactive within
 *  the mounting component; not synced across browser tabs (single-surface use).
 *  Hydrates in an effect (not a useState initializer) to avoid an SSR/client
 *  mismatch — newest first. */
export function useBookmarks<T extends { id: string; label: string }>(key: string) {
  const [items, setItems] = useState<T[]>([]);

  useEffect(() => {
    setItems(loadList<T>(key));
  }, [key]);

  const add = useCallback(
    (item: T) => {
      setItems((prev) => {
        const next = [item, ...prev].slice(0, MAX);
        saveList(key, next);
        return next;
      });
    },
    [key],
  );

  const remove = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((b) => b.id !== id);
        saveList(key, next);
        return next;
      });
    },
    [key],
  );

  const rename = useCallback(
    (id: string, label: string) => {
      setItems((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, label } : b));
        saveList(key, next);
        return next;
      });
    },
    [key],
  );

  return { items, add, remove, rename };
}
