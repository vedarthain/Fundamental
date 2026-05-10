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
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <BanyanLogo />
          <span className="font-display text-[19px] tracking-tight leading-none">
            Fundamental
          </span>
          <span className="muted-text text-[11px] tracking-[0.1em] uppercase leading-none">
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
          <Link href="/discover" className="hover:text-[var(--color-accent-600)]">
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

function BanyanLogo() {
  // Stylized banyan tree mark — wide-canopy + thick trunk
  return (
    <svg width="36" height="32" viewBox="0 0 48 42" fill="none" aria-hidden="true">
      <line x1="3" y1="39.5" x2="45" y2="39.5" stroke="#a89070" strokeWidth="0.6" opacity="0.4" />
      <path d="M19 39 C 19.5 32, 21 26, 22 21 L 26 21 C 27 26, 28.5 32, 29 39 Z" fill="#6b4a2b" />
      <path d="M22 38 C 22.4 32, 23 26, 23.6 22" stroke="#8a6841" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.65" />
      <path d="M11 17 L 11 24" stroke="#7a5635" strokeWidth="1" strokeLinecap="round" opacity="0.85" />
      <path d="M16 19 L 16 27" stroke="#7a5635" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
      <path d="M32 19 L 32 27" stroke="#7a5635" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
      <path d="M37 17 L 37 24" stroke="#7a5635" strokeWidth="1" strokeLinecap="round" opacity="0.85" />
      <ellipse cx="24" cy="15" rx="16" ry="6.5" fill="#3d7536" opacity="0.55" />
      <ellipse cx="9"  cy="15" rx="6"  ry="4.5" fill="#4d8a3d" />
      <ellipse cx="15" cy="11" rx="6.5" ry="4.8" fill="#5a9b46" />
      <ellipse cx="24" cy="9"  rx="7.5" ry="5"   fill="#6aa84e" />
      <ellipse cx="33" cy="11" rx="6.5" ry="4.8" fill="#5a9b46" />
      <ellipse cx="39" cy="15" rx="6"  ry="4.5" fill="#4d8a3d" />
      <ellipse cx="19" cy="16" rx="4"  ry="2.8" fill="#7ab656" opacity="0.85" />
      <ellipse cx="29" cy="16" rx="4"  ry="2.8" fill="#7ab656" opacity="0.85" />
      <ellipse cx="24" cy="6"  rx="3.5" ry="2.4" fill="#86c45f" opacity="0.95" />
    </svg>
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
