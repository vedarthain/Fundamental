/**
 * Manual trade entry — hand-entered buys/sells for the signed-in user.
 *
 *   GET    → list the user's manual transactions (newest first)
 *   POST   → add one { symbol, side, date, quantity, price, time? }
 *   DELETE ?id= → remove one manual transaction
 *
 * Every mutation writes app.portfolio_transaction (broker='manual') and then
 * recomputes the derived app.portfolio_holding row for that symbol, so a manual
 * trade shows up as a real position — not just a chart marker. Symbols must
 * resolve to app.universe (mapped equities only); ETFs/funds are out of scope.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recomputeDerivedHolding } from "@/lib/derivedHoldings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualRow = {
  id: string;
  symbol: string;
  company_name: string | null;
  side: string;
  trade_date: string;
  quantity: string;
  price: string;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const rows = await sql<ManualRow[]>`
    SELECT t.id::text, t.symbol, u.company_name, t.side,
           t.trade_date::text, t.quantity::text, t.price::text
      FROM app.portfolio_transaction t
      LEFT JOIN app.universe u ON u.symbol = t.symbol
     WHERE t.user_id = ${session.userId} AND t.broker = 'manual'
     ORDER BY t.trade_date DESC, t.id DESC
  `;
  return NextResponse.json({
    trades: rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      name: r.company_name,
      side: r.side,
      date: r.trade_date,
      quantity: Number(r.quantity),
      price: Number(r.price),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const symbol = String(body.symbol ?? "").toUpperCase().trim();
  const side = String(body.side ?? "").toLowerCase().trim();
  const date = String(body.date ?? "").trim();
  const quantity = Number(body.quantity);
  const price = Number(body.price);
  const time = body.time ? String(body.time).trim() : null;

  // ── validation ──
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  if (side !== "buy" && side !== "sell")
    return NextResponse.json({ error: "side must be 'buy' or 'sell'" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  if (date > new Date().toISOString().slice(0, 10))
    return NextResponse.json({ error: "trade date can't be in the future" }, { status: 400 });
  if (!Number.isFinite(quantity) || quantity <= 0)
    return NextResponse.json({ error: "quantity must be a positive number" }, { status: 400 });
  if (!Number.isFinite(price) || price < 0)
    return NextResponse.json({ error: "price must be zero or more" }, { status: 400 });

  // Symbol must be a live universe equity (mapped only — ETFs/funds excluded).
  const uni = await sql<{ symbol: string; isin: string | null; company_name: string | null }[]>`
    SELECT symbol, isin, company_name FROM app.universe
     WHERE is_active AND symbol = ${symbol} LIMIT 1
  `;
  if (uni.length === 0)
    return NextResponse.json(
      { error: `"${symbol}" isn't a tracked NSE equity — pick one from the suggestions` },
      { status: 400 },
    );
  const { isin, company_name } = uni[0];

  // dedup_key is a NOT NULL UNIQUE audit column. Manual rows aren't deduped
  // against each other (two identical entries are legitimate), so a random key
  // avoids false collisions.
  const dedupKey = "manual:" + randomUUID();

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO app.portfolio_transaction
        (user_id, broker, trade_date, trade_time, side, symbol, raw_symbol,
         raw_name, isin, quantity, price, source_file, dedup_key)
      VALUES
        (${session.userId}, 'manual', ${date}, ${time}, ${side}, ${symbol}, ${symbol},
         ${company_name}, ${isin}, ${quantity}, ${price}, 'manual-entry', ${dedupKey})
    `;
    await recomputeDerivedHolding(tx, session.userId, symbol);
  });

  return NextResponse.json({ ok: true, symbol, side, quantity, price, date });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^\d+$/.test(id))
    return NextResponse.json({ error: "valid numeric id required" }, { status: 400 });

  // Only manual rows are deletable here — imported broker trades are read-only.
  const del = await sql<{ symbol: string }[]>`
    DELETE FROM app.portfolio_transaction
     WHERE id = ${Number(id)} AND user_id = ${session.userId} AND broker = 'manual'
     RETURNING symbol
  `;
  if (del.length === 0)
    return NextResponse.json({ error: "no such manual trade" }, { status: 404 });

  await recomputeDerivedHolding(sql, session.userId, del[0].symbol);
  return NextResponse.json({ ok: true });
}
