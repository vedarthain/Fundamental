/**
 * GET /api/auth/me — returns the current user + admin flag.
 *
 * Used by the client `useSession` hook to drive the top nav:
 *   - user      → "Sign in" vs UserMenu chip
 *   - isAdmin   → show the "Upstox session" link inside UserMenu (only
 *                 for the operator who carries the er_admin cookie)
 *
 * The admin check is a constant-time compare of the er_admin cookie
 * value against SHA-256(ADMIN_TOKEN).  Same scheme used by
 * /admin/ideas + /admin/upstox; this just surfaces the result to the
 * client without exposing the token value itself.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "crypto";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdminFromCookie(): Promise<boolean> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const c = await cookies();
  const cookieVal = c.get("er_admin")?.value;
  if (!cookieVal) return false;
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  // Constant-time compare guards against a (very unlikely) timing oracle
  // someone might use to learn the cookie format.
  const a = Buffer.from(cookieVal, "utf8");
  const b = Buffer.from(expectedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET() {
  const [user, isAdmin] = await Promise.all([
    getSessionUser(),
    isAdminFromCookie(),
  ]);
  return NextResponse.json({ user, isAdmin });
}
