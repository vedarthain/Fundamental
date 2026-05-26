/**
 * /api/watchlist — read/write the watchlist.
 *
 *   GET    — if ?symbols=A,B,C is provided, returns card data for those
 *            symbols (used by signed-out clients reading their local
 *            list).  If no ?symbols and the user is signed in, returns
 *            their server-side watchlist (the source of truth).
 *   POST   — body { symbol } — adds to the signed-in user's list.
 *   DELETE — ?symbol=X — removes from the signed-in user's list.
 *
 * Signed-out POST/DELETE return 401. The client uses localStorage when
 * signed out, so it never calls those routes anonymously.
 *
 * All card data comes from app.cluster_stocks_panel_cache — same
 * materialised table /sectors uses. Single indexed read.
 *
 * Cost (Rule #1):
 *   GET:    one cheap query (rows + optional userlist read)
 *   POST:   one tiny INSERT … ON CONFLICT DO NOTHING
 *   DELETE: one tiny DELETE
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 100;
const SYMBOL_RE = /^[A-Z0-9&-]+$/;

type WatchRow = {
  symbol: string;
  company_name: string | null;
  sector_name: string | null;
  industry_name: string | null;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
};

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

async function loadRows(symbols: string[]): Promise<WatchRow[]> {
  if (symbols.length === 0) return [];
  return sql<WatchRow[]>`
    SELECT
      c.symbol,
      c.company_name,
      mc.name        AS sector_name,
      cl.name        AS industry_name,
      c.maturity_tier,
      c.market_cap_cr::float  AS market_cap_cr,
      c.current_price::float  AS current_price,
      c.composite_pct::float  AS composite_pct,
      c.quality_pct::float    AS quality_pct,
      c.valuation_pct::float  AS valuation_pct,
      c.momentum_pct::float   AS momentum_pct,
      c.ret_1w::float         AS ret_1w,
      c.ret_1m::float         AS ret_1m,
      c.ret_1y::float         AS ret_1y
    FROM app.cluster_stocks_panel_cache c
    JOIN app.cluster cl ON cl.id = c.cluster_id
    JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
    WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND c.symbol = ANY(${symbols})
  `;
}

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("symbols");
  const session = await getSession();

  // If the client passed a specific symbol list, use that (signed-out
  // clients reading their local list, or signed-in clients explicitly
  // overriding).  Otherwise, for signed-in users, fall back to the
  // server-side watchlist.
  let symbols: string[] = [];
  if (param !== null) {
    symbols = cleanSymbolList(param);
  } else if (session) {
    const rows = await sql<{ symbol: string }[]>`
      SELECT symbol FROM app.user_watchlist
       WHERE user_id = ${session.userId}
       ORDER BY added_at DESC
       LIMIT ${MAX_SYMBOLS}
    `;
    symbols = rows.map((r) => r.symbol);
  }

  const rows = await loadRows(symbols);
  return NextResponse.json({ rows, symbols, signedIn: session !== null });
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

  // Accept either a single { symbol } or a batch { symbols: [...] }.  The
  // batch form is what the localStorage → server merge calls on first
  // login (a user with 20 saved symbols shouldn't fire 20 sequential
  // requests).
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

  // Enforce per-user cap before inserting.  One small read.
  const cntRow = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM app.user_watchlist WHERE user_id = ${session.userId}
  `;
  const have = cntRow[0]?.count ?? 0;
  const room = Math.max(0, MAX_SYMBOLS - have);
  const toInsert = list.slice(0, room);

  if (toInsert.length === 0) {
    return NextResponse.json({ error: "watchlist full" }, { status: 409 });
  }

  // Batch insert with ON CONFLICT DO NOTHING — duplicates are silently
  // dropped, so callers can safely re-POST the same symbol without an
  // error path to handle.
  await sql`
    INSERT INTO app.user_watchlist (user_id, symbol)
    SELECT ${session.userId}, sym
      FROM unnest(${toInsert}::text[]) AS sym
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
