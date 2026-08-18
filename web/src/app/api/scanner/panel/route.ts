/**
 * GET /api/scanner/panel?panel=all|graph — on-demand data for the two heaviest
 * scanner tabs.
 *
 * "All stocks" (~2,100 rows) and "Graph" (the full candle universe) together
 * dominate the scanner's first-load payload (~1 MB serialized). They're no
 * longer shipped eagerly with the page; the client fetches them here the first
 * time the user opens that tab. Wrapped in the SAME unstable_cache keys/tags as
 * the page loaders, so this shares the hourly Data Cache (and the daily
 * "panel-cache" purge) rather than recomputing.
 */
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { loadAllStocks } from "@/lib/allStocks";
import { loadGraphUniverse } from "@/lib/graphUniverse";

export const dynamic = "force-dynamic";

const CACHE_TAGS = ["scanner", "panel-cache"];
const HOUR = 3600;

const cachedAllStocks = unstable_cache(loadAllStocks, ["scanner:allStocks:v1"], { revalidate: HOUR, tags: CACHE_TAGS });
const cachedGraphUniverse = unstable_cache(loadGraphUniverse, ["scanner:graph:v1"], { revalidate: HOUR, tags: CACHE_TAGS });

export async function GET(req: Request) {
  const panel = new URL(req.url).searchParams.get("panel");
  if (panel === "all") return NextResponse.json(await cachedAllStocks());
  if (panel === "graph") return NextResponse.json({ universe: await cachedGraphUniverse() });
  return NextResponse.json({ error: "unknown panel" }, { status: 400 });
}
