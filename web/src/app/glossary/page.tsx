/**
 * /glossary — fundamental ratios reference.
 *
 * One-page explainer for every ratio that drives the platform's scoring
 * (and a few standard ones investors expect to see). Each entry has a
 * consistent shape:
 *
 *   - name + short tagline
 *   - formula in monospace (the math)
 *   - "what it tells you" — plain-English
 *   - high vs low interpretation
 *   - caveats / common pitfalls
 *
 * Organised by category (Profitability / Growth / Valuation / Balance Sheet
 * / Cash Flow / Momentum / Ownership) with sticky table-of-contents in the
 * left sidebar so users can jump to a specific ratio without scrolling.
 *
 * The page is intentionally text-dense — it's reference material, not a
 * dashboard. Color comes only from category accents on each card's top
 * border, so the eye picks out groupings without visual noise.
 *
 * Theme: indigo (matches /discover — both are "reading / filtering"
 * surfaces) to keep the page distinct from the terracotta brand pages.
 */
import Link from "next/link";
import { MetricViz, type MetricExample } from "@/components/MetricViz";

export const revalidate = 86400; // static-ish; only changes when we add ratios

type Entry = {
  name: string;
  tagline: string;
  formula: string;
  meaning: string;
  high: string;
  low: string;
  caveats?: string;
  // Optional worked numerical example. When present, renders an animated
  // formula plug-in + a 5-tier band gauge below the meaning block so
  // readers see what the ratio looks like for a real Indian stock and
  // where the value lands on the scoring scale.
  example?: MetricExample;
};

type Category = {
  id: string;
  title: string;
  blurb: string;
  color: string; // accent stripe color
  entries: Entry[];
};

