import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Correction Opportunities — Strong stocks beaten down by market · EquityRoots",
  description:
    "Fundamentally strong NSE stocks (high Quality + Valuation peer score) that have undergone a significant price correction. 6M vs market returns, 200-day EMA trend, 5Y profit CAGR and Return on Capital to separate genuine re-entry setups from value traps.",
};

export default function OpportunitiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
