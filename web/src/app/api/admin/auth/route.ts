/**
 * GET /api/admin/auth?token=... — validate token + set cookies + redirect.
 *
 * Page server components in Next.js 15 can READ cookies but cannot SET them
 * (that's a Route Handler / Server Action thing). So /admin/ideas redirects
 * here when it sees `?token=...`, we validate + drop the cookie, then
 * redirect back to /admin/ideas (now with a valid cookie attached).
 *
 * Sets TWO cookies:
 *   - er_admin   = SHA-256(ADMIN_TOKEN) — grants admin-page access.
 *   - er_session = a real user session for the admin user (resolved from
 *                  ADMIN_EMAILS), so the admin login ALSO carries a user
 *                  identity — watchlist, /watchlist, "watchlist in the news"
 *                  etc. work. Without it the token login had no userId and
 *                  those per-user surfaces showed empty.
 *
 * The raw ADMIN_TOKEN never makes a round trip after this first set.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { signSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "er_admin";
const SESSION_COOKIE = "er_session";            // must match lib/auth COOKIE_NAME
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;    // 30 days, matches lib/auth MAX_AGE_S

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
    maxAge: SESSION_MAX_AGE_S,
    path: "/",
  });

  // Also bind a USER session so the admin login carries a watchlist etc.
  // Resolve the admin user from ADMIN_EMAILS (the same config that grants admin
  // via email). If that email has an account, sign them in too. If not (no
  // ADMIN_EMAILS / no matching account), admin still works — just without the
  // per-user surfaces.
  try {
    const emails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (emails.length > 0) {
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM app.users
         WHERE lower(email) = ANY(${emails})
         ORDER BY id LIMIT 1
      `;
      const uid = rows[0]?.id != null ? Number(rows[0].id) : null;
      if (uid != null && Number.isFinite(uid) && uid > 0) {
        const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S;
        res.cookies.set(SESSION_COOKIE, signSession({ userId: uid, exp }), {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: SESSION_MAX_AGE_S,
        });
      }
    }
  } catch {
    // Admin access still granted even if the user-session bind fails.
  }

  return res;
}
