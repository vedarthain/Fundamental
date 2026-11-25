import { NextResponse } from "next/server";
import { loadOpportunities } from "@/lib/opportunitiesData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await loadOpportunities();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600",
    },
  });
}
