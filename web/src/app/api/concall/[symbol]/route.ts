import { NextRequest, NextResponse } from "next/server";
import { loadConcallsForSymbol } from "@/lib/concall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await ctx.params;
  if (!symbol || symbol.length > 24) {
    return NextResponse.json({ concalls: [] }, { status: 400 });
  }
  const concalls = await loadConcallsForSymbol(symbol, 6);
  return NextResponse.json(
    { concalls },
    { headers: { "Cache-Control": "public, max-age=120, s-maxage=600" } },
  );
}
