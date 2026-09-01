/**
 * /api/notes — the per-user scribble pad (see db/migrations/0056_user_note).
 *
 *   GET    — list the signed-in user's notes, newest first.
 *   POST   — body { body } — append a new dated entry.
 *   PATCH  — body { id, body } — edit an existing entry in place. created_at is
 *            preserved, so the note keeps its authored date + journal position;
 *            we're fixing the text of an old record, not re-dating it.
 *   DELETE — ?id=N — remove one entry (must belong to the caller).
 *
 * All require a session; signed-out callers get 401.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY_MAX = 4000;

export type Note = { id: number; body: string; created_at: string };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const notes = await sql<Note[]>`
    SELECT id, body, created_at::text AS created_at
      FROM app.user_note
     WHERE user_id = ${session.userId}
     ORDER BY created_at DESC, id DESC
     LIMIT 500
  `;
  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  let payload: { body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body) return NextResponse.json({ error: "empty note" }, { status: 400 });
  if (body.length > BODY_MAX) {
    return NextResponse.json({ error: "note too long" }, { status: 400 });
  }

  const rows = await sql<Note[]>`
    INSERT INTO app.user_note (user_id, body)
    VALUES (${session.userId}, ${body})
    RETURNING id, body, created_at::text AS created_at
  `;
  return NextResponse.json({ note: rows[0] }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  let payload: { id?: unknown; body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const id = typeof payload.id === "number" ? payload.id : Number(payload.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body) return NextResponse.json({ error: "empty note" }, { status: 400 });
  if (body.length > BODY_MAX) {
    return NextResponse.json({ error: "note too long" }, { status: 400 });
  }

  // user_id predicate scopes the update to the caller's own rows; created_at is
  // untouched so the entry keeps its authored date. A stray/foreign id updates
  // nothing and returns 404.
  const rows = await sql<Note[]>`
    UPDATE app.user_note
       SET body = ${body}
     WHERE id = ${id} AND user_id = ${session.userId}
    RETURNING id, body, created_at::text AS created_at
  `;
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ note: rows[0] });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const idRaw = req.nextUrl.searchParams.get("id");
  const id = idRaw ? Number(idRaw) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  // user_id predicate scopes the delete to the caller's own rows — a stray id
  // for someone else's note simply deletes nothing.
  const rows = await sql<{ id: number }[]>`
    DELETE FROM app.user_note
     WHERE id = ${id} AND user_id = ${session.userId}
    RETURNING id
  `;
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
