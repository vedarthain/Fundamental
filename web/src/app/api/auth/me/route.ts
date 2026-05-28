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
import { getSessionUser, isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Single helper checks both the er_admin cookie and the signed-in
  // user's email against ADMIN_EMAILS.  Either grants admin.
  const [user, isAdmin] = await Promise.all([
    getSessionUser(),
    isAdminRequest(),
  ]);
  // Browser cache for 60s — the useSession() hook already has an in-tab
  // cache, but this header lets browsers reuse the response across hard
  // navigations within the same minute. `private` because the body is
  // per-user; never CDN-share it.
  return NextResponse.json(
    { user, isAdmin },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
