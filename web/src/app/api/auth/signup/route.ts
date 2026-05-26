/**
 * POST /api/auth/signup — create a new user, log them in immediately.
 *
 * Body: { email, password, displayName? }
 *
 * Validations:
 *   - email looks like an email + <= 200 chars
 *   - password is 8-200 chars (no max-complexity gymnastics — see NIST SP
 *     800-63B: forced symbols hurt more than they help)
 *
 * Concurrency: a UNIQUE constraint on email handles the race where two
 * requests for the same email arrive simultaneously. We catch the unique
 * violation and return a clear 409.
 *
 * On success: sets session cookie, returns { ok, user }.
 *
 * Cost (Rule #1): one INSERT, one bcrypt hash (~100ms CPU). No reads.
 */
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown; displayName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim().length > 0
      ? body.displayName.trim().slice(0, 100)
      : null;

  if (!email || !EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 },
    );
  }
  if (password.length > 200) {
    return NextResponse.json({ error: "password too long" }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 10);

  let userId: number;
  try {
    const rows = await sql<{ id: number }[]>`
      INSERT INTO app.users (email, password_hash, display_name)
      VALUES (${email}, ${hash}, ${displayName})
      RETURNING id
    `;
    userId = rows[0].id;
  } catch (err: unknown) {
    // 23505 = unique_violation (email already exists)
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "an account with that email already exists" },
        { status: 409 },
      );
    }
    // Log the full technical detail server-side so the operator can fix
    // setup problems (missing migration, missing SESSION_SECRET, etc.) by
    // reading Vercel logs. Users see a clean, plain-English message —
    // never a raw Postgres / Node error.
    console.error("signup failed:", err);
    return NextResponse.json(
      {
        error:
          "Something went wrong on our end while creating your account. Please try again in a minute. If it keeps happening, write to us via /feedback.",
      },
      { status: 500 },
    );
  }

  await setSessionCookie(userId);
  return NextResponse.json({
    ok: true,
    user: { id: userId, email, displayName },
  });
}
