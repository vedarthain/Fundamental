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
import { loadPersistenceForSymbols } from "@/lib/persistence";
import { loadQuotes, loadCloseOnAdd, loadCloseAsOf } from "@/lib/watchlistQuote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 1000;
const NOTE_MAX = 500;
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
  /** Multi-snapshot persistence — 4-week composite_pct trend.  All
   *  three fields null if the symbol has <2 snapshots of history. */
  raw_delta: number | null;
  cluster_avg_delta: number | null;
  cluster_adjusted: number | null;
  snaps_improving: number;
  /** Per-user watchlist metadata (signed-in only; null otherwise). */
  added_at: string | null;
  close_on_add: number | null;
  close_on_add_date: string | null;
  note: string | null;
  /** Fresh daily quote from golden (split-adjusted). */
  ltp: number | null;
  ret_1d: number | null;
  high_52w: number | null;
  low_52w: number | null;
  from_high_pct: number | null;
  from_low_pct: number | null;
};

type WatchMeta = {
  added_at: string | null;
  close_on_add: number | null;
  close_on_add_date: string | null;
  note: string | null;
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

/** Per-user watchlist metadata (added_at, cost-basis snapshot, note) keyed by
 *  symbol. Empty when signed out — those fields have no home in localStorage. */
async function loadMeta(
  userId: number,
  symbols: string[],
): Promise<Map<string, WatchMeta>> {
  const out = new Map<string, WatchMeta>();
  if (symbols.length === 0) return out;
  const rows = await sql<
    { symbol: string; added_at: string; close_on_add: number | null; close_on_add_date: string | null; note: string | null }[]
  >`
    SELECT symbol,
           added_at::text          AS added_at,
           close_on_add::float     AS close_on_add,
           close_on_add_date::text AS close_on_add_date,
           note
      FROM app.user_watchlist
     WHERE user_id = ${userId}
       AND symbol = ANY(${symbols})
  `;
  for (const r of rows) {
    out.set(r.symbol, {
      added_at: r.added_at,
      close_on_add: r.close_on_add,
      close_on_add_date: r.close_on_add_date,
      note: r.note,
    });
  }
  return out;
}

async function loadSnapshotDate(): Promise<string | null> {
  // Pulled separately so it returns even when the user has zero saved
  // symbols (loadRows would otherwise short-circuit before we knew).
  const rows = await sql<{ snapshot_date: string | null }[]>`
    SELECT MAX(snapshot_date)::text AS snapshot_date FROM app.cluster_stocks_panel_cache
  `;
  return rows[0]?.snapshot_date ?? null;
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

  const [rows, snapshotDate, persistence, quotes, meta] = await Promise.all([
    loadRows(symbols),
    loadSnapshotDate(),
    // Multi-snapshot trend per symbol. Two cheap reads regardless of
    // watchlist size, then merged in Node.
    loadPersistenceForSymbols(symbols),
    // Fresh daily quote (LTP, 1D move, 52W high/low) from golden.
    loadQuotes(symbols),
    // Per-user cost-basis snapshot + note. Empty when signed out.
    session
      ? loadMeta(session.userId, symbols)
      : Promise.resolve(new Map<string, WatchMeta>()),
  ]);
  // Self-heal missing close_on_add. Rows added while golden lagged (e.g. a
  // post-merger ticker like PVRINOX whose bars backfilled late) got a null
  // close_on_add that was then frozen — the value is captured once at add-time
  // and never retried, so "Close @ add" / "Since add" stayed blank forever.
  // Now that golden has the bars, recover the close as of the original add date
  // and persist it once. Signed-in only (signed-out rows have no server meta).
  if (session) {
    const needsHeal = [...meta.entries()]
      .filter(([, m]) => m.close_on_add == null && m.added_at)
      .map(([symbol, m]) => ({ symbol, date: (m.added_at as string).slice(0, 10) }));
    if (needsHeal.length > 0) {
      const healed = await loadCloseAsOf(needsHeal);
      const upSyms: string[] = [];
      const upCloses: number[] = [];
      const upDates: string[] = [];
      for (const { symbol } of needsHeal) {
        const h = healed.get(symbol);
        if (!h) continue;
        const m = meta.get(symbol);
        if (!m) continue;
        m.close_on_add = h.close;        // patch the in-memory map for this response
        m.close_on_add_date = h.date;
        upSyms.push(symbol);
        upCloses.push(h.close);
        upDates.push(h.date);
      }
      if (upSyms.length > 0) {
        // Persist so the heal is one-time, not recomputed on every load. Guard
        // on IS NULL so a concurrent legit snapshot is never overwritten.
        await sql`
          UPDATE app.user_watchlist AS w
             SET close_on_add = v.cl, close_on_add_date = v.dt
            FROM unnest(${upSyms}::text[], ${upCloses}::numeric[], ${upDates}::date[])
                 AS v(sym, cl, dt)
           WHERE w.user_id = ${session.userId} AND w.symbol = v.sym
             AND w.close_on_add IS NULL
        `.catch(() => {});
      }
    }
  }

  // Splice the persistence, quote and per-user fields into each row so the
  // client renders them in the same iteration as the rest of the data.
  for (const row of rows) {
    const p = persistence.get(row.symbol);
    row.raw_delta         = p?.raw_delta         ?? null;
    row.cluster_avg_delta = p?.cluster_avg_delta ?? null;
    row.cluster_adjusted  = p?.cluster_adjusted  ?? null;
    row.snaps_improving   = p?.snaps_improving   ?? 0;

    const q = quotes.get(row.symbol);
    row.ltp           = q?.ltp           ?? null;
    row.ret_1d        = q?.ret_1d        ?? null;
    row.high_52w      = q?.high_52w      ?? null;
    row.low_52w       = q?.low_52w       ?? null;
    row.from_high_pct = q?.from_high_pct ?? null;
    row.from_low_pct  = q?.from_low_pct  ?? null;

    const m = meta.get(row.symbol);
    row.added_at          = m?.added_at          ?? null;
    row.close_on_add      = m?.close_on_add      ?? null;
    row.close_on_add_date = m?.close_on_add_date ?? null;
    row.note              = m?.note              ?? null;
  }
  return NextResponse.json({
    rows,
    symbols,
    signedIn: session !== null,
    snapshot_date: snapshotDate,
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

  // Capture the latest close per symbol as the "closing rate when added"
  // reference point (best-effort — golden hiccup just leaves it null).
  const closeMap = await loadCloseOnAdd(toInsert);
  const closes = toInsert.map((s) => closeMap.get(s)?.close ?? null);
  const dates = toInsert.map((s) => closeMap.get(s)?.date ?? null);

  // Batch insert with ON CONFLICT DO NOTHING — duplicates are silently
  // dropped, so callers can safely re-POST the same symbol without an
  // error path to handle. close_on_add/date are frozen at first add; a
  // re-POST of an existing name does NOT overwrite the original snapshot.
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

/**
 * PATCH — body { symbol, note } — sets the free-text note on a watched name.
 * An empty/whitespace note clears it (stored as NULL). Signed-out → 401.
 */
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

  // Only touches the caller's own row; a non-existent (user, symbol) is a
  // silent no-op (0 rows updated) rather than an error.
  await sql`
    UPDATE app.user_watchlist
       SET note = ${note}
     WHERE user_id = ${session.userId}
       AND symbol  = ${sym}
  `;
  return NextResponse.json({ ok: true, note });
}
