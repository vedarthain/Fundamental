/**
 * POST /api/admin/reset-password — admin resets ANY user's password.
 *
 * This is the "forgot password" recovery path. The app has no email
 * provider, so a self-serve reset link is impossible; instead the operator
 * (an ADMIN_EMAILS user or the er_admin cookie holder) sets a new password
 * for a user who's locked out, then tells them out-of-band.
 *
 * Body: { email, newPassword }
 *
 * Auth: isAdminRequest() — same gate as /admin/* pages. A normal signed-in
 * user CANNOT reach this; only an admin.
 *
 * Cost (Rule #1): one bcrypt hash + one UPDATE. No reads beyond the admin
 * check.
 */
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) {
    // Deliberately generic — don't confirm the endpoint's shape to non-admins.
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }

  let body: { email?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";

  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
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

  const hash = await bcrypt.hash(newPassword, 10);

  let rows: { id: string; email: string }[];
  try {
    rows = await sql<{ id: string; email: string }[]>`
      UPDATE app.users
         SET password_hash = ${hash}
       WHERE lower(email) = ${email}
       RETURNING id::text, email::text
    `;
  } catch (err) {
    console.error("admin reset-password failed:", err);
    return NextResponse.json(
      { error: "Something went wrong resetting the password. Please try again." },
      { status: 500 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: `no account found for ${email}` },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, email: rows[0].email });
}
