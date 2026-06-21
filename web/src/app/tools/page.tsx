import Link from "next/link";
import type { Metadata } from "next";

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

type ToolCard = {
  href: string;
  title: string;
  tagline: string;
  body: string;
  useFor: string[];
  // Accent color used for the card's top border + the "Open →" CTA hover.
  accent: string;
};

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
          Three purpose-built tools for specific analysis jobs. If you just want
          to browse the universe by sector and industry, use{" "}
          <Link href="/sectors" className="underline hover:no-underline">
            Sectors
          </Link>
          {" "}instead — that&apos;s the navigation surface.
        </p>
      </header>

      <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
        {TOOLS.map((t) => (
          <ToolCardView key={t.href} tool={t} />
        ))}
      </div>

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
        </ul>
      </section>
    </div>
  );
}

function ToolCardView({ tool }: { tool: ToolCard }) {
  return (
    <Link
      href={tool.href}
      className="card p-5 flex flex-col gap-3 transition-all hover:shadow-md hover:-translate-y-[2px]"
      style={{ borderTop: `3px solid ${tool.accent}` }}
    >
      <div>
        <div className="font-display text-[19px] tracking-tight leading-tight">
          {tool.title}
        </div>
        <div className="muted-text italic text-[12.5px] mt-1">{tool.tagline}</div>
      </div>
      <p className="text-[13px] leading-[1.55] muted-text">{tool.body}</p>
      <div className="mt-1">
        <div className="text-[10.5px] uppercase tracking-wide muted-text mb-1.5">
          Best for
        </div>
        <ul className="space-y-1 text-[12px] leading-[1.4]">
          {tool.useFor.map((u) => (
            <li key={u} className="flex gap-2">
              <span style={{ color: tool.accent }} aria-hidden>•</span>
              <span>{u}</span>
            </li>
          ))}
        </ul>
      </div>
      <div
        className="mt-auto pt-2 text-[13px] font-medium inline-flex items-center gap-1"
        style={{ color: tool.accent }}
      >
        Open {tool.title} <span aria-hidden>→</span>
      </div>
    </Link>
  );
}
