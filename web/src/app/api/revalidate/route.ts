/**
 * POST /api/revalidate — purge Vercel's Data Cache for one or more tags.
 *
 * Called from the daily refresh-ltp GitHub Action AFTER it has written
 * fresh prices to Neon. Without this hop, /sectors and similar pages
 * keep serving the previous day's cached HTML/data for up to 24h.
 *
 * Auth: a bearer token compared against REVALIDATE_TOKEN.  Cheap and
 * sufficient — the only damage someone could do with a stolen token is
 * make us re-render a page (cost ≈ one Neon read).  Not worth the
 * complexity of signed requests.
 *
 * Body: { tags?: string[], paths?: string[] }
 *   - tags  — tags attached to unstable_cache() calls
 *   - paths — explicit URL paths (e.g. "/sectors")
 * If neither is passed, defaults to purging the "sectors" + "panel-cache"
 * tags (the daily ETL's natural target).
 *
 * Returns: { ok: true, revalidated: { tags, paths } }
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "crypto";
import { revalidateTag, revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TAGS = ["sectors", "panel-cache"];

type AuthDiag =
  | { ok: true }
  | { ok: false; reason: "no-env"; expectedLen: 0 }
  | { ok: false; reason: "no-token"; expectedLen: number }
  | { ok: false; reason: "length-mismatch"; expectedLen: number; givenLen: number }
  | { ok: false; reason: "value-mismatch"; expectedLen: number; givenLen: number };

function authCheck(req: NextRequest): AuthDiag {
  const expected = process.env.REVALIDATE_TOKEN;
  if (!expected) return { ok: false, reason: "no-env", expectedLen: 0 };
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const given = m?.[1] ?? req.nextUrl.searchParams.get("token") ?? "";
  if (!given) return { ok: false, reason: "no-token", expectedLen: expected.length };
  if (given.length !== expected.length) {
    return {
      ok: false,
      reason: "length-mismatch",
      expectedLen: expected.length,
      givenLen: given.length,
    };
  }
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) {
    return {
      ok: false,
      reason: "value-mismatch",
      expectedLen: expected.length,
      givenLen: given.length,
    };
  }
  return { ok: true };
}

function authOk(req: NextRequest): boolean {
  return authCheck(req).ok;
}

/**
 * Admin-cookie fallback for the in-app "Purge cache" button rendered
 * inside UserMenu.  Validates the er_admin cookie against
 * SHA-256(ADMIN_TOKEN) — same scheme as /admin/upstox + /admin/ideas.
 *
 * Why a second auth path: the in-app button can't carry a bearer token
 * (Vercel-side secret, not exposed to the browser), so we trust the
 * admin cookie instead.  Bearer-token path stays as the canonical
 * machine-to-machine auth used by the GH Actions.
 */
async function adminCookieOk(): Promise<boolean> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const c = await cookies();
  const cookieVal = c.get("er_admin")?.value;
  if (!cookieVal) return false;
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  const a = Buffer.from(cookieVal, "utf8");
  const b = Buffer.from(expectedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  // Either the bearer-token path (GH Actions / curl) or the admin
  // cookie path (in-app "Purge cache" button) is sufficient.
  if (!authOk(req) && !(await adminCookieOk())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { tags?: unknown; paths?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string" && t.length <= 64)
    : DEFAULT_TAGS;
  const paths = Array.isArray(body.paths)
    ? body.paths.filter((p): p is string => typeof p === "string" && p.startsWith("/") && p.length <= 200)
    : [];

  // Next.js 16 requires a cache-life profile as the second arg.
  // "default" matches the profile used by our unstable_cache calls.
  for (const t of tags) revalidateTag(t, "default");
  // "page" type vs "layout" — for our routes a page-level rebuild is what
  // we want.  Next.js 16 made the second arg required.
  for (const p of paths) revalidatePath(p, "page");

  return NextResponse.json({
    ok: true,
    revalidated: { tags, paths },
  });
}

// GET form for browser-typed manual triggers — same auth, defaults to the
// "sectors" + "panel-cache" tags.  Handy when you want to type
// equityroots.in/api/revalidate?token=... into the address bar.
//
// Also supports ?diag=1 (no token required) — returns just whether the
// env var is set + its length, no values. Lets us debug "why does my
// token not match" without revealing anything sensitive. Safe to leave
// public because nothing here helps an attacker; the comparison is still
// constant-time against the real value when a token is supplied.
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("diag") === "1") {
    const diag = authCheck(req);
    return NextResponse.json(diag);
  }
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  for (const t of DEFAULT_TAGS) revalidateTag(t, "default");
  return NextResponse.json({
    ok: true,
    revalidated: { tags: DEFAULT_TAGS, paths: [] },
  });
}
