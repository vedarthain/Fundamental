/**
 * User price alerts on the stock chart.
 *
 *   POST   /api/alerts/price   { symbol, price }  → create an armed line
 *   PATCH  /api/alerts/price   { id, price }      → change a line's price
 *   DELETE /api/alerts/price   { id }             → remove a line
 *
 * Direction is inferred server-side (see createPriceAlert). All are scoped to
 * the signed-in caller; a foreign id is a silent noop.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createPriceAlert,
  updatePriceAlert,
  deletePriceAlert,
  loadLivePriceAlerts,
} from "@/lib/price-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/alerts/price → every live line (armed + triggered) for the caller.
 *  The scanner graph reads this once to draw lines + the grey "A" per card. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const alerts = await loadLivePriceAlerts(session.userId);
  return NextResponse.json({ ok: true, alerts });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    symbol?: unknown;
    price?: unknown;
  };
  const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
  const price = Number(body.price);
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  const res = await createPriceAlert(session.userId, symbol, price);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, alert: res.alert });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    price?: unknown;
  };
  const id = Number(body.id);
  const price = Number(body.price);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const res = await updatePriceAlert(session.userId, id, price);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, alert: res.alert });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const deleted = await deletePriceAlert(session.userId, id);
  return NextResponse.json({ ok: true, deleted });
}