const CATEGORIES: Category[] = [
  {
    id: "profitability",
    title: "Profitability",
    blurb:
      "How much profit the business squeezes out of its sales, assets, and equity. The core of the Quality pillar.",
    color: "var(--color-score-good)",
    entries: [
      {
        name: "Return on Equity (RoE)",
        tagline: "How much profit per ₹1 of shareholder capital.",
        formula: "RoE = Net Profit ÷ Shareholder Equity",
        meaning:
          "What return the business is generating on the money owners have invested. The single most-cited quality metric in Indian investing.",
        high: "≥ 18% sustained is excellent; ≥ 15% is good. Compounders cluster here.",
        low: "< 10% suggests the business is destroying or barely preserving capital.",
        caveats:
          "RoE can be inflated by debt (more leverage → higher RoE without better operations). Always read alongside RoCE and Debt/Equity.",
        example: {
          context: "TITAN FY24",
          parts: [
            { label: "Net Profit",  display: "₹3,496 cr" },
            { label: "Equity",      display: "₹11,520 cr" },
          ],
          result: { display: "30.3%", numeric: 30.3 },
          bands: [
            { upTo: 10, label: "Poor",      tone: "poor" },
            { upTo: 15, label: "Weak",      tone: "weak" },
            { upTo: 18, label: "OK",        tone: "neutral" },
            { upTo: 25, label: "Good",      tone: "good" },
            { upTo: 40, label: "Excellent", tone: "excellent" },
          ],
          note: "Well above the 18% compounder threshold — TITAN earns ₹0.30 of profit per ₹1 of shareholder equity each year.",
        },
      },
      {
        name: "Return on Capital Employed (RoCE)",
        tagline: "RoE adjusted for capital structure — the cleaner quality signal.",
        formula: "RoCE = EBIT ÷ (Total Assets − Current Liabilities)",
        meaning:
          "Return on all the long-term capital in the business — equity AND debt. Strips out the leverage flattery RoE suffers from.",
        high: "≥ 20% sustained is the compounder zone. Asian Paints, Page Industries.",
        low: "< 12% is mediocre for a non-bank; below cost-of-capital for many.",
        caveats:
          "Comparing RoCE across industries is fair only roughly — capital-light IT services vs capital-heavy cement aren't apples-to-apples.",
      },
      {
        name: "Return on Assets (RoA)",
        tagline: "How efficiently the asset base earns.",
        formula: "RoA = Net Profit ÷ Total Assets",
        meaning:
          "The bank's-eye view of profitability. For banks, a 1% RoA on a ₹10L crore book is the standard benchmark.",
        high: "Banks: ≥ 1.2% is good. Manufacturers: ≥ 10% is good.",
        low: "Banks: < 0.5% is weak. Non-banks: < 4% is weak.",
        caveats:
          "Mixing asset-heavy and asset-light companies makes this meaningless. Use within a peer cluster.",
      },
      {
        name: "Operating Profit Margin (OPM)",
        tagline: "How much of every ₹1 of sales is operating profit.",
        formula: "OPM = Operating Profit ÷ Revenue",
        meaning:
          "Pricing power + cost discipline rolled into one number. The most-watched margin for non-financial businesses.",
        high:
          "Highly variable by industry. SaaS ≥ 25%, FMCG ≥ 20%, autos 8–12%, commodities 5–10%.",
        low:
          "OPM trending DOWN over 3–5 years is the warning — even if the absolute level looks fine.",
        caveats:
          "Operating profit includes depreciation in most Indian filings. Look at EBITDA margin separately if comparing across capex profiles.",
      },
      {
        name: "Net Profit Margin (NPM)",
        tagline: "Profit after interest and taxes, as % of sales.",
        formula: "NPM = Net Profit ÷ Revenue",
        meaning:
          "The bottom line, scaled. Captures how much of revenue actually reaches shareholders after all costs.",
        high: "≥ 15% is strong for most non-financials.",
        low: "Sub-5% margins make the business fragile — a small input cost shock wipes it out.",
        caveats:
          "Net margins move with one-off items (tax benefits, asset sales). OPM and EBITDA margin are cleaner for trend analysis.",
      },
      {
        name: "Gross Margin",
        tagline: "Pricing power before fixed costs.",
        formula: "Gross Margin = (Revenue − COGS) ÷ Revenue",
        meaning:
          "What's left after the cost of making the product, before paying rent, marketing, R&D, etc. The purest pricing-power measure.",
        high: "Software ≥ 70%, branded consumer ≥ 50%, commodities 15–25%.",
        low: "Falling gross margins = either rising input costs OR competitive price war.",
      },
    ],
  },

  {
    id: "growth",
    title: "Growth",
    blurb:
      "How fast the top line, bottom line, and book value are compounding. Quality + Momentum both lean on these.",
    color: "var(--color-accent-500)",
    entries: [
      {
        name: "Revenue CAGR (3y, 5y, 10y)",
        tagline: "The fundamental compounding rate.",
        formula: "CAGR = (End ÷ Start)^(1/years) − 1",
        meaning:
          "How fast sales have grown on a compounded basis. We look at 3, 5, and 10 year windows so a single hot year doesn't dominate.",
        high: "≥ 15% sustained over 5y is excellent. ≥ 10% is good for mature businesses.",
        low: "< 5% sustained = either a stagnant industry or losing share. Check both before concluding.",
        caveats:
          "Revenue growth alone is hollow without margin discipline — a company can grow revenue 30% while losing money on every sale.",
      },
      {
        name: "Earnings CAGR (PAT)",
        tagline: "Bottom-line compounding.",
        formula: "Earnings CAGR = (End PAT ÷ Start PAT)^(1/years) − 1",
        meaning:
          "Should be at or above Revenue CAGR for a healthy business — earnings growing faster than sales means margins are expanding.",
        high: "Earnings CAGR ≥ Revenue CAGR consistently = a compounding machine.",
        low: "Earnings CAGR << Revenue CAGR = the business is buying revenue with margin.",
      },
      {
        name: "Operating Margin Trend",
        tagline: "Are margins improving, flat, or eroding?",
        formula: "5-year slope of operating margin (% per year)",
        meaning:
          "Whether the business is gaining or losing pricing power / cost discipline over time. A 5-year up-slope is a strong quality signal.",
        high: "+0.5 pp/year or more sustained = expanding economics. Rare and valuable.",
        low: "Negative slope over 3+ years = competitive pressure or input-cost pressure.",
      },
    ],
  },

  {
    id: "valuation",
    title: "Valuation",
    blurb:
      "Price relative to fundamentals. Higher percentile here means CHEAPER vs peers, not more expensive.",
    color: "var(--color-accent-400)",
    entries: [
      {
        name: "P/E Ratio (Price to Earnings)",
        tagline: "How many years of current earnings the market is paying for.",
        formula: "P/E = Market Price per Share ÷ Earnings per Share (EPS)",
        meaning:
          "The most-quoted ratio in retail investing — and often the most misused. A P/E of 25 means you pay ₹25 today for ₹1 of annual earnings.",
        high:
          "High P/E = market expects future earnings to grow. Justified if growth is real; a trap if expectations slip.",
        low:
          "Low P/E = market is skeptical. Could be cheap; could be earning a real warning.",
        caveats:
          "Compare only within an industry. A bank's natural P/E (10–18) is nothing like a software company's natural P/E (25–60). And avoid trailing P/E on cyclical businesses — peak earnings make them look cheaper than they are.",
        example: {
          context: "TCS FY24",
          parts: [
            { label: "Share Price", display: "₹3,940" },
            { label: "EPS",         display: "₹124" },
          ],
          result: { display: "31.8×", numeric: 31.8 },
          bands: [
            // For P/E, lower = cheaper. Bands inverted: low band is "excellent value",
            // high band is "expensive". Compared against the IT services industry norm
            // (~25–35×) — not the broad market.
            { upTo: 15, label: "Cheap",     tone: "excellent" },
            { upTo: 22, label: "Reasonable",tone: "good" },
            { upTo: 30, label: "Fair",      tone: "neutral" },
            { upTo: 40, label: "Rich",      tone: "weak" },
            { upTo: 60, label: "Frothy",    tone: "poor" },
          ],
          note: "Around the upper end of fair for Indian IT services — investors are pricing in continued earnings growth. Pricier than HCLTECH (~24×), cheaper than INFY (~28×).",
        },
      },
      {
        name: "P/B Ratio (Price to Book)",
        tagline: "Price per ₹1 of accounting net worth.",
        formula: "P/B = Market Cap ÷ Shareholder Equity",
        meaning:
          "How much premium to book value the market is paying. Most useful for banks and asset-heavy businesses where book reflects real assets.",
        high: "P/B > 5 needs to be justified by RoE. HDFC Bank at P/B 3.5 with RoE 17% works; the same multiples on a 12% RoE bank don't.",
        low: "P/B < 1 = market thinks the stated book is impaired. Sometimes it is.",
      },
      {
        name: "EV/EBITDA",
        tagline: "Enterprise value vs operating cash earnings.",
        formula: "EV ÷ EBITDA, where EV = Market Cap + Debt − Cash",
        meaning:
          "P/E's cleaner cousin — strips out leverage and tax differences so you can compare across capital structures. The standard valuation metric in equity research.",
        high: "EV/EBITDA above 20× implies very fast growth assumed.",
        low: "Cyclicals trade at 5–8× near peaks; that's still expensive if earnings collapse.",
      },
      {
        name: "Free Cash Flow Yield",
        tagline: "How much cash you'd get back per ₹100 invested.",
        formula: "FCF Yield = Free Cash Flow ÷ Market Cap × 100",
        meaning:
          "Cash earnings divided by what you pay for the company. The most rigorous valuation lens — companies can't fake cash flow as easily as accounting earnings.",
        high: "≥ 5% is attractive on a stable business. ≥ 8% is rare and worth investigating.",
        low: "Negative FCF Yield is fine for a growth company (capex phase); a problem for a mature one.",
      },
      {
        name: "Dividend Yield",
        tagline: "Cash returned to shareholders, as % of price.",
        formula: "Dividend Yield = Annual DPS ÷ Market Price × 100",
        meaning:
          "What you collect just for holding the share. PSU banks and utilities often anchor here; growth-mode tech rarely.",
        high: "≥ 4% is a real cash return on Indian large-caps. Watch sustainability.",
        low: "Sub-1% is normal for compounders that reinvest everything.",
        caveats:
          "Very high yields (8%+) often mean the market has marked the stock down because dividends are about to be cut.",
      },
      {
        name: "PEG Ratio",
        tagline: "P/E adjusted for growth.",
        formula: "PEG = P/E ÷ Earnings Growth Rate (%)",
        meaning:
          "A P/E of 30 looks expensive — until you see 30% earnings growth. PEG normalizes that. The classic Peter Lynch metric.",
        high: "PEG > 2 = paying up. Sometimes justified for high-quality.",
        low: "PEG < 1 = potentially undervalued at the growth rate it's posting.",
      },
    ],
  },

  {
    id: "balance-sheet",
    title: "Balance Sheet & Solvency",
    blurb:
      "Can the business survive a downturn? The plumbing — debt, liquidity, capital structure.",
    color: "var(--color-accent-600)",
    entries: [
      {
        name: "Debt to Equity (D/E)",
        tagline: "How leveraged the balance sheet is.",
        formula: "D/E = Total Debt ÷ Shareholder Equity",
        meaning:
          "How many rupees of debt for every rupee of owner capital. Higher leverage amplifies both gains AND losses.",
        high: "Manufacturers: > 1.5 = aggressive. Tech/services: > 0.5 is rare and concerning.",
        low: "Net cash (D/E < 0 after netting cash) is a fortress balance sheet.",
        caveats:
          "Banks and NBFCs run on D/E of 8–12 by design — comparing them to manufacturers is meaningless.",
        example: {
          context: "ASIANPAINT FY24",
          parts: [
            { label: "Total Debt", display: "₹2,580 cr" },
            { label: "Equity",     display: "₹17,400 cr" },
          ],
          result: { display: "0.15×", numeric: 0.15 },
          bands: [
            // Lower = safer. Bands inverted (low value = excellent).
            // Tuned for non-financial manufacturing / consumer firms.
            { upTo: 0.3, label: "Fortress",   tone: "excellent" },
            { upTo: 0.6, label: "Healthy",    tone: "good" },
            { upTo: 1.0, label: "Moderate",   tone: "neutral" },
            { upTo: 1.5, label: "Stretched",  tone: "weak" },
            { upTo: 3.0, label: "Risky",      tone: "poor" },
          ],
          note: "Near-zero leverage — Asian Paints funds growth almost entirely from internal cash. Survives any downturn without a forced equity raise.",
        },
      },
      {
        name: "Debt to EBITDA",
        tagline: "Years of cash earnings to repay debt.",
        formula: "Net Debt ÷ EBITDA",
        meaning:
          "If the company stopped reinvesting and used all operating cash to pay down debt, how many years would it take?",
        high: "> 4× = stretched. > 6× = the rating agencies start downgrading.",
        low: "< 2× is comfortable. < 0 (net cash) is excellent.",
      },
      {
        name: "Interest Coverage Ratio",
        tagline: "How easily the company can pay interest on its debt.",
        formula: "EBIT ÷ Interest Expense",
        meaning:
          "Operating profit divided by interest payments. The first thing lenders look at; the first thing that breaks in a downturn.",
        high: "≥ 5× is healthy. ≥ 10× is excellent.",
        low: "< 2× = one bad quarter from a default. < 1× means the business isn't earning its interest.",
      },
      {
        name: "Current Ratio",
        tagline: "Short-term solvency — can it pay its bills?",
        formula: "Current Assets ÷ Current Liabilities",
        meaning:
          "Whether the company has enough short-term assets (cash, receivables, inventory) to cover what it owes in the next 12 months.",
        high: "≥ 1.5 is comfortable; many businesses run leaner without trouble.",
        low: "< 1 is a yellow flag — chronic working-capital stress.",
      },
      {
        name: "Quick Ratio (Acid Test)",
        tagline: "Current ratio without inventory.",
        formula: "(Cash + Receivables) ÷ Current Liabilities",
        meaning:
          "The harsher liquidity test — excludes inventory because inventory can't always be sold quickly without discounts.",
        high: "≥ 1 = no liquidity issue.",
        low: "< 0.5 = the business is one bad month away from paying suppliers late.",
      },
    ],
  },

  {
    id: "cash-flow",
    title: "Cash Flow",
    blurb:
      "Reported earnings can be massaged with accounting choices. Cash flow tells you what actually came in.",
    color: "var(--color-score-excellent)",
    entries: [
      {
        name: "Operating Cash Flow (OCF)",
        tagline: "Cash generated by the core business.",
        formula: "Net Profit + Non-cash charges − Working Capital changes",
        meaning:
          "The cash that actually came in from running the business — before any capex or financing. The single hardest number to fake.",
        high: "Positive and growing OCF is the hallmark of a real business.",
        low: "Persistently negative OCF for a non-growth-stage company is a red flag.",
      },
      {
        name: "Free Cash Flow (FCF)",
        tagline: "OCF after the capex the business needs to maintain itself.",
        formula: "FCF = OCF − Capital Expenditure",
        meaning:
          "What's left for shareholders, debt repayment, or M&A after the business invests in its own continuation. The cleanest measure of value generation.",
        high: "Consistently positive FCF over a full cycle = real business.",
        low: "Companies in heavy capex phase have negative FCF — fine if returns will come; bad if it's just kicking the can.",
      },
      {
        name: "Cash Conversion (CFO/PAT)",
        tagline: "How much of reported profit becomes actual cash.",
        formula: "CFO ÷ Net Profit",
        meaning:
          "If a company reports ₹100 of profit and brings in ₹95 of cash, conversion is 95% — healthy. If it brings in ₹40, the rest is sitting in receivables or inventory.",
        high: "≥ 80% sustained = high-quality earnings.",
        low: "< 60% over multiple years = accounting earnings ≠ economic earnings. Investigate.",
        caveats:
          "Growing businesses can show low conversion temporarily as working capital builds. Look at the multi-year average.",
      },
    ],
  },

  {
    id: "momentum",
    title: "Momentum (Technical)",
    blurb:
      "How the stock has moved vs the market, and how fundamentals are accelerating. Drives the Momentum pillar.",
    color: "var(--color-accent-300)",
    entries: [
      {
        name: "3M / 6M / 12M Relative Return",
        tagline: "Outperformance vs the broader market.",
        formula: "(Stock Return − Index Return) over the period",
        meaning:
          "Whether the stock is beating or losing to the market in that window. Multi-horizon blend separates short-term spikes from real trend.",
        high: "Positive across all three windows = consistent outperformance.",
        low: "Persistent underperformance is a real signal — usually fundamentals are slipping.",
      },
      {
        name: "Earnings Momentum",
        tagline: "How fast quarterly earnings are growing now vs a year ago.",
        formula: "Latest quarter PAT YoY growth %",
        meaning:
          "Fundamental momentum at the most recent data point. Often leads price momentum by 1–2 quarters.",
        high: "≥ 30% YoY for two consecutive quarters = strong acceleration.",
        low: "YoY decline accelerating = the fundamentals are turning down.",
        caveats:
          "Compare YoY (same quarter last year), not QoQ — Indian businesses have strong seasonality (Q3/Q4 surge in many sectors).",
      },
      {
        name: "Trend Strength",
        tagline: "How smoothly the stock has trended in one direction.",
        formula: "Linear regression R² of price vs time over 6–12 months",
        meaning:
          "A measure of whether price action is a clean trend or noise. Clean uptrends often continue; choppy ones often reverse.",
        high: "R² > 0.7 with positive slope = a real trend.",
        low: "Low R² = directionless; price is whipsawing.",
      },
    ],
  },

  {
    id: "ownership",
    title: "Ownership & Flow",
    blurb:
      "Who owns the stock and how that's changing. Quarterly signals — slower than price but more meaningful.",
    color: "var(--color-accent-700)",
    entries: [
      {
        name: "Promoter Holding",
        tagline: "What % of the company the founders/insiders own.",
        formula: "Promoter shares ÷ Total outstanding shares",
        meaning:
          "How much skin the founders have in the game. In Indian markets, high promoter holding (60%+) is usually a positive — they're aligned with shareholders.",
        high: "≥ 50% = founder-aligned. Tracking a rising promoter % QoQ is one of the strongest insider signals.",
        low: "< 30% AND falling = founders selling down. Worth knowing why.",
        caveats:
          "Watch promoter pledging — promoters can own 60% but have 80% of it pledged to lenders, which is fragile.",
      },
      {
        name: "FII Holding",
        tagline: "Foreign Institutional Investor ownership.",
        formula: "FII shares ÷ Total outstanding shares",
        meaning:
          "How much foreign money is in the stock. FII accumulation is a flow story — they tend to move in and out together, in size.",
        high: "FII % rising for 2+ consecutive quarters in a mid-cap = a meaningful flow signal.",
        low: "FII selling is often the first sign of a multi-quarter de-rating.",
      },
      {
        name: "DII Holding",
        tagline: "Domestic Institutional Investor ownership (mutual funds, insurance, etc.).",
        formula: "DII shares ÷ Total outstanding shares",
        meaning:
          "Indian institutional money — historically smaller than FII but growing fast with SIP flows. DIIs often buy what FIIs sell.",
        high: "DII accumulation is slower-moving and often a longer-term positive.",
        low: "Persistent DII selling is rarer and harder to ignore.",
      },
    ],
  },
];

