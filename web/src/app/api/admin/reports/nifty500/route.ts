/**
 * GET /api/admin/reports/nifty500 — download the NIFTY 500 Scorecard as .xlsx.
 *
 * Admin-gated. Generates on demand from Neon (latest cache snapshot + live 1D
 * from golden) and streams the workbook as an attachment. No local step.
 */
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { buildNifty500Workbook } from "@/lib/nifty500Report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }
  try {
    const { buffer, snapshot } = await buildNifty500Workbook();
    const fname = `NIFTY500-Scorecard-${snapshot ?? "latest"}.xlsx`;
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "report failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
