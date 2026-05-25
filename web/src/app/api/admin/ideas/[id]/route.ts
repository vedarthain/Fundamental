/**
 * PATCH /api/admin/ideas/[id] — update a user-idea row.
 *
 * Body: { handled?: boolean, notes?: string | null }
 *
 * Auth: same cookie that gates /admin/ideas. The cookie value is the
 * SHA-256 of the ADMIN_TOKEN secret; we compare server-side.
 *
 * Cost (Rule #1): one UPDATE per admin click. Effectively free.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "er_admin";

async function isAuthed(): Promise<boolean> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  const c = await cookies();
  return c.get(COOKIE_NAME)?.value === expectedHash;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: { handled?: unknown; notes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const updates: { handled?: boolean; notes?: string | null } = {};
  if (typeof body.handled === "boolean") updates.handled = body.handled;
  if (body.notes === null) updates.notes = null;
  else if (typeof body.notes === "string") {
    updates.notes = body.notes.slice(0, 1000);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  // Build the UPDATE dynamically — both fields are well-known and safe
  // to interpolate as tagged-template params.
  if (updates.handled !== undefined && updates.notes !== undefined) {
    await sql`
      UPDATE app.user_ideas
      SET handled = ${updates.handled}, notes = ${updates.notes}
      WHERE id = ${id}
    `;
  } else if (updates.handled !== undefined) {
    await sql`UPDATE app.user_ideas SET handled = ${updates.handled} WHERE id = ${id}`;
  } else {
    await sql`UPDATE app.user_ideas SET notes = ${updates.notes ?? null} WHERE id = ${id}`;
  }

  return NextResponse.json({ ok: true });
}
