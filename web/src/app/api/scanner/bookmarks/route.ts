/**
 * /api/scanner/bookmarks — per-user, cross-device storage for the scanner's
 * Graph/Themes "saved spot" bookmarks.
 *
 * These used to be localStorage-only (per-browser), so a spot saved on one
 * machine was invisible on another for the same signed-in user. This route
 * persists them in app.user_scanner_bookmark, keyed by (user_id, bookmark_key)
 * — the same string keys the client hook already uses. Mirrors the dual-mode
 * watchlist: signed-in users read/write the server; signed-out users fall back
 * to localStorage on the client (GET returns signedIn:false so the hook knows).
 *
 *   GET  ?key=er:graphBookmarks:v1  → { signedIn, items }
 *   PUT  { key, items }             → replace that surface's list (401 if out)
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export const runtime = "nodejs";

// Only the surface keys the client hooks use — the endpoint can't be probed to
// stash arbitrary blobs under junk keys.
//
// Two families share this route because they share a storage shape ({id,label}
// plus opaque extras) and the same dual-mode contract:
//   • *Bookmarks — saved positions (lib/scannerBookmarks.ts), one per surface.
//   • *Reviews   — "I reviewed this" markers (lib/sectorReviews.ts), one per
//     sector/theme, so the list is as long as the rail itself.
//
// The caps are PER KEY because those two are orders of magnitude apart. A
// single shared cap sized for bookmarks (20) would silently truncate the theme
// review list — there are 110 themes — and the user would see markers vanish
// with no error anywhere. Truncation that looks like success is the failure
// mode worth designing against.
const MAX_ITEMS_DEFAULT = 20;
const MAX_BYTES_DEFAULT = 8 * 1024;

const KEY_LIMITS: Record<string, { maxItems: number; maxBytes: number }> = {
  "er:graphBookmarks:v1": { maxItems: MAX_ITEMS_DEFAULT, maxBytes: MAX_BYTES_DEFAULT },
  "er:themeBookmarks:v1": { maxItems: MAX_ITEMS_DEFAULT, maxBytes: MAX_BYTES_DEFAULT },
  // 9 sectors today; headroom for reclassification.
  "er:graphSectorReviews:v1": { maxItems: 64, maxBytes: 16 * 1024 },
  // 110 themes today. 300 leaves room to grow without another migration.
  "er:themeReviews:v1": { maxItems: 300, maxBytes: 48 * 1024 },
};

const ALLOWED_KEYS = new Set(Object.keys(KEY_LIMITS));

function limitsFor(key: string) {
  return KEY_LIMITS[key] ?? { maxItems: MAX_ITEMS_DEFAULT, maxBytes: MAX_BYTES_DEFAULT };
}

type BookmarkItem = { id: string; label: string; [k: string]: unknown };

/** Keep only well-formed entries: object with string id + label. Opaque
 *  beyond that — the Graph and Themes shapes differ and the server doesn't
 *  care which view fields ride along. */
function sanitize(items: unknown, maxItems: number): BookmarkItem[] {
  if (!Array.isArray(items)) return [];
  const out: BookmarkItem[] = [];
  for (const raw of items) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const o = raw as Record<string, unknown>;
      if (typeof o.id === "string" && typeof o.label === "string") {
        out.push(o as BookmarkItem);
      }
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: "unknown bookmark key" }, { status: 400 });
  }

  const session = await getSession();
  if (!session) {
    // Not a failure — tell the client to use its localStorage fallback.
    return NextResponse.json({ signedIn: false, items: [] });
  }

  let items: BookmarkItem[] = [];
  try {
    const rows = await sql<{ payload: BookmarkItem[] }[]>`
      SELECT payload
        FROM app.user_scanner_bookmark
       WHERE user_id = ${session.userId} AND bookmark_key = ${key}
       LIMIT 1
    `;
    items = sanitize(rows[0]?.payload ?? [], limitsFor(key).maxItems);
  } catch {
    items = []; // fail-soft: client keeps whatever it has
  }
  return NextResponse.json({ signedIn: true, items });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  let body: { key?: string; items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const key = body.key ?? "";
  if (!ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: "unknown bookmark key" }, { status: 400 });
  }

  const { maxItems, maxBytes } = limitsFor(key);
  const items = sanitize(body.items, maxItems);
  const json = JSON.stringify(items);
  if (json.length > maxBytes) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  try {
    await sql`
      INSERT INTO app.user_scanner_bookmark (user_id, bookmark_key, payload, updated_at)
      VALUES (${session.userId}, ${key}, ${json}::jsonb, now())
      ON CONFLICT (user_id, bookmark_key) DO UPDATE SET
        payload = EXCLUDED.payload, updated_at = now()
    `;
  } catch {
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
  return NextResponse.json({ signedIn: true, items });
}
