import Link from "next/link";
import type { Metadata } from "next";
import ToolsAccordion, { type ToolCard } from "./tools-accordion";

export const metadata: Metadata = {
  title: "Tools — EquityRoots",
  description:
    "Advanced features for stock research: filter the universe by criteria, set your own scoring weights, and compare stocks side by side.",
};

// /tools — landing page that introduces the three specialized tools and links
// into each. Sits alongside /sectors (browse) in the top nav. The split is:
//   Sectors — pure browse surface (pick sector → industry → stocks)
//   Tools   — purpose-built features for specific analysis jobs
// Each tool card carries enough copy that a first-time visitor can pick the
// right one without trial-and-error.

const TOOLS: ToolCard[] = [
  {
    href: "/tools/screener",
    title: "Stock Screener",
    tagline: "Filter the universe by criteria",
    body:
      "Set minimum thresholds on Quality, Valuation, and Momentum scores. Narrow by sector, industry, index membership, maturity, or market cap. See a ranked list with Industry Score and peer rank for every match.",
    useFor: [
      "Find compounders with Quality ≥ 70",
      "Locate cheap names in a specific sector",
      "Surface large-caps with strong momentum",
    ],
    accent: "var(--color-accent-600)",
  },
  {
    href: "/tools/peer-comparison",
    title: "Peer Comparison",
    tagline: "Stack 2-5 stocks side by side",
    body:
      "Pick any 2-5 stocks and see them on the same scorecard. Best for short-listed candidates — once you've narrowed to a few names via the Screener or Sectors browser, use this to compare them directly.",
    useFor: [
      "Compare HDFCBANK vs ICICIBANK vs Kotak",
      "Stack top peers in a cluster",
      "Final-round decision between shortlisted stocks",
    ],
    accent: "var(--color-score-weak)",
  },
  {
    href: "/tools/52-week-high-low",
    title: "52-Week High / Low",
    tagline: "Stocks at price extremes, by segment",
    body:
      "Every stock sitting at or near its 52-week high or low, filterable by index segment (Nifty 50 / 100 / 200 / 500 / All). End-of-day prices from the archive, with each name's Industry Score as a quality cue and a link to its scorecard.",
    useFor: [
      "Spot fresh 52-week highs in the Nifty 100",
      "Find large-caps near their 52-week low",
      "Gauge how broad a rally or sell-off is",
    ],
    accent: "var(--color-score-good)",
  },
  {
    href: "/tools/scanner",
    title: "Scanner",
    tagline: "Where's the move — spikes, trends, floors, fallen quality & rotation",
    body:
      "Every daily scanner under one roof. Igniting today: stocks up ≥6% on ≥3× normal volume that broke a fresh 60-day high, cross-checked against news so pumps stand out. Trend Leaders: durable uptrends caught at the start (fresh golden cross near the 52-week high). At Support: names sitting on a multi-year tested floor. Fallen Leaders: quality businesses temporarily beaten down. Dividends: income by sector — per-share payout over four fiscal years, trailing yield & composite. Plus sector and peer-group rotation maps.",
    useFor: [
      "Catch breakouts early, on the ignition day",
      "Spot durable trends at initiation, not mid-run",
      "Find beaten-down quality and see where money is rotating",
      "Hunt sustainable dividend yields, not yield traps",
    ],
    accent: "var(--color-accent-600)",
  },
  {
    href: "/tools/alerts",
    title: "Alerts",
    tagline: "The few holdings that need a look today",
    body:
      "Watches the stocks you hold and flags only what's actionable — a name that hit your +25% profit target, dropped sharply in a single day, or fell 20% below your cost. Each card says exactly why it fired; dismiss to acknowledge and it won't return until the condition clears and re-crosses. Re-evaluated daily and whenever you open the tab.",
    useFor: [
      "See which holdings reached your profit target",
      "Catch a sharp down day on a name you own",
      "Get warned when a position is deep underwater",
    ],
    accent: "var(--color-score-weak)",
  },
  {
    href: "/tools/universe-changes",
    title: "Universe Changes",
    tagline: "What joined and left the tracked universe, week by week",
    body:
      "The weekly reconciliation against NSE's live listing master, kept as an append-only log — every fresh listing we onboard shows as added, every name that goes dark as removed. Grouped by week so you can watch the coverage evolve; no week is ever overwritten. Click any name to open its scorecard.",
    useFor: [
      "See which new listings were onboarded this week",
      "Track names retired for going dark on NSE",
      "Explain a shift in the 'stocks tracked' count",
    ],
    accent: "var(--color-score-good)",
  },
];

export default function ToolsLanding() {
  return (
    <div className="theme-indigo mx-auto max-w-[1100px] px-6 py-10">
      <header className="max-w-[640px]">
        <div className="eyebrow mb-3">Specialized features</div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight">
          Tools
        </h1>
        <p className="muted-text mt-3 text-[15px] leading-[1.55]">
          Purpose-built tools for specific analysis jobs. If you just want
          to browse the universe by sector and industry, use{" "}
          <Link href="/sectors" className="underline hover:no-underline">
            Sectors
          </Link>
          {" "}instead — that&apos;s the navigation surface.
        </p>
      </header>

      <ToolsAccordion tools={TOOLS} />

      <section className="mt-12 card p-5 max-w-[820px]">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">
          When to use which
        </div>
        <ul className="space-y-1.5 text-[13.5px] leading-[1.55]">
          <li>
            <span className="ink-text font-medium">Browsing?</span> Use{" "}
            <Link href="/sectors" className="underline">Sectors</Link>{" "}
            — pick a sector, scan industries, drill into stocks.
          </li>
          <li>
            <span className="ink-text font-medium">Have specific criteria?</span> Use{" "}
            <Link href="/tools/screener" className="underline">Stock Screener</Link>{" "}
            — set thresholds, see all matches ranked.
          </li>
          <li>
            <span className="ink-text font-medium">Narrowed to a few candidates?</span> Use{" "}
            <Link href="/tools/peer-comparison" className="underline">Peer Comparison</Link>{" "}
            — same scorecard, side by side.
          </li>
          <li>
            <span className="ink-text font-medium">Want today&apos;s breakouts, a trend at its start, or beaten-down quality?</span> Use{" "}
            <Link href="/tools/scanner" className="underline">Scanner</Link>{" "}
            — tabs for stocks igniting on volume now (with catalyst + score), fresh golden crosses, stocks at multi-year support, Fallen Leaders (corrected quality), dividends by sector, and sector/peer rotation.
          </li>
          <li>
            <span className="ink-text font-medium">Own stocks and want to be told when to look?</span> Use{" "}
            <Link href="/tools/alerts" className="underline">Alerts</Link>{" "}
            — flags holdings that hit your target, fell hard today, or are deep underwater; dismiss to acknowledge.
          </li>
          <li>
            <span className="ink-text font-medium">Wondering what changed in our coverage?</span> Use{" "}
            <Link href="/tools/universe-changes" className="underline">Universe Changes</Link>{" "}
            — the weekly log of stocks added to and removed from the tracked universe.
          </li>
        </ul>
      </section>
    </div>
  );
}
