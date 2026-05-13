import type { Metadata } from "next";
import { Inter, Source_Serif_4, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { StockSearch } from "@/components/StockSearch";
import { SnapshotRibbon } from "@/components/SnapshotRibbon";
import { Analytics } from "@vercel/analytics/next";
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

// IBM Plex Mono — used by .num / .delta-* utilities for numeric cells.
// Pairs cleanly with Inter; reads as financial-data without the trader-terminal
// vibe of JetBrains Mono. Loaded via next/font so it's self-hosted, not a CDN.
const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  // Title pattern: brand — benefit. Front-loads the benefit so the OG card
  // and browser tab read as a value proposition, not just a name.
  title: "EquityRoots — Indian stocks, scored against their real peers",
  description:
    "Every NSE stock ranked on Quality, Valuation, and Momentum — within its true peer cluster. Find compounders, cheap-in-cluster names, and weekly movers without comparing apples to oranges.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${sourceSerif.variable} ${plexMono.variable}`}>
      <body className="min-h-screen flex flex-col">
        <SnapshotRibbon />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header
      className="border-b hairline sticky top-7 z-30 backdrop-blur-md"
      style={{ backgroundColor: "color-mix(in srgb, var(--color-paper) 90%, transparent)" }}
    >
      {/* Desktop layout: logo + centered search + nav.
          Mobile layout: logo + nav inline (no search to save space). The
          search is reachable from /discover and stock cards, so dropping
          it from mobile chrome is fine. Without this fix the search bar
          eats all the horizontal space and pushes Clusters/Discover off
          the right edge. */}
      <div className="mx-auto max-w-[1300px] px-4 md:px-6 h-14 flex items-center gap-3 md:gap-6">
        <Link href="/" className="flex items-center gap-2 md:gap-2.5 shrink-0">
          <BanyanLogo />
          <span className="font-display text-[17px] md:text-[19px] tracking-tight leading-none">
            EquityRoots
          </span>
          <span className="muted-text text-[10px] md:text-[11px] tracking-[0.1em] uppercase leading-none hidden sm:inline">
            NSE
          </span>
        </Link>
        {/* Search hides on mobile — it dominates the bar on narrow widths.
            Users open /discover for search-as-they-type instead. */}
        <div className="flex-1 justify-center hidden md:flex">
          <StockSearch />
        </div>
        {/* Top nav — all 4 surfaces visible on mobile now. Smaller font + gap on
            mobile to fit comfortably alongside the logo. */}
        <nav className="flex items-center gap-3 md:gap-6 text-[13px] md:text-[14px] shrink-0 ml-auto">
          <Link href="/clusters" className="hover:text-[var(--color-accent-600)]">
            Sectors
          </Link>
          <Link href="/discover" className="hover:text-[var(--color-accent-600)]">
            Discover
          </Link>
          <Link href="/feed" className="hover:text-[var(--color-accent-600)]">
            Feed
          </Link>
          <Link href="/ideas" className="hover:text-[var(--color-accent-600)]">
            Ideas
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
  // Four-column footer in the Zerodha mould: brand block on the left, then
  // Product / Learn / Surfaces / About. The "Surfaces" column deep-links into
  // pre-filtered Ideas buckets — saves the user a click and exposes that the
  // platform has multiple analytical lenses on the same data.
  return (
    <footer className="mt-20 border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="mx-auto max-w-[1300px] px-6 py-10">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <BanyanLogo />
              <span className="font-display text-[18px] tracking-tight leading-none">
                EquityRoots
              </span>
            </Link>
            <p className="text-[12px] muted-text leading-relaxed max-w-[260px]">
              Indian stocks, scored against their real peers. Quality,
              Valuation, and Momentum percentiles — recomputed weekly,
              never edited.
            </p>
            <p className="text-[11px] muted-text mt-4 leading-relaxed">
              © 2026, EquityRoots.<br />Information surface only — not investment advice.
            </p>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { href: "/clusters", label: "Sectors" },
              { href: "/discover", label: "Discover" },
              { href: "/compare",  label: "Peer comparison" },
              { href: "/feed",     label: "Feed" },
              { href: "/ideas",    label: "Ideas" },
            ]}
          />

          <FooterColumn
            title="Learn"
            links={[
              { href: "/about",    label: "Methodology" },
              { href: "/glossary", label: "Glossary of ratios" },
              { href: "/about#pipeline",        label: "How scores are built" },
              { href: "/about#why-peer-relative", label: "Why peer-relative" },
            ]}
          />

          <FooterColumn
            title="Surfaces"
            links={[
              { href: "/ideas?bucket=compounder",  label: "Quality compounders" },
              { href: "/ideas?bucket=cheap",       label: "Cheap in cluster" },
              { href: "/ideas?bucket=promoter_up", label: "Promoter accumulation" },
              { href: "/ideas?bucket=fii_up",      label: "FII accumulation" },
              { href: "/feed?dir=down",            label: "Biggest losers" },
            ]}
          />

          <FooterColumn
            title="About"
            links={[
              { href: "/about",                       label: "About the platform" },
              { href: "/about#data-sources",          label: "Data sources" },
              { href: "/about#what-we-dont-publish",  label: "What we don't publish" },
            ]}
          />
        </div>

        <div className="mt-10 pt-6 border-t hairline flex flex-wrap items-center justify-between gap-3 text-[11px] muted-text">
          <span>Snapshots recompute every Friday after market close · Coverage: NSE actively-traded universe</span>
          <span>Built for thinking, not trading.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <div className="text-[13px] font-medium mb-3" style={{ color: "var(--color-ink)" }}>
        {title}
      </div>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link
              href={l.href}
              className="text-[12.5px] muted-text hover:text-[var(--color-accent-600)] transition-colors"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
