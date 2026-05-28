/**
 * GET /api/upstox/login — admin-gated kickoff of the Upstox OAuth flow.
 *
 * Auth: any path lib/auth.ts isAdminRequest() recognises as admin
 *   - the er_admin cookie set by /api/admin/auth
 *   - a signed-in session whose email is in ADMIN_EMAILS
 *   - ?token=ADMIN_TOKEN query parameter (first-time bookmark)
 *
 * Flow:
 *   1. Build the Upstox dialog URL with an HMAC-signed `state` token
 *      (lib/upstox.ts buildLoginUrl).  The state is self-validating;
 *      no cookie required.
 *   2. 302 to that URL.  User authenticates on Upstox; Upstox redirects
 *      back to /api/upstox/callback?code=...&state=... where we verify
 *      the signature and exchange the code.
 *
 * Why no cookie: iOS Safari's ITP was blocking the state cookie on the
 * cross-site redirect back from upstox.com, surfacing as "state mismatch"
 * errors on mobile.  HMAC-signed state survives that constraint.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { buildLoginUrl } from "@/lib/upstox";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const allowed = (await isAdminRequest()) || queryTokenOk(req);
  if (!allowed) {
    return NextResponse.json({ error: "admin auth required" }, { status: 401 });
  }
  return NextResponse.redirect(buildLoginUrl(), { status: 302 });
}
