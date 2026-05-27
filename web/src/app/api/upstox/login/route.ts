/**
 * GET /api/upstox/login — admin-gated kickoff of the Upstox OAuth flow.
 *
 * Auth: requires the ADMIN_TOKEN cookie set by /admin/ideas login.  This
 * is intentionally NOT exposed to regular signed-in users — Upstox tokens
 * are server-wide credentials.  Misuse would burn through Upstox rate
 * limits and possibly violate their TOS.
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
import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { buildLoginUrl } from "@/lib/upstox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "upstox_oauth_state";

function adminTokenOk(req: NextRequest, cookieJar: { get: (k: string) => { value: string } | undefined }): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  // SHA-256 of the raw token, same scheme as /admin/ideas auth.
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  const cookieHash = cookieJar.get("admin_token")?.value ?? "";
  if (cookieHash === expectedHash) return true;
  // Allow ?token=... fallback for direct browser navigation by the admin.
  const queryToken = req.nextUrl.searchParams.get("token");
  if (queryToken && createHash("sha256").update(queryToken).digest("hex") === expectedHash) {
    return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  const c = await cookies();
  if (!adminTokenOk(req, c)) {
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
