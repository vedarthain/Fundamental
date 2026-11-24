/**
 * /api/watchlist — read/write the watchlist.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { loadPortfolioSymbols } from "@/lib/portfolio";
import { loadCloseOnAdd } from "@/lib/watchlistQuote";
import {
  loadUserWatchlistSymbols,
  loadWatchlistData,
  MAX_WATCHLIST_SYMBOLS,
} from "@/lib/watchlistData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SYMBOLS = MAX_WATCHLIST_SYMBOLS;
const NOTE_MAX = 500;
const SYMBOL_RE = /^[A-Z0-9&-]+$/;

function cleanSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(s) || s.length > 30) return null;
  return s;
}

function cleanSymbolList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map(cleanSymbol)
        .filter((s): s is string => s !== null),
    ),
  ).slice(0, MAX_SYMBOLS);
}

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("symbols");
  const listOnly = param === null || req.nextUrl.searchParams.get("list") === "1";
  const lean = req.nextUrl.searchParams.get("lean") === "1";
  const savedOnly = req.nextUrl.searchParams.get("saved") === "1";
  const session = await getSession();

  let symbols: string[] = [];
  let heldFromList: string[] | null = null;
  if (param !== null) {
    if (param.trim() === "@portfolio") {
      symbols = session
        ? (await loadPortfolioSymbols(session.userId).catch(() => [] as string[]))
            .map((s) => s.toUpperCase())
            .slice(0, MAX_SYMBOLS)
        : [];
    } else {
      symbols = cleanSymbolList(param);
    }
  } else if (session) {
    const res = await loadUserWatchlistSymbols(session.userId, savedOnly);
    symbols = res.symbols;
    heldFromList = res.heldFromList;
  }

  if (listOnly) {
    return NextResponse.json({
      rows: [],
      symbols,
      signedIn: session !== null,
      snapshot_date: null,
    });
  }

  const { rows, snapshot_date } = await loadWatchlistData({
    symbols,
    userId: session?.userId ?? null,
    lean,
    heldFromList,
  });

  return NextResponse.json({
    rows,
    symbols,
    signedIn: session !== null,
    snapshot_date,
  });
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

  const cntRow = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM app.user_watchlist WHERE user_id = ${session.userId}
  `;
  const have = cntRow[0]?.count ?? 0;
  const room = Math.max(0, MAX_SYMBOLS - have);
  const toInsert = list.slice(0, room);

  if (toInsert.length === 0) {
    return NextResponse.json({ error: "watchlist full" }, { status: 409 });
  }

  const closeMap = await loadCloseOnAdd(toInsert);
  const closes = toInsert.map((s) => closeMap.get(s)?.close ?? null);
  const dates = toInsert.map((s) => closeMap.get(s)?.date ?? null);

  await sql`
    INSERT INTO app.user_watchlist (user_id, symbol, close_on_add, close_on_add_date)
    SELECT ${session.userId}, sym, cl, dt
      FROM unnest(${toInsert}::text[], ${closes}::numeric[], ${dates}::date[])
        AS t(sym, cl, dt)
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
    DELETE FROM app.user_watchlist
     WHERE user_id = ${session.userId}
       AND symbol  = ${sym}
  `;
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  let body: { symbol?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sym = typeof body.symbol === "string" ? cleanSymbol(body.symbol) : null;
  if (!sym) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }

  const raw = typeof body.note === "string" ? body.note.trim().slice(0, NOTE_MAX) : "";
  const note = raw.length === 0 ? null : raw;

  await sql`
    UPDATE app.user_watchlist
       SET note = ${note}
     WHERE user_id = ${session.userId}
       AND symbol  = ${sym}
  `;
  return NextResponse.json({ ok: true, note });
}
