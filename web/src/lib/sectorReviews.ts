"use client";

/**
 * sectorReviews — "I have reviewed this sector/theme" markers for the scanner's
 * Graph and Themes rails.
 *
 * WHY THIS IS AN EXPLICIT CLICK AND NOT AUTO-ON-VIEW.
 *
 * The obvious implementation is to mark a sector reviewed when its page renders
 * (or after a dwell timer). Every version of that measures an attention PROXY,
 * not review: tapping through six sectors hunting for one marks all six; leaving
 * a tab open over lunch marks whatever was on screen.
 *
 * The errors are asymmetric in the worst direction. A false "reviewed" makes you
 * SKIP a sector you never looked at — it costs you coverage, silently, and the
 * counter reports a number you cannot trust. A false "not reviewed" costs you a
 * ten-second second glance. So the marker is set by hand: one click, and the
 * count means exactly what it says.
 *
 * This is the same principle as the coverage ledger in the ETL — a check whose
 * blind spot is the thing it exists to catch is worse than no check, because it
 * manufactures confidence.
 *
 * WHY RELATIVE AGE AND NOT A DATE.
 *
 * The question being answered is "how many sectors have I done this week", not
 * "what date did I do Financials". A row of absolute dates forces you to diff 9
 * of them against today in your head. `3d` answers it directly in two glyphs,
 * and the primary signal is not text at all — reviewed-inside-the-window rows
 * dim, so "what's left" is a visual scan with nothing to read.
 *
 * The window is a ROLLING 7 days, not a calendar week: it is self-referential,
 * so it cannot rot, and there is no Monday reset to reason about.
 *
 * Persistence mirrors scannerBookmarks exactly: server-backed and cross-device
 * when signed in (app.user_scanner_bookmark via /api/scanner/bookmarks),
 * localStorage when signed out, with a one-time carry-up on first signed-in
 * load so markers made while logged out are not lost.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** One "reviewed" marker. `id` is the sector NAME (Graph) or theme CODE
 *  (Themes) — the same stable key those rails already use for React keys and
 *  bookmarks. `label` is carried only to satisfy the shared bookmark endpoint's
 *  sanitizer, which requires {id, label} strings and is opaque beyond that. */
export type ReviewMark = {
  id: string;
  label: string;
  /** Epoch ms of the most recent time this was marked reviewed. */
  ts: number;
};

export const GRAPH_REVIEWS_KEY = "er:graphSectorReviews:v1";
export const THEME_REVIEWS_KEY = "er:themeReviews:v1";

/** Rolling review window. A marker older than this stops counting and the row
 *  returns to full contrast — the sector has come back around. */
export const REVIEW_WINDOW_DAYS = 7;

const DAY_MS = 24 * 3600 * 1000;

/** True when `ts` falls inside the rolling window. */
export function isFresh(ts: number, now: number = Date.now()): boolean {
  return now - ts < REVIEW_WINDOW_DAYS * DAY_MS;
}

/** Compact age for the inline label: "2h", "3d". Returns "" for anything that
 *  is not a usable timestamp so a corrupt entry renders as nothing rather than
 *  "NaNd". */
export function shortAge(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const ms = now - ts;
  if (ms < 0) return "now";
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return "now";
  if (h < 24) return `${h}h`;
  return `${Math.floor(ms / DAY_MS)}d`;
}

function loadList(key: string): ReviewMark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as ReviewMark[]) : [];
  } catch {
    return [];
  }
}

function saveList(key: string, list: ReviewMark[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore quota / unavailable storage */
  }
}

async function fetchServer(key: string): Promise<{ signedIn: boolean; items: ReviewMark[] }> {
  try {
    const r = await fetch(`/api/scanner/bookmarks?key=${encodeURIComponent(key)}`, {
      credentials: "include",
    });
    if (!r.ok) return { signedIn: false, items: [] };
    const d = (await r.json()) as { signedIn?: boolean; items?: ReviewMark[] };
    return { signedIn: !!d.signedIn, items: Array.isArray(d.items) ? d.items : [] };
  } catch {
    return { signedIn: false, items: [] };
  }
}

async function putServer(key: string, items: ReviewMark[]): Promise<void> {
  await fetch(`/api/scanner/bookmarks`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, items }),
  });
}

/** Drop markers that have aged out of the window. Done on every write so the
 *  stored list stays bounded by the number of sectors/themes rather than
 *  growing forever, and so a stale marker can never resurface if the clock
 *  moves. */
function prune(list: ReviewMark[], now: number): ReviewMark[] {
  return list.filter((m) => m && typeof m.id === "string" && isFresh(m.ts, now));
}

/**
 * Review markers for one scanner surface.
 *
 * Returns a `marks` map (id → epoch ms) rather than the raw array so call sites
 * do a hash lookup per row instead of scanning a list inside a render loop.
 *
 * `reviewedCount` counts only markers still inside the window, which is the
 * number the toolbar shows.
 */
export function useReviews(key: string) {
  const [items, setItems] = useState<ReviewMark[]>([]);
  const signedInRef = useRef(false);
  // Re-render hourly so "3d" ticks over and rows un-dim when they age out,
  // without the user needing to reload the page.
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3600_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    signedInRef.current = false;
    setItems([]);
    (async () => {
      const local = loadList(key);
      const server = await fetchServer(key);
      if (!alive) return;
      const t = Date.now();
      if (server.signedIn) {
        signedInRef.current = true;
        // One-time carry-up: markers made while signed out survive the move to
        // server storage.
        if (server.items.length === 0 && local.length > 0) {
          const carried = prune(local, t);
          putServer(key, carried).catch((e) => console.error("review carry-up failed", e));
          setItems(carried);
        } else {
          setItems(prune(server.items, t));
        }
      } else {
        signedInRef.current = false;
        setItems(prune(local, t));
      }
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  const persist = useCallback(
    (next: ReviewMark[]) => {
      if (signedInRef.current) {
        putServer(key, next).catch((e) => console.error("review save failed", e));
      } else {
        saveList(key, next);
      }
    },
    [key],
  );

  /** Mark reviewed if it isn't (or has aged out); clear it if it is. Re-marking
   *  an already-fresh row is the "undo" — there is no separate delete. */
  const toggle = useCallback(
    (id: string, label: string) => {
      const t = Date.now();
      setItems((prev) => {
        const fresh = prune(prev, t);
        const has = fresh.some((m) => m.id === id);
        const next = has
          ? fresh.filter((m) => m.id !== id)
          : [{ id, label, ts: t }, ...fresh];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  /** Clear every marker on this surface — the "start a fresh pass" action. */
  const clearAll = useCallback(() => {
    setItems([]);
    persist([]);
  }, [persist]);

  const marks = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) if (isFresh(it.ts, now)) m.set(it.id, it.ts);
    return m;
  }, [items, now]);

  return { marks, reviewedCount: marks.size, toggle, clearAll, now };
}
