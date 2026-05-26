/**
 * GET /api/auth/me — returns the current user, or { user: null }.
 *
 * Used by the client `useSession` hook to know whether to show "Sign in"
 * vs "Watchlist" in the top nav.  One indexed lookup per call; the client
 * hook caches the result per page load.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ user });
}
