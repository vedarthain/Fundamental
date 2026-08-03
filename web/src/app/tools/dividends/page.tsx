import type { Metadata } from "next";
import { loadDividendUniverse } from "@/lib/dividendScanner";
import { sql } from "@/lib/db";
import DividendClient from "./DividendClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dividend Scanner — EquityRoots",
  description:
    "Browse the NSE universe by sector and peer industry to compare dividends: last four fiscal years of per-share payout, trailing dividend yield, LTP, and the fundamental composite — so income and quality are visible side by side.",
};

// /tools/dividends — sector → industry tree on the left, a sortable dividend
// table on the right. Loaded once server-side (small: symbols + a few numbers).
export default async function DividendsPage() {
  const [universe, n500] = await Promise.all([
    loadDividendUniverse(),
    sql<{ symbol: string }[]>`SELECT symbol FROM app.index_constituent WHERE index_code = 'NIFTY500'`,
  ]);
  return (
    <div className="theme-indigo mx-auto max-w-[1560px] px-6 py-10">
      <DividendClient universe={universe} nifty500={n500.map((r) => r.symbol)} />
    </div>
  );
}
