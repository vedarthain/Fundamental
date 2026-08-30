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

// Brokers a manual trade can be tagged with. These are metadata on the trade
// (which broker it happened at) — the trade is still a hand entry, marked by
// source_file='manual-entry', which is what makes it listable/deletable here.
const MANUAL_BROKERS = ["zerodha", "upstox", "fyers", "fivepaisa", "groww", "other"] as const;
const MANUAL_BROKER_LABEL: Record<string, string> = {
  zerodha: "Zerodha",
  upstox: "Upstox",
  fyers: "Fyers",
  fivepaisa: "5paisa",
  groww: "Groww",
  other: "Other",
  manual: "Manual", // legacy entries stored before broker tagging
};

type ManualRow = {
  id: string;
  symbol: string;
  company_name: string | null;
  broker: string;
  side: string;
  trade_date: string;
  quantity: string;
  price: string;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const rows = await sql<ManualRow[]>`
    SELECT t.id::text, t.symbol, u.company_name, t.broker, t.side,
           t.trade_date::text, t.quantity::text, t.price::text
      FROM app.portfolio_transaction t
      LEFT JOIN app.universe u ON u.symbol = t.symbol
     WHERE t.user_id = ${session.userId} AND t.source_file = 'manual-entry'
     ORDER BY t.trade_date DESC, t.id DESC
  `;
  return NextResponse.json({
    trades: rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      name: r.company_name,
      broker: r.broker,
      brokerLabel: MANUAL_BROKER_LABEL[r.broker] ?? r.broker,
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
  const brokerRaw = String(body.broker ?? "other").toLowerCase().trim();
  const broker = (MANUAL_BROKERS as readonly string[]).includes(brokerRaw) ? brokerRaw : "other";
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
        (${session.userId}, ${broker}, ${date}, ${time}, ${side}, ${symbol}, ${symbol},
         ${company_name}, ${isin}, ${quantity}, ${price}, 'manual-entry', ${dedupKey})
    `;

    // If this hand entry duplicates trades we ALREADY imported (same symbol,
    // broker, date, side), flag it matched right away so it's greyed-out in the
    // Trade Log and excluded from P&L — the mirror of the import-time matcher.
    // Broker often splits one order into several fills, so we accept a quantity
    // that equals an individual imported fill OR the sum of that day's fills.
    const fills = await tx<{ quantity: number }[]>`
      SELECT quantity::float8 AS quantity
        FROM app.portfolio_transaction
       WHERE user_id = ${session.userId}
         AND source_file <> 'manual-entry'
         AND broker = ${broker}
         AND symbol = ${symbol}
         AND trade_date = ${date}
         AND side = ${side}
    `;
    if (fills.length > 0) {
      const qtys = fills.map((f) => f.quantity);
      const sum = Math.round(qtys.reduce((a, b) => a + b, 0) * 10000) / 10000;
      if (new Set([...qtys, sum]).has(quantity)) {
        await tx`
          UPDATE app.portfolio_transaction
             SET matched_at = now()
           WHERE user_id = ${session.userId} AND dedup_key = ${dedupKey}
        `;
      }
    }

    await recomputeDerivedHolding(tx, session.userId, symbol);
  });

  return NextResponse.json({
    ok: true,
    symbol,
    side,
    broker,
    brokerLabel: MANUAL_BROKER_LABEL[broker] ?? broker,
    quantity,
    price,
    date,
  });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^\d+$/.test(id))
    return NextResponse.json({ error: "valid numeric id required" }, { status: 400 });

  // Only hand-entered rows are deletable here (source_file='manual-entry') —
  // imported broker trades are read-only, even when a manual entry is tagged
  // with the same broker.
  const del = await sql<{ symbol: string }[]>`
    DELETE FROM app.portfolio_transaction
     WHERE id = ${Number(id)} AND user_id = ${session.userId}
       AND source_file = 'manual-entry'
     RETURNING symbol
  `;
  if (del.length === 0)
    return NextResponse.json({ error: "no such manual trade" }, { status: 404 });

  await recomputeDerivedHolding(sql, session.userId, del[0].symbol);
  return NextResponse.json({ ok: true });
}
