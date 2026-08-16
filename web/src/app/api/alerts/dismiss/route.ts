/**
 * POST /api/alerts/dismiss — ack one alert for the signed-in user. Body: {id}.
 * Flips status active → dismissed; the card greys out and won't re-fire until
 * its condition clears and re-crosses (a new episode). Scoped to the caller's
 * own rows, so an id from another user is a silent noop (returns dismissed:false).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dismissAlert } from "@/lib/alerts";
import { dismissPriceAlert, PRICE_ALERT_RULE } from "@/lib/price-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    ruleKey?: unknown;
  };
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  // Price-alert cards live in a different table (app.price_alert); route by the
  // card's ruleKey so the id is dismissed against the right source.
  const dismissed =
    body.ruleKey === PRICE_ALERT_RULE
      ? await dismissPriceAlert(session.userId, id)
      : await dismissAlert(session.userId, id);
  return NextResponse.json({ ok: true, dismissed });
}
