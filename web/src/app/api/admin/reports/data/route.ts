import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { loadReportData } from "@/lib/reportData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized — admin only" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";
    const rows = await loadReportData(forceRefresh);

    return NextResponse.json(
      { ok: true, count: rows.length, rows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    console.error("Error in /api/admin/reports/data:", error);
    return NextResponse.json(
      { error: "Failed to load report extraction data", detail: error?.message || String(error) },
      { status: 500 }
    );
  }
}
