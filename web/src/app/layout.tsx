import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import { StockSearch } from "@/components/StockSearch";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "NSE Equity Intelligence",
  description:
    "Score-driven analysis of NSE-listed equities — sector-relative quality, valuation, and momentum scores with AI-generated narratives.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${sourceSerif.variable}`}>
      <body className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header
      className="border-b hairline sticky top-0 z-30 backdrop-blur-md"
      style={{ backgroundColor: "color-mix(in srgb, var(--color-paper) 90%, transparent)" }}
    >
      <div className="mx-auto max-w-[1300px] px-6 h-14 flex items-center gap-6">
        <Link href="/" className="flex items-baseline gap-2 shrink-0">
          <span className="font-display text-[19px] tracking-tight">
            Fundamental
          </span>
          <span className="muted-text text-[12px] tracking-wide uppercase">
            NSE
          </span>
        </Link>
        <div className="flex-1 flex justify-center">
          <StockSearch />
        </div>
        <nav className="flex items-center gap-6 text-[14px] shrink-0">
          <Link href="/clusters" className="hover:text-[var(--color-accent-600)]">
            Clusters
          </Link>
          <Link href="/screener" className="hover:text-[var(--color-accent-600)]">
            Discover
          </Link>
          <Link href="/feed" className="hover:text-[var(--color-accent-600)] hidden md:inline">
            Feed
          </Link>
          <Link href="/ideas" className="hover:text-[var(--color-accent-600)] hidden md:inline">
            Ideas
          </Link>
          <Link href="/about" className="hover:text-[var(--color-accent-600)] hidden lg:inline">
            Methodology
          </Link>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-16 border-t hairline">
      <div className="mx-auto max-w-[1200px] px-6 py-6 text-[12px] muted-text flex justify-between">
        <span>
          Fundamental — score-driven NSE equity intelligence
        </span>
        <span>
          Scores recompute weekly. Not investment advice.
        </span>
      </div>
    </footer>
  );
}
