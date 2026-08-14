/**
 * POST /api/auth/change-password — signed-in user rotates their own password.
 *
 * Body: { currentPassword, newPassword }
 *
 * Requires a valid session AND the current password (defence-in-depth: a
 * stolen session cookie alone can't silently change the password and lock
 * the real owner out — the attacker would also need the existing password).
 *
 * On success the session stays valid (we don't rotate the cookie) — the
 * user keeps browsing. Validations mirror signup: 8–200 chars, no forced
 * complexity (NIST SP 800-63B).
 *
 * Cost (Rule #1): one indexed SELECT + one bcrypt compare + one bcrypt
 * hash + one UPDATE (~200ms CPU). No extra reads.
 */
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "current and new password required" },
      { status: 400 },
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "new password must be at least 8 characters" },
      { status: 400 },
    );
  }
  if (newPassword.length > 200) {
    return NextResponse.json({ error: "new password too long" }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "new password must differ from the current one" },
      { status: 400 },
    );
  }

  let rows: { password_hash: string }[];
  try {
    rows = await sql<{ password_hash: string }[]>`
      SELECT password_hash FROM app.users WHERE id = ${session.userId} LIMIT 1
    `;
  } catch (err) {
    console.error("change-password query failed:", err);
    return NextResponse.json(
      { error: "Something went wrong on our end. Please try again in a minute." },
      { status: 500 },
    );
  }

  const user = rows[0];
  if (!user) {
    // Session references a user that no longer exists — treat as unauthorized.
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) {
    return NextResponse.json(
      { error: "current password is incorrect" },
      { status: 401 },
    );
  }

  const hash = await bcrypt.hash(newPassword, 10);
  try {
    await sql`UPDATE app.users SET password_hash = ${hash} WHERE id = ${session.userId}`;
  } catch (err) {
    console.error("change-password update failed:", err);
    return NextResponse.json(
      { error: "Something went wrong saving your new password. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
