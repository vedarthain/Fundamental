/**
 * /api/scanner-favourites — read/write the Scanner "Favourites" (stars).
 *
 *   GET    — returns { signedIn, symbols } for the signed-in user's stars.
 *            Signed-out returns { signedIn: false, symbols: [] } so the
 *            client knows to fall back to localStorage.
 *   POST   — body { symbol } or { symbols: [...] } — adds to the signed-in
 *            user's stars (batch form is used by the login/signup merge).
 *   DELETE — ?symbol=X — removes a star.
 *
 * Membership-only: unlike /api/watchlist this carries no panel-cache joins,
 * no cost-basis, no notes. A star is just a (user_id, symbol) row. Signed-out
 * POST/DELETE return 401 — the client uses localStorage anonymously and never
 * calls those routes.
 *
 * Cost (Rule #1):
 *   GET:    one tiny indexed read
 *   POST:   one INSERT … ON CONFLICT DO NOTHING
 *   DELETE: one tiny DELETE
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 500;
const SYMBOL_RE = /^[A-Z0-9&-]+$/;

function cleanSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(s) || s.length > 30) return null;
  return s;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ signedIn: false, symbols: [] });
  }
  const rows = await sql<{ symbol: string }[]>`
    SELECT symbol FROM app.user_scanner_favourite
     WHERE user_id = ${session.userId}
     ORDER BY created_at DESC
     LIMIT ${MAX_SYMBOLS}
  `;
  return NextResponse.json({ signedIn: true, symbols: rows.map((r) => r.symbol) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  let body: { symbol?: unknown; symbols?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Accept a single { symbol } or a batch { symbols: [...] } — the batch form
  // is what the localStorage → server merge posts on first sign-in.
  const list: string[] = [];
  if (typeof body.symbol === "string") {
    const s = cleanSymbol(body.symbol);
    if (s) list.push(s);
  } else if (Array.isArray(body.symbols)) {
    for (const v of body.symbols) {
      if (typeof v === "string") {
        const s = cleanSymbol(v);
        if (s) list.push(s);
      }
    }
  }

  if (list.length === 0) {
    return NextResponse.json({ error: "no valid symbols" }, { status: 400 });
  }

  const toInsert = Array.from(new Set(list)).slice(0, MAX_SYMBOLS);

  await sql`
    INSERT INTO app.user_scanner_favourite (user_id, symbol)
    SELECT ${session.userId}, sym FROM unnest(${toInsert}::text[]) AS t(sym)
    ON CONFLICT (user_id, symbol) DO NOTHING
  `;

  return NextResponse.json({ ok: true, added: toInsert });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const raw = req.nextUrl.searchParams.get("symbol") || "";
  const sym = cleanSymbol(raw);
  if (!sym) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }
  await sql`
    DELETE FROM app.user_scanner_favourite
     WHERE user_id = ${session.userId}
       AND symbol  = ${sym}
  `;
  return NextResponse.json({ ok: true });
}
