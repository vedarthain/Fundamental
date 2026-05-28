/**
 * GET /api/upstox/login — admin-gated kickoff of the Upstox OAuth flow.
 *
 * Auth: any path that lib/auth.ts isAdminRequest() recognises as admin.
 * That means either:
 *   - the er_admin cookie set by /api/admin/auth, OR
 *   - a signed-in session whose email is listed in ADMIN_EMAILS, OR
 *   - a ?token=ADMIN_TOKEN URL parameter (one-shot bookmark).
 *
 * Earlier this route only honoured the cookie + ?token paths; the
 * ADMIN_EMAILS path was missing, which caused "Auth required" errors
 * for admins who signed in via the normal /login flow on mobile and
 * tried to tap the reauth button without ever opening a token URL.
 *
 * Flow:
 *   1. Generate a fresh CSRF `state` token, set as an httpOnly cookie.
 *   2. Build the Upstox dialog URL with our api_key + redirect_uri.
 *   3. 302 to that URL.  User authenticates on Upstox; Upstox redirects
 *      back to /api/upstox/callback?code=...&state=... where we verify
 *      the state matches the cookie and exchange the code.
 *
 * Why GET (not POST): browsers follow GET redirects naturally; the admin
 * just clicks a link.  CSRF risk is mitigated by the state cookie + admin
 * gate.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { buildLoginUrl } from "@/lib/upstox";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "upstox_oauth_state";

/** ?token=... fallback for direct bookmark navigation.  Kept as a parallel
 *  path because lib/auth.ts isAdminRequest doesn't peek at query strings —
 *  it only checks cookies + ADMIN_EMAILS. */
function queryTokenOk(req: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const given = req.nextUrl.searchParams.get("token");
  if (!given) return false;
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  const givenHash = createHash("sha256").update(given).digest("hex");
  return givenHash === expectedHash;
}

export async function GET(req: NextRequest) {
  // Three admin paths accepted: er_admin cookie, ADMIN_EMAILS session,
  // ?token=... query param.
  const allowed = (await isAdminRequest()) || queryTokenOk(req);
  if (!allowed) {
    return NextResponse.json({ error: "admin auth required" }, { status: 401 });
  }

  const state = randomBytes(16).toString("hex");
  const url = buildLoginUrl(state);

  const res = NextResponse.redirect(url, { status: 302 });
  res.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 300, // 5 min — long enough to complete the OAuth dance, short enough that a leak is benign
  });
  return res;
}
