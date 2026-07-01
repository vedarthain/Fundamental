/**
 * GET /api/admin/recommendations/generate — materialise locked reco cohorts.
 *
 * Admin-gated (er_admin cookie or ADMIN_EMAILS session). Idempotent: safe to
 * re-run — existing (cohort_date, symbol) rows are left untouched.
 *
 * Query:
 *   ?mode=latest   (default) — only the most-recent score snapshot. This is the
 *                              weekly call (wire a cron to hit it each Friday).
 *   ?mode=backfill           — every snapshot in the archive. Run once to seed
 *                              the ledger with history so the desk has a track
 *                              record from day one.
 *
 * Returns JSON: { inserted, skipped, cohorts }.
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAdminRequest } from "@/lib/auth";
import { generateCohorts } from "@/lib/recommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }
  const mode = req.nextUrl.searchParams.get("mode") ?? "latest";
  const onlyLatest = mode !== "backfill";
  try {
    const result = await generateCohorts({ onlyLatest });
    // Bust the desk's read cache so the new picks show immediately.
    revalidatePath("/admin/recommendations");
    return NextResponse.json({ mode: onlyLatest ? "latest" : "backfill", ...result });
  } catch (e) {
    return NextResponse.json(
      { error: "generation failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
