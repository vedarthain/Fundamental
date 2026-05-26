/**
 * POST /api/auth/logout — clear the session cookie.
 *
 * Stateless sessions, so there's nothing server-side to revoke. We just
 * overwrite the cookie with maxAge=0.
 */
import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
