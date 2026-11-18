import { NextResponse } from "next/server";
import { getLiveIndices, type IndexQuote } from "@/lib/liveIndices";

export type { IndexQuote };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getLiveIndices();
  return NextResponse.json(
    {
      nifty: payload.nifty,
      bankNifty: payload.bankNifty,
      source: payload.source,
      fetchedAt: payload.fetchedAt,
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
  );
}
