import Link from "next/link";
import type { Metadata } from "next";
import { StockSearch } from "@/components/StockSearch";

export const metadata: Metadata = {
  title: "Page Not Found — EquityRoots",
  robots: { index: false, follow: false },
};

const QUICK_LINKS = [
  { href: "/", label: "Home", desc: "Market overview & sector heatmap" },
  { href: "/stocks", label: "All Stocks", desc: "Full scored NSE universe" },
  { href: "/sectors", label: "Sectors", desc: "Peer-group rankings & scores" },
  { href: "/indices", label: "Indices", desc: "NIFTY & sector benchmarks" },
  { href: "/tools/screener", label: "Stock Screener", desc: "Filter by quality & valuation" },
  { href: "/tools/scanner", label: "Scanner", desc: "Trend leaders & breakouts" },
];

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <div
        className="rounded-xl border hairline p-6 sm:p-8 space-y-6 shadow-2xs"
        style={{ backgroundColor: "var(--color-card)" }}
      >
        <div className="space-y-2">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] muted-text">
            404 · Page Not Found
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
            We couldn&apos;t find that page or symbol.
          </h1>
          <p className="text-[13.5px] muted-text leading-relaxed">
            The ticker may have been renamed, delisted, or the URL might have a typo.
            Search for any NSE stock below or jump to a section.
          </p>
        </div>

        <div className="max-w-md">
          <StockSearch />
        </div>

        <div className="pt-4 border-t hairline">
          <div className="text-[11px] font-semibold uppercase tracking-wider muted-text mb-3">
            Popular Destinations
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {QUICK_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg border hairline p-3 hover:bg-[var(--color-paper)] transition-colors block"
              >
                <div className="text-[13px] font-semibold text-[var(--color-ink)]">
                  {item.label}
                </div>
                <div className="text-[11.5px] muted-text mt-0.5">{item.desc}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
