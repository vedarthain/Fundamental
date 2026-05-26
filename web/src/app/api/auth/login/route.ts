/**
 * POST /api/auth/login — verify credentials, issue session cookie.
 *
 * Body: { email, password }
 *
 * On invalid credentials, returns 401 with a deliberately generic
 * message — never reveal whether the email exists, to avoid handing
 * attackers a user-enumeration oracle.
 *
 * Cost (Rule #1): one indexed SELECT + one bcrypt compare (~100ms CPU).
 */
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const rows = await sql<{ id: number; email: string; password_hash: string; display_name: string | null }[]>`
    SELECT id, email::text AS email, password_hash, display_name
      FROM app.users
     WHERE email = ${email}
     LIMIT 1
  `;
  const user = rows[0];

  // Always run bcrypt even if user is missing — defends against timing
  // attacks that probe for valid emails by measuring response time.
  const hashForCompare = user
    ? user.password_hash
    : "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidu";
  const ok = await bcrypt.compare(password, hashForCompare);

  if (!user || !ok) {
    return NextResponse.json({ error: "invalid email or password" }, { status: 401 });
  }

  // Update last_login_at (fire-and-forget). One small write per login.
  sql`UPDATE app.users SET last_login_at = NOW() WHERE id = ${user.id}`.catch(
    (e: unknown) => console.error("last_login_at update failed:", e),
  );

  await setSessionCookie(user.id);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, displayName: user.display_name },
  });
}
