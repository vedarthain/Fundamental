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
import { revalidateTag, revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TAGS = ["sectors", "panel-cache"];

function authOk(req: NextRequest): boolean {
  const expected = process.env.REVALIDATE_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const given = m?.[1] ?? req.nextUrl.searchParams.get("token") ?? "";
  // Constant-time-ish compare; for a short bearer token a normal compare
  // is fine in practice, but cheap to do better.
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) {
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
export async function GET(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  for (const t of DEFAULT_TAGS) revalidateTag(t, "default");
  return NextResponse.json({
    ok: true,
    revalidated: { tags: DEFAULT_TAGS, paths: [] },
  });
}
