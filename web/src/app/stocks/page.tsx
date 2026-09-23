import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { loadAllStocks } from "@/lib/allStocks";
import StocksClient from "./StocksClient";

// /stocks — the full scored universe, moved out of /tools/scanner?tab=all.
//
// WHY IT MOVED. Under the Scanner it was a tab among eight, sharing that page's
// rail, its universe toggle and its force-dynamic render — so the one view on
// the site that is just "every stock, sortable" could only be reached by
// opening a scanner first and was highlighted under Tools in the nav. It is a
// Segments destination, not a scanner, and it now has a path of its own.
//
// The ~1 MB payload that justified lazy-loading it via /api/scanner/panel is no
// longer a reason to defer: on this route it IS the page, so it ships with the
// first response instead of costing a second round-trip after mount.
//
// Same cache key as the API route deliberately — one Data Cache entry serves
// both, and the daily cron purge (/api/revalidate, tag "panel-cache") still
// busts it the moment new scores land.
const cachedAllStocks = unstable_cache(loadAllStocks, ["scanner:allStocks:v1"], {
  revalidate: 3600,
  tags: ["scanner", "panel-cache"],
});

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "All stocks — EquityRoots",
  description:
    "Every scored NSE company in one sortable table — price, 1-week to 1-year returns, fundamental score, industry rank and a price trend.",
};

export default async function StocksPage() {
  const { snapDate, rows } = await cachedAllStocks();
  return <StocksClient snapDate={snapDate} rows={rows} />;
}
