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

  const ALLOWED_STATUS = ["open", "planned", "building", "shipped", "wont_do"] as const;
  type Status = (typeof ALLOWED_STATUS)[number];
  const raw = body as Record<string, unknown>;

  // Parse + validate each known field. undefined = "not in payload, skip";
  // null = "explicit clear" (only valid for notes/response).
  const updates: {
    handled?: boolean;
    notes?: string | null;
    is_public?: boolean;
    response?: string | null;
    status?: Status;
  } = {};

  if ("handled" in raw) {
    if (typeof raw.handled !== "boolean") {
      return NextResponse.json({ error: "invalid handled" }, { status: 400 });
    }
    updates.handled = raw.handled;
  }
  if ("notes" in raw) {
    if (raw.notes === null) updates.notes = null;
    else if (typeof raw.notes === "string") updates.notes = raw.notes.slice(0, 1000);
    else return NextResponse.json({ error: "invalid notes" }, { status: 400 });
  }
  if ("is_public" in raw) {
    if (typeof raw.is_public !== "boolean") {
      return NextResponse.json({ error: "invalid is_public" }, { status: 400 });
    }
    updates.is_public = raw.is_public;
  }
  if ("response" in raw) {
    if (raw.response === null) updates.response = null;
    else if (typeof raw.response === "string") updates.response = raw.response.slice(0, 2000);
    else return NextResponse.json({ error: "invalid response" }, { status: 400 });
  }
  if ("status" in raw) {
    if (
      typeof raw.status !== "string" ||
      !(ALLOWED_STATUS as readonly string[]).includes(raw.status)
    ) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    updates.status = raw.status as Status;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  // COALESCE-pattern UPDATE: every field gets a value, but rows we didn't
  // intend to touch see CURRENT_VALUE (sentinel handled below).  Cleaner
  // than dynamic SET construction with postgres.js's type-strict tagged
  // template, and only one round-trip.
  await sql`
    UPDATE app.user_ideas SET
      handled   = ${updates.handled   ?? sql`handled`},
      notes     = ${updates.notes     !== undefined ? updates.notes     : sql`notes`},
      is_public = ${updates.is_public ?? sql`is_public`},
      response  = ${updates.response  !== undefined ? updates.response  : sql`response`},
      status    = ${updates.status    ?? sql`status`}
    WHERE id = ${id}
  `;
  return NextResponse.json({ ok: true });
}