export default function GlossaryPage() {
  return (
    <div className="theme-indigo mx-auto max-w-[1200px] px-6 py-12">
      <Hero />

      <div className="mt-10 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-8 lg:gap-12">
        <TableOfContents />
        <main className="min-w-0">
          {CATEGORIES.map((cat) => (
            <CategorySection key={cat.id} cat={cat} />
          ))}
          <CrossRefBox />
        </main>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <header className="max-w-[760px]">
      <div className="text-[12px] uppercase tracking-wide muted-text">Glossary</div>
      <h1 className="font-display text-[42px] tracking-tight leading-[1.05] mt-2">
        Every ratio, <em className="accent">demystified</em>.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed muted-text max-w-[640px]">
        A working reference for the ratios the platform uses — formulas,
        plain-English meaning, when high is good vs bad, and the common
        traps. Read in order or jump to whatever you came for via the
        sidebar.
      </p>
    </header>
  );
}

/** Sticky TOC on desktop; collapses into an inline chip strip on mobile. */
function TableOfContents() {
  return (
    <aside className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
      <div className="card p-4">
        <div className="text-[10.5px] uppercase tracking-wide muted-text px-1 py-1.5">
          Contents
        </div>
        <ul className="flex lg:flex-col gap-1 lg:gap-0 overflow-x-auto lg:overflow-visible">
          {CATEGORIES.map((c) => (
            <li key={c.id} className="shrink-0 lg:shrink">
              <a
                href={`#${c.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--color-paper)] text-[12.5px] whitespace-nowrap lg:whitespace-normal"
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: c.color }}
                />
                <span className="truncate">{c.title}</span>
                <span className="muted-text text-[10.5px] tabular-nums ml-auto shrink-0">
                  {c.entries.length}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function CategorySection({ cat }: { cat: Category }) {
  return (
    <section id={cat.id} className="mb-12 scroll-mt-24">
      <div className="mb-5 pb-3 border-b hairline" style={{ borderTopWidth: 3, borderTopColor: cat.color, borderTopStyle: "solid", paddingTop: 12 }}>
        <h2 className="font-display text-[26px] tracking-tight" style={{ color: cat.color }}>
          {cat.title}
        </h2>
        <p className="muted-text text-[13.5px] leading-relaxed mt-1.5 max-w-[640px]">
          {cat.blurb}
        </p>
      </div>

      <div className="space-y-4">
        {cat.entries.map((e) => (
          <RatioCard key={e.name} entry={e} color={cat.color} />
        ))}
      </div>
    </section>
  );
}

function RatioCard({ entry, color }: { entry: Entry; color: string }) {
  return (
    <article className="card p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h3 className="font-display text-[17px]" style={{ color: "var(--color-ink)" }}>
          {entry.name}
        </h3>
        <span className="muted-text text-[12px] italic">{entry.tagline}</span>
      </header>

      {/* Formula — monospace block, accent-bordered left edge */}
      <div
        className="mt-1 px-3 py-2 rounded-md font-mono text-[12.5px] tabular-nums leading-relaxed"
        style={{
          backgroundColor: "var(--color-paper)",
          borderLeft: `3px solid ${color}`,
          color: "var(--color-ink)",
        }}
      >
        {entry.formula}
      </div>

      <p className="mt-3 text-[13.5px] leading-relaxed">
        <span className="muted-text">{entry.meaning}</span>
      </p>

      {entry.example && <MetricViz ex={entry.example} />}

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Interp label="When it's high" tone="good">
          {entry.high}
        </Interp>
        <Interp label="When it's low" tone="warn">
          {entry.low}
        </Interp>
      </div>

      {entry.caveats && (
        <div
          className="mt-3 px-3 py-2 rounded-md text-[12.5px] leading-relaxed"
          style={{
            backgroundColor: "var(--color-accent-50)",
            border: "1px solid var(--color-accent-200)",
            color: "var(--color-accent-700)",
          }}
        >
          <strong>Caveat — </strong>{entry.caveats}
        </div>
      )}
    </article>
  );
}

function Interp({ label, tone, children }: { label: string; tone: "good" | "warn"; children: React.ReactNode }) {
  const color =
    tone === "good" ? "var(--color-score-good)" : "var(--color-score-poor)";
  return (
    <div className="flex gap-2.5">
      <span
        className="inline-block w-1 rounded-sm shrink-0 mt-1"
        style={{ background: color, alignSelf: "stretch" }}
      />
      <div>
        <div className="text-[10.5px] uppercase tracking-wide font-medium" style={{ color }}>
          {label}
        </div>
        <div className="muted-text text-[12.5px] leading-relaxed mt-0.5">
          {children}
        </div>
      </div>
    </div>
  );
}

function CrossRefBox() {
  return (
    <section
      className="mt-12 p-5 rounded-lg"
      style={{ background: "var(--color-paper)", border: "1px solid var(--color-border-default)" }}
    >
      <div className="text-[11px] uppercase tracking-wide muted-text mb-1.5">Cross-reference</div>
      <h3 className="font-display text-[18px]">From ratio to score</h3>
      <p className="muted-text text-[13px] leading-relaxed mt-2 max-w-[680px]">
        These ratios feed into the platform&apos;s three pillars. Each pillar
        percentile is built from a sector-tuned blend of the ratios above
        (specific weights vary by industry cluster).
      </p>
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12.5px]">
        <RatioMapItem
          color="var(--color-score-good)"
          pillar="Quality"
          q="Does this compound?"
          ratios="RoE, RoCE, OPM trend, Revenue/Earnings CAGR, Cash conversion"
        />
        <RatioMapItem
          color="var(--color-accent-400)"
          pillar="Valuation"
          q="Fair price vs peers?"
          ratios="P/E, P/B, EV/EBITDA, FCF Yield, Dividend Yield"
        />
        <RatioMapItem
          color="var(--color-accent-300)"
          pillar="Momentum"
          q="Market noticing yet?"
          ratios="3M/6M/12M relative return, Earnings momentum, Trend strength"
        />
      </ul>
      <div className="mt-4 text-[12.5px]">
        <Link href="/about" className="underline hover:no-underline" style={{ color: "var(--color-accent-700)" }}>
          Read the full methodology →
        </Link>
      </div>
    </section>
  );
}

function RatioMapItem({ color, pillar, q, ratios }: { color: string; pillar: string; q: string; ratios: string }) {
  return (
    <li className="card p-3" style={{ borderTop: `3px solid ${color}` }}>
      <div className="font-medium text-[13px]" style={{ color }}>{pillar}</div>
      <div className="muted-text italic text-[11.5px] mt-0.5">{q}</div>
      <div className="muted-text text-[12px] mt-2 leading-relaxed">{ratios}</div>
    </li>
  );
}
