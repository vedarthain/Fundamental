/**
 * GET /api/admin/auth?token=... — validate token + set cookie + redirect.
 *
 * Page server components in Next.js 15 can READ cookies but cannot SET them
 * (that's a Route Handler / Server Action thing). So /admin/ideas redirects
 * here when it sees `?token=...`, we validate + drop the cookie, then
 * redirect back to /admin/ideas (now with a valid cookie attached).
 *
 * The cookie stores SHA-256(ADMIN_TOKEN) — the raw token never makes a
 * round trip after this first set.
 *
 * Cost (Rule #1): zero — no DB, just env-var compare.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "er_admin";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const expected = process.env.ADMIN_TOKEN;

  if (!expected) {
    return new NextResponse("ADMIN_TOKEN not configured on server", {
      status: 500,
    });
  }
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  const givenHash    = createHash("sha256").update(token).digest("hex");
  if (givenHash !== expectedHash) {
    return new NextResponse("Invalid token", { status: 401 });
  }

  // Redirect to the clean URL (no ?token=) and set the cookie on the response.
  const redirectTo = req.nextUrl.searchParams.get("redirect") || "/admin/ideas";
  const res = NextResponse.redirect(new URL(redirectTo, req.url));
  res.cookies.set(COOKIE_NAME, expectedHash, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}
