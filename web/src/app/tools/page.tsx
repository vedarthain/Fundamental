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
    href: "/tools/investing-trials",
    title: "Investing Trials",
    tagline: "Score with your own weights",
    body:
      "The platform's Industry Score weights Quality, Valuation, and Momentum based on cluster-tuned defaults. Investing Trials lets you set your own Q/V/M weights and see how the ranking shifts — useful for testing a thesis like 'pure value' or 'compounders only'.",
    useFor: [
      "Stress-test the platform's ranking",
      "Build a value-tilted or quality-tilted view",
      "Sanity-check stocks across different lenses",
    ],
    accent: "var(--color-score-good)",
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
    href: "/tools/momentum",
    title: "Scanner",
    tagline: "Where's the move — today's spike or a new trend",
    body:
      "Two daily scanners under one roof. Igniting today: stocks up ≥6% on ≥3× normal volume that broke a fresh 60-day high, each cross-checked against its news catalyst so pumps stand out. Trend Leaders: durable uptrends caught at the start — a 50-day average that just crossed above a rising 200-day (fresh golden cross) near the 52-week high, the FEDERALBNK-at-₹65 signal.",
    useFor: [
      "Catch breakouts early, on the ignition day",
      "Spot durable trends at initiation, not mid-run",
      "Filter both through fundamental quality",
    ],
    accent: "var(--color-accent-600)",
  },
  {
    href: "/tools/opportunities",
    title: "Correction Opportunities",
    tagline: "Strong businesses temporarily beaten down",
    body:
      "Quality stocks the market has been selling off — high Quality score confirms fundamentals are intact, high Valuation score means they are now cheap vs peers, low Momentum score is the correction signal. Filter by correction depth (6M vs market, 200d EMA trend) and growth rate to find genuine re-entry setups.",
    useFor: [
      "Find quality stocks at post-correction prices",
      "Filter by correction depth + profit growth",
      "Spot early recovery signals (EMA re-stack)",
    ],
    accent: "#dc2626",
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
            <span className="ink-text font-medium">Want a custom scoring lens?</span> Use{" "}
            <Link href="/tools/investing-trials" className="underline">Investing Trials</Link>{" "}
            — tweak Q/V/M weights, see the ranking shift.
          </li>
          <li>
            <span className="ink-text font-medium">Narrowed to a few candidates?</span> Use{" "}
            <Link href="/tools/peer-comparison" className="underline">Peer Comparison</Link>{" "}
            — same scorecard, side by side.
          </li>
          <li>
            <span className="ink-text font-medium">Want today&apos;s breakouts or a trend at its start?</span> Use{" "}
            <Link href="/tools/momentum" className="underline">Scanner</Link>{" "}
            — two tabs: stocks igniting on volume right now (with catalyst + score), and fresh golden crosses just beginning a durable uptrend.
          </li>
          <li>
            <span className="ink-text font-medium">Looking for post-correction re-entry setups?</span> Use{" "}
            <Link href="/tools/opportunities" className="underline">Correction Opportunities</Link>{" "}
            — quality stocks that have corrected, with depth and growth metrics to distinguish setups from traps.
          </li>
        </ul>
      </section>
    </div>
  );
}
