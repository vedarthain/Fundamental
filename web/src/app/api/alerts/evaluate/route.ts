/**
 * POST /api/alerts/evaluate — re-check ring-1 alerts for the signed-in user on
 * demand (the Alerts tab's "Check now" button). Same reconcile the daily cron
 * runs, scoped to the caller. Returns counts so the client can refresh + toast.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { evaluateAlerts } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const r = await evaluateAlerts(session.userId);
  return NextResponse.json({ ok: true, ...r });
}
