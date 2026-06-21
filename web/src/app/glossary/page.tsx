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
 * / Liquidity / Cash Flow / Efficiency / Quality / Momentum / Ownership /
 * Sector-Specific) with sticky table-of-contents in the left sidebar so
 * users can jump to a specific ratio without scrolling.
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
        example: {
          context: "ASIANPAINT FY24",
          parts: [
            { label: "EBIT",              display: "₹7,180 cr" },
            { label: "Capital Employed",  display: "₹19,300 cr" },
          ],
          result: { display: "37.2%", numeric: 37.2 },
          bands: [
            { upTo: 10, label: "Poor",      tone: "poor" },
            { upTo: 15, label: "Weak",      tone: "weak" },
            { upTo: 20, label: "OK",        tone: "neutral" },
            { upTo: 30, label: "Good",      tone: "good" },
            { upTo: 50, label: "Excellent", tone: "excellent" },
          ],
          note: "Deep in compounder territory — Asian Paints earns more than 35 paise of operating profit for every rupee of long-term capital, with almost no debt to flatter the number.",
        },
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
        example: {
          context: "HDFCBANK FY24",
          parts: [
            { label: "Net Profit",   display: "₹60,810 cr" },
            { label: "Total Assets", display: "₹36,17,000 cr" },
          ],
          result: { display: "1.68%", numeric: 1.68 },
          bands: [
            { upTo: 0.5, label: "Poor",      tone: "poor" },
            { upTo: 0.9, label: "Weak",      tone: "weak" },
            { upTo: 1.2, label: "OK",        tone: "neutral" },
            { upTo: 1.6, label: "Good",      tone: "good" },
            { upTo: 2.5, label: "Excellent", tone: "excellent" },
          ],
          note: "Best-in-class for a large Indian bank — HDFCBANK earns ₹1.68 of profit per ₹100 of assets, well above the 1.2% benchmark.",
        },
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
        example: {
          context: "HINDUNILVR FY24",
          parts: [
            { label: "Operating Profit", display: "₹14,950 cr" },
            { label: "Revenue",          display: "₹61,890 cr" },
          ],
          result: { display: "24.2%", numeric: 24.2 },
          bands: [
            { upTo: 8,  label: "Poor",      tone: "poor" },
            { upTo: 13, label: "Weak",      tone: "weak" },
            { upTo: 18, label: "OK",        tone: "neutral" },
            { upTo: 23, label: "Good",      tone: "good" },
            { upTo: 35, label: "Excellent", tone: "excellent" },
          ],
          note: "Top-tier for FMCG — HUL keeps 24 paise of operating profit on every rupee of sales, reflecting brand pricing power and distribution scale.",
        },
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
        example: {
          context: "TCS FY24",
          parts: [
            { label: "Net Profit", display: "₹45,910 cr" },
            { label: "Revenue",    display: "₹2,40,890 cr" },
          ],
          result: { display: "19.1%", numeric: 19.1 },
          bands: [
            { upTo: 3,  label: "Poor",      tone: "poor" },
            { upTo: 7,  label: "Weak",      tone: "weak" },
            { upTo: 12, label: "OK",        tone: "neutral" },
            { upTo: 18, label: "Good",      tone: "good" },
            { upTo: 30, label: "Excellent", tone: "excellent" },
          ],
          note: "Strong for IT services — TCS converts roughly ₹19 of every ₹100 of revenue into bottom-line profit even after a heavy wage bill.",
        },
      },
      {
        name: "Gross Margin",
        tagline: "Pricing power before fixed costs.",
        formula: "Gross Margin = (Revenue − COGS) ÷ Revenue",
        meaning:
          "What's left after the cost of making the product, before paying rent, marketing, R&D, etc. The purest pricing-power measure.",
        high: "Software ≥ 70%, branded consumer ≥ 50%, commodities 15–25%.",
        low: "Falling gross margins = either rising input costs OR competitive price war.",
        example: {
          context: "NESTLEIND CY23",
          parts: [
            { label: "Revenue", display: "₹19,750 cr" },
            { label: "COGS",    display: "₹8,690 cr" },
          ],
          result: { display: "56.0%", numeric: 56.0 },
          bands: [
            { upTo: 20, label: "Poor",      tone: "poor" },
            { upTo: 35, label: "Weak",      tone: "weak" },
            { upTo: 45, label: "OK",        tone: "neutral" },
            { upTo: 55, label: "Good",      tone: "good" },
            { upTo: 75, label: "Excellent", tone: "excellent" },
          ],
          note: "Premium-FMCG territory — Nestlé India keeps 56 paise of gross profit per rupee of sales, reflecting brand pricing on Maggi, Nescafé and KitKat.",
        },
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
        example: {
          context: "BAJFINANCE 5y revenue CAGR",
          parts: [
            { label: "FY19 Revenue", display: "₹18,500 cr" },
            { label: "FY24 Revenue", display: "₹54,970 cr" },
          ],
          result: { display: "24.3%", numeric: 24.3 },
          bands: [
            { upTo: 5,  label: "Poor",      tone: "poor" },
            { upTo: 10, label: "Weak",      tone: "weak" },
            { upTo: 15, label: "OK",        tone: "neutral" },
            { upTo: 22, label: "Good",      tone: "good" },
            { upTo: 40, label: "Excellent", tone: "excellent" },
          ],
          note: "Compounding machine — Bajaj Finance nearly tripled revenue over five years, well above the 15% threshold that separates real growth stories from also-rans.",
        },
      },
      {
        name: "Earnings CAGR (PAT)",
        tagline: "Bottom-line compounding.",
        formula: "Earnings CAGR = (End PAT ÷ Start PAT)^(1/years) − 1",
        meaning:
          "Should be at or above Revenue CAGR for a healthy business — earnings growing faster than sales means margins are expanding.",
        high: "Earnings CAGR ≥ Revenue CAGR consistently = a compounding machine.",
        low: "Earnings CAGR << Revenue CAGR = the business is buying revenue with margin.",
        example: {
          context: "PIDILITIND 5y earnings CAGR",
          parts: [
            { label: "FY19 PAT", display: "₹830 cr" },
            { label: "FY24 PAT", display: "₹1,750 cr" },
          ],
          result: { display: "16.1%", numeric: 16.1 },
          bands: [
            { upTo: 5,  label: "Poor",      tone: "poor" },
            { upTo: 10, label: "Weak",      tone: "weak" },
            { upTo: 15, label: "OK",        tone: "neutral" },
            { upTo: 22, label: "Good",      tone: "good" },
            { upTo: 40, label: "Excellent", tone: "excellent" },
          ],
          note: "Healthy mid-teens compounding for Pidilite — earnings have outgrown revenue, which means margins have been quietly expanding alongside volume growth.",
        },
      },
      {
        name: "Operating Margin Trend",
        tagline: "Are margins improving, flat, or eroding?",
        formula: "5-year slope of operating margin (% per year)",
        meaning:
          "Whether the business is gaining or losing pricing power / cost discipline over time. A 5-year up-slope is a strong quality signal.",
        high: "+0.5 pp/year or more sustained = expanding economics. Rare and valuable.",
        low: "Negative slope over 3+ years = competitive pressure or input-cost pressure.",
        example: {
          context: "BAJAJ-AUTO 5y OPM slope",
          parts: [
            { label: "FY19 OPM", display: "16.8%" },
            { label: "FY24 OPM", display: "20.2%" },
          ],
          result: { display: "+0.68 pp/yr", numeric: 0.68 },
          bands: [
            { upTo: -0.5, label: "Eroding",   tone: "poor" },
            { upTo:  0,   label: "Slipping",  tone: "weak" },
            { upTo:  0.3, label: "Flat",      tone: "neutral" },
            { upTo:  0.7, label: "Expanding", tone: "good" },
            { upTo:  2.0, label: "Excellent", tone: "excellent" },
          ],
          note: "Bajaj Auto has expanded margins by ~0.7 pp per year — pricing power on premium motorcycles is showing up in the P&L, not just the brochure.",
        },
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
        example: {
          context: "KOTAKBANK FY24",
          parts: [
            { label: "Market Cap", display: "₹3,55,000 cr" },
            { label: "Book Value", display: "₹1,06,000 cr" },
          ],
          result: { display: "3.35×", numeric: 3.35 },
          bands: [
            // For P/B (banks), lower = cheaper.
            { upTo: 1.0, label: "Cheap",      tone: "excellent" },
            { upTo: 1.8, label: "Reasonable", tone: "good" },
            { upTo: 2.8, label: "Fair",       tone: "neutral" },
            { upTo: 4.0, label: "Rich",       tone: "weak" },
            { upTo: 6.0, label: "Frothy",     tone: "poor" },
          ],
          note: "Premium private-bank multiple — justified by Kotak's mid-teens RoE and clean book, but no longer a value bet.",
        },
      },
      {
        name: "EV/EBITDA",
        tagline: "Enterprise value vs operating cash earnings.",
        formula: "EV ÷ EBITDA, where EV = Market Cap + Debt − Cash",
        meaning:
          "P/E's cleaner cousin — strips out leverage and tax differences so you can compare across capital structures. The standard valuation metric in equity research.",
        high: "EV/EBITDA above 20× implies very fast growth assumed.",
        low: "Cyclicals trade at 5–8× near peaks; that's still expensive if earnings collapse.",
        example: {
          context: "ULTRACEMCO FY24",
          parts: [
            { label: "Enterprise Value", display: "₹3,15,000 cr" },
            { label: "EBITDA",           display: "₹13,150 cr" },
          ],
          result: { display: "24.0×", numeric: 24.0 },
          bands: [
            { upTo: 6,  label: "Cheap",      tone: "excellent" },
            { upTo: 10, label: "Reasonable", tone: "good" },
            { upTo: 15, label: "Fair",       tone: "neutral" },
            { upTo: 22, label: "Rich",       tone: "weak" },
            { upTo: 35, label: "Frothy",     tone: "poor" },
          ],
          note: "Rich for cement — UltraTech trades like a consumer franchise rather than a cyclical, pricing in capacity expansion and pricing discipline holding through the cycle.",
        },
      },
      {
        name: "Free Cash Flow Yield",
        tagline: "How much cash you'd get back per ₹100 invested.",
        formula: "FCF Yield = Free Cash Flow ÷ Market Cap × 100",
        meaning:
          "Cash earnings divided by what you pay for the company. The most rigorous valuation lens — companies can't fake cash flow as easily as accounting earnings.",
        high: "≥ 5% is attractive on a stable business. ≥ 8% is rare and worth investigating.",
        low: "Negative FCF Yield is fine for a growth company (capex phase); a problem for a mature one.",
        example: {
          context: "ITC FY24",
          parts: [
            { label: "Free Cash Flow", display: "₹17,800 cr" },
            { label: "Market Cap",     display: "₹5,40,000 cr" },
          ],
          result: { display: "3.3%", numeric: 3.3 },
          bands: [
            { upTo: 1,  label: "Poor",      tone: "poor" },
            { upTo: 3,  label: "Weak",      tone: "weak" },
            { upTo: 5,  label: "OK",        tone: "neutral" },
            { upTo: 8,  label: "Good",      tone: "good" },
            { upTo: 12, label: "Excellent", tone: "excellent" },
          ],
          note: "Decent but not cheap — ITC throws off real cash but the market has re-rated it, so the yield is now in the middle of the range rather than the bargain it was at sub-₹200.",
        },
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
        example: {
          context: "COALINDIA FY24",
          parts: [
            { label: "Annual DPS",  display: "₹25.5" },
            { label: "Share Price", display: "₹460" },
          ],
          result: { display: "5.5%", numeric: 5.5 },
          bands: [
            { upTo: 0.5, label: "Negligible", tone: "poor" },
            { upTo: 1.5, label: "Low",        tone: "weak" },
            { upTo: 3.0, label: "Moderate",   tone: "neutral" },
            { upTo: 5.0, label: "High",       tone: "good" },
            { upTo: 9.0, label: "Very High",  tone: "excellent" },
          ],
          note: "Generous PSU payout — Coal India returns over 5% of price in cash each year, anchoring the case even before any capital appreciation.",
        },
      },
      {
        name: "PEG Ratio",
        tagline: "P/E adjusted for growth.",
        formula: "PEG = P/E ÷ Earnings Growth Rate (%)",
        meaning:
          "A P/E of 30 looks expensive — until you see 30% earnings growth. PEG normalizes that. The classic Peter Lynch metric.",
        high: "PEG > 2 = paying up. Sometimes justified for high-quality.",
        low: "PEG < 1 = potentially undervalued at the growth rate it's posting.",
        example: {
          context: "BAJFINANCE FY24",
          parts: [
            { label: "P/E",                 display: "29×" },
            { label: "Earnings Growth",    display: "26%" },
          ],
          result: { display: "1.12×", numeric: 1.12 },
          bands: [
            { upTo: 0.7, label: "Cheap",      tone: "excellent" },
            { upTo: 1.0, label: "Reasonable", tone: "good" },
            { upTo: 1.5, label: "Fair",       tone: "neutral" },
            { upTo: 2.5, label: "Rich",       tone: "weak" },
            { upTo: 4.0, label: "Frothy",     tone: "poor" },
          ],
          note: "Just above the Lynch threshold — Bajaj Finance's P/E looks high in isolation, but the earnings growth nearly justifies it.",
        },
      },
    ],
  },

  {
    id: "balance-sheet",
    title: "Balance Sheet & Solvency",
    blurb:
      "Can the business survive a downturn? The plumbing — debt, leverage, capital structure.",
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
        example: {
          context: "TATASTEEL FY24",
          parts: [
            { label: "Net Debt", display: "₹77,500 cr" },
            { label: "EBITDA",   display: "₹22,400 cr" },
          ],
          result: { display: "3.46×", numeric: 3.46 },
          bands: [
            { upTo: 1.0, label: "Fortress",  tone: "excellent" },
            { upTo: 2.0, label: "Healthy",   tone: "good" },
            { upTo: 3.0, label: "Moderate",  tone: "neutral" },
            { upTo: 4.5, label: "Stretched", tone: "weak" },
            { upTo: 7.0, label: "Risky",     tone: "poor" },
          ],
          note: "Stretched for a cyclical — Tata Steel would need over three years of peak EBITDA to clear net debt, and a downturn shrinks that EBITDA fast.",
        },
      },
      {
        name: "Interest Coverage Ratio",
        tagline: "How easily the company can pay interest on its debt.",
        formula: "EBIT ÷ Interest Expense",
        meaning:
          "Operating profit divided by interest payments. The first thing lenders look at; the first thing that breaks in a downturn.",
        high: "≥ 5× is healthy. ≥ 10× is excellent.",
        low: "< 2× = one bad quarter from a default. < 1× means the business isn't earning its interest.",
        example: {
          context: "ULTRACEMCO FY24",
          parts: [
            { label: "EBIT",             display: "₹9,470 cr" },
            { label: "Interest Expense", display: "₹670 cr" },
          ],
          result: { display: "14.1×", numeric: 14.1 },
          bands: [
            { upTo: 1.5, label: "Risky",     tone: "poor" },
            { upTo: 3,   label: "Stretched", tone: "weak" },
            { upTo: 5,   label: "Moderate",  tone: "neutral" },
            { upTo: 10,  label: "Healthy",   tone: "good" },
            { upTo: 30,  label: "Fortress",  tone: "excellent" },
          ],
          note: "UltraTech earns 14× its interest bill — even a steep cyclical downturn wouldn't push it anywhere near a coverage problem.",
        },
      },
    ],
  },

  {
    id: "liquidity",
    title: "Liquidity",
    blurb:
      "Whether the business can meet bills due in the next 12 months. Short-horizon survival, distinct from long-term solvency.",
    color: "var(--color-accent-300)",
    entries: [
      {
        name: "Current Ratio",
        tagline: "Short-term solvency — can it pay its bills?",
        formula: "Current Assets ÷ Current Liabilities",
        meaning:
          "Whether the company has enough short-term assets (cash, receivables, inventory) to cover what it owes in the next 12 months.",
        high: "≥ 1.5 is comfortable; many businesses run leaner without trouble.",
        low: "< 1 is a yellow flag — chronic working-capital stress.",
        example: {
          context: "BRITANNIA FY24",
          parts: [
            { label: "Current Assets",      display: "₹3,810 cr" },
            { label: "Current Liabilities", display: "₹2,560 cr" },
          ],
          result: { display: "1.49×", numeric: 1.49 },
          bands: [
            { upTo: 0.8, label: "Stressed",  tone: "poor" },
            { upTo: 1.0, label: "Tight",     tone: "weak" },
            { upTo: 1.3, label: "OK",        tone: "neutral" },
            { upTo: 1.8, label: "Healthy",   tone: "good" },
            { upTo: 3.0, label: "Comfortable", tone: "excellent" },
          ],
          note: "Britannia sits comfortably above 1× — short-term assets cover near-term bills with room to spare even in a slow quarter.",
        },
      },
      {
        name: "Quick Ratio (Acid Test)",
        tagline: "Current ratio without inventory.",
        formula: "(Cash + Receivables) ÷ Current Liabilities",
        meaning:
          "The harsher liquidity test — excludes inventory because inventory can't always be sold quickly without discounts.",
        high: "≥ 1 = no liquidity issue.",
        low: "< 0.5 = the business is one bad month away from paying suppliers late.",
        example: {
          context: "INFY FY24",
          parts: [
            { label: "Cash + Receivables",  display: "₹52,300 cr" },
            { label: "Current Liabilities", display: "₹28,400 cr" },
          ],
          result: { display: "1.84×", numeric: 1.84 },
          bands: [
            { upTo: 0.3, label: "Stressed", tone: "poor" },
            { upTo: 0.6, label: "Tight",    tone: "weak" },
            { upTo: 1.0, label: "OK",       tone: "neutral" },
            { upTo: 1.5, label: "Healthy",  tone: "good" },
            { upTo: 3.0, label: "Fortress", tone: "excellent" },
          ],
          note: "Classic IT-services profile — almost no inventory, big cash pile, receivables manageable. Infosys could pay every short-term bill nearly twice over from liquid assets alone.",
        },
      },
      {
        name: "Cash Ratio",
        tagline: "The strictest liquidity test — cash only.",
        formula: "Cash & Equivalents ÷ Current Liabilities",
        meaning:
          "Could the company pay all its short-term bills today, with only the cash already in the bank? Receivables and inventory don't count.",
        high: "≥ 0.5 is strong. ≥ 1 means the company is sitting on a war chest.",
        low: "< 0.1 = depends entirely on collections continuing — fragile if customers delay payment.",
        example: {
          context: "TCS FY24",
          parts: [
            { label: "Cash & Equivalents", display: "₹26,700 cr" },
            { label: "Current Liabilities", display: "₹40,200 cr" },
          ],
          result: { display: "0.66×", numeric: 0.66 },
          bands: [
            { upTo: 0.1, label: "Fragile",    tone: "poor" },
            { upTo: 0.25, label: "Thin",      tone: "weak" },
            { upTo: 0.5, label: "OK",         tone: "neutral" },
            { upTo: 1.0, label: "Strong",     tone: "good" },
            { upTo: 2.5, label: "War Chest",  tone: "excellent" },
          ],
          note: "TCS holds enough pure cash to cover two-thirds of all short-term liabilities — almost no real-world business has a liquidity worry at this level.",
        },
      },
      {
        name: "Working Capital",
        tagline: "Absolute headroom between short-term assets and bills.",
        formula: "Working Capital = Current Assets − Current Liabilities",
        meaning:
          "The rupee buffer the business runs on — what it could fund operations with after paying everything due in 12 months.",
        high: "Positive and growing with revenue = the business is funding itself.",
        low: "Negative working capital is normal for FMCG / retail (suppliers fund them) but dangerous for project businesses.",
        caveats:
          "A growing working-capital gap that outpaces revenue is often the first sign of stretched receivables or unsold inventory piling up.",
        example: {
          context: "PIDILITIND FY24",
          parts: [
            { label: "Current Assets",      display: "₹6,940 cr" },
            { label: "Current Liabilities", display: "₹2,510 cr" },
          ],
          result: { display: "₹4,430 cr", numeric: 4430 },
          bands: [
            { upTo: 0,    label: "Negative", tone: "poor" },
            { upTo: 500,  label: "Tight",    tone: "weak" },
            { upTo: 1500, label: "OK",       tone: "neutral" },
            { upTo: 3500, label: "Healthy",  tone: "good" },
            { upTo: 8000, label: "Fortress", tone: "excellent" },
          ],
          note: "Pidilite carries ₹4,400 cr of headroom — plenty of slack to absorb a slow quarter or a delayed receivable cycle without touching the credit line.",
        },
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
        example: {
          context: "HINDUNILVR FY24",
          parts: [
            { label: "Net Profit",     display: "₹10,280 cr" },
            { label: "Non-cash + ΔWC", display: "₹3,520 cr" },
          ],
          result: { display: "₹13,800 cr", numeric: 13800 },
          bands: [
            { upTo: 0,     label: "Negative", tone: "poor" },
            { upTo: 1000,  label: "Weak",     tone: "weak" },
            { upTo: 3000,  label: "OK",       tone: "neutral" },
            { upTo: 8000,  label: "Strong",   tone: "good" },
            { upTo: 20000, label: "Excellent", tone: "excellent" },
          ],
          note: "HUL converts brand strength into cash year after year — almost ₹14,000 cr of operating cash funds dividends, brand investment, and the M&A war chest without touching debt.",
        },
      },
      {
        name: "Free Cash Flow (FCF)",
        tagline: "OCF after the capex the business needs to maintain itself.",
        formula: "FCF = OCF − Capital Expenditure",
        meaning:
          "What's left for shareholders, debt repayment, or M&A after the business invests in its own continuation. The cleanest measure of value generation.",
        high: "Consistently positive FCF over a full cycle = real business.",
        low: "Companies in heavy capex phase have negative FCF — fine if returns will come; bad if it's just kicking the can.",
        example: {
          context: "INFY FY24",
          parts: [
            { label: "Operating Cash Flow", display: "₹25,200 cr" },
            { label: "Capex",               display: "₹2,400 cr" },
          ],
          result: { display: "₹22,800 cr", numeric: 22800 },
          bands: [
            { upTo: 0,     label: "Negative",  tone: "poor" },
            { upTo: 1500,  label: "Weak",      tone: "weak" },
            { upTo: 5000,  label: "OK",        tone: "neutral" },
            { upTo: 12000, label: "Strong",    tone: "good" },
            { upTo: 35000, label: "Excellent", tone: "excellent" },
          ],
          note: "Capital-light IT services in full effect — Infosys converts almost all of its operating cash into free cash because it needs little reinvestment in physical assets.",
        },
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
        example: {
          context: "NESTLEIND CY23",
          parts: [
            { label: "Operating Cash Flow", display: "₹3,250 cr" },
            { label: "Net Profit",          display: "₹3,000 cr" },
          ],
          result: { display: "108%", numeric: 108 },
          bands: [
            { upTo: 40,  label: "Poor",      tone: "poor" },
            { upTo: 60,  label: "Weak",      tone: "weak" },
            { upTo: 80,  label: "OK",        tone: "neutral" },
            { upTo: 100, label: "Strong",    tone: "good" },
            { upTo: 150, label: "Excellent", tone: "excellent" },
          ],
          note: "Better than 1:1 — every rupee of Nestlé India's reported profit comes back as cash, the cleanest signature of high-quality earnings.",
        },
      },
    ],
  },

  {
    id: "efficiency",
    title: "Efficiency",
    blurb:
      "How hard the business works its assets, inventory, and receivables. Companies generating more sales per rupee of capital compound faster.",
    color: "var(--color-accent-200)",
    entries: [
      {
        name: "Asset Turnover",
        tagline: "Revenue generated per ₹1 of total assets.",
        formula: "Asset Turnover = Revenue ÷ Total Assets",
        meaning:
          "How efficiently the asset base produces sales. Low-margin businesses (FMCG distribution, retail) often compensate with high asset turnover; vice versa for software.",
        high: "≥ 1.5× is high efficiency for non-financial businesses.",
        low: "< 0.5× = an asset-heavy business; only attractive if margins are also high.",
        example: {
          context: "HINDUNILVR FY24",
          parts: [
            { label: "Revenue",      display: "₹61,890 cr" },
            { label: "Total Assets", display: "₹49,100 cr" },
          ],
          result: { display: "1.26×", numeric: 1.26 },
          bands: [
            { upTo: 0.3, label: "Poor",      tone: "poor" },
            { upTo: 0.6, label: "Weak",      tone: "weak" },
            { upTo: 1.0, label: "OK",        tone: "neutral" },
            { upTo: 1.5, label: "Good",      tone: "good" },
            { upTo: 2.5, label: "Excellent", tone: "excellent" },
          ],
          note: "HUL sweats its asset base hard — every rupee of assets produces ₹1.26 of revenue, which is why mid-twenties RoCE is achievable on mid-teens margins.",
        },
      },
      {
        name: "Inventory Turnover",
        tagline: "How many times a year inventory cycles through.",
        formula: "Inventory Turnover = COGS ÷ Average Inventory",
        meaning:
          "Fast inventory turnover means goods are flying off the shelf — capital isn't tied up in unsold stock. Slow turnover ties up cash and risks obsolescence.",
        high: "≥ 8× per year is fast (typical for FMCG, food).",
        low: "< 3× = inventory is sitting too long. Often the leading indicator of demand softness.",
        caveats:
          "Industry-specific. Jewellery turns 2–3× per year by design; FMCG snacks turn 15×+. Compare like with like.",
        example: {
          context: "BRITANNIA FY24",
          parts: [
            { label: "COGS",              display: "₹10,950 cr" },
            { label: "Avg Inventory",     display: "₹820 cr" },
          ],
          result: { display: "13.4×", numeric: 13.4 },
          bands: [
            { upTo: 2,  label: "Slow",      tone: "poor" },
            { upTo: 4,  label: "Sluggish",  tone: "weak" },
            { upTo: 7,  label: "OK",        tone: "neutral" },
            { upTo: 12, label: "Fast",      tone: "good" },
            { upTo: 25, label: "Excellent", tone: "excellent" },
          ],
          note: "Biscuits move fast — Britannia rotates its inventory roughly once every four weeks, which keeps working capital tight and freshness on shelf.",
        },
      },
      {
        name: "Receivables Days (DSO)",
        tagline: "How long customers take to pay.",
        formula: "DSO = (Receivables ÷ Revenue) × 365",
        meaning:
          "Days Sales Outstanding — the average number of days between making a sale and getting paid. The lower, the better your cash cycle.",
        high: "Low DSO is good. ≤ 30 days is fast.",
        low: "> 90 days = either an industry norm (project businesses) or a customer-quality problem.",
        caveats:
          "B2C and B2B differ hugely — FMCG sells cash-on-delivery to distributors (DSO ~20); EPC contractors live at 120+.",
        example: {
          context: "INFY FY24",
          parts: [
            { label: "Receivables", display: "₹29,800 cr" },
            { label: "Revenue",     display: "₹1,53,670 cr" },
          ],
          result: { display: "71 days", numeric: 71 },
          bands: [
            // Lower = better.
            { upTo: 30,  label: "Excellent", tone: "excellent" },
            { upTo: 60,  label: "Good",      tone: "good" },
            { upTo: 90,  label: "OK",        tone: "neutral" },
            { upTo: 120, label: "Slow",      tone: "weak" },
            { upTo: 200, label: "Stretched", tone: "poor" },
          ],
          note: "Normal for IT services — Infosys's enterprise customers settle on roughly 70-day terms, which is industry standard. A creep above 80 would be the first warning sign.",
        },
      },
      {
        name: "Cash Conversion Cycle",
        tagline: "Days between paying suppliers and getting paid by customers.",
        formula: "CCC = DIO + DSO − DPO",
        meaning:
          "The round-trip in days: how long inventory sits + how long customers take to pay − how long the company itself takes to pay suppliers. Negative is best (suppliers fund the business).",
        high: "Long cycle = working capital tied up. Project businesses run 150+ days.",
        low: "Negative cycle = the business operates on supplier credit (classic FMCG / retail).",
        example: {
          context: "DMART FY24",
          parts: [
            { label: "DIO + DSO", display: "32 days" },
            { label: "DPO",       display: "8 days" },
          ],
          result: { display: "24 days", numeric: 24 },
          bands: [
            // Lower = better. Negative is the gold standard but rare; clamp scale at 0+ here.
            { upTo: 15,  label: "Excellent", tone: "excellent" },
            { upTo: 35,  label: "Good",      tone: "good" },
            { upTo: 60,  label: "OK",        tone: "neutral" },
            { upTo: 100, label: "Slow",      tone: "weak" },
            { upTo: 180, label: "Heavy",     tone: "poor" },
          ],
          note: "Tight cycle for an organised retailer — DMart turns inventory in roughly three weeks and collects from customers instantly, so working capital is minimal even at scale.",
        },
      },
      {
        name: "Fixed Asset Turnover",
        tagline: "Revenue generated per ₹1 of plant, property, and equipment.",
        formula: "Fixed Asset Turnover = Revenue ÷ Net Fixed Assets",
        meaning:
          "How much sales the company's installed plant produces. Most useful for manufacturing — flagrant inefficiency shows up here before it shows up in margins.",
        high: "≥ 3× = capital-efficient. Common in light manufacturing, FMCG.",
        low: "< 1× = capital-heavy by design (steel, power, cement).",
        example: {
          context: "BAJAJ-AUTO FY24",
          parts: [
            { label: "Revenue",          display: "₹44,870 cr" },
            { label: "Net Fixed Assets", display: "₹2,160 cr" },
          ],
          result: { display: "20.8×", numeric: 20.8 },
          bands: [
            { upTo: 0.5, label: "Poor",      tone: "poor" },
            { upTo: 1.5, label: "Weak",      tone: "weak" },
            { upTo: 3,   label: "OK",        tone: "neutral" },
            { upTo: 6,   label: "Good",      tone: "good" },
            { upTo: 25,  label: "Excellent", tone: "excellent" },
          ],
          note: "Bajaj Auto's factories sweat extraordinarily hard — each rupee of plant produces ₹20+ of revenue, the structural reason its RoCE stays well above 25%.",
        },
      },
    ],
  },

  {
    id: "quality",
    title: "Quality (Composite Scores)",
    blurb:
      "Multi-factor scores that condense balance sheet, profitability, and earnings stability into a single number. Useful screens, not standalone verdicts.",
    color: "var(--color-score-good)",
    entries: [
      {
        name: "Piotroski F-Score",
        tagline: "A 9-point quality checklist.",
        formula: "F-Score = sum of 9 binary tests (profitability, leverage, efficiency)",
        meaning:
          "Adds 1 point for each of 9 fundamental tests passed — positive net income, positive OCF, OCF > net income, RoA up YoY, declining debt, etc. Scores ≥ 7 historically beat the market.",
        high: "7–9 = high-quality, improving fundamentals.",
        low: "0–3 = deteriorating. Avoid even if statistically cheap.",
        caveats:
          "Calibrated on US data — works on Indian large/mid-caps but less reliable on small-caps where individual tests can be noisy.",
        example: {
          context: "INFY FY24",
          parts: [
            { label: "Tests Passed", display: "8 of 9" },
          ],
          result: { display: "8", numeric: 8 },
          bands: [
            { upTo: 2, label: "Poor",      tone: "poor" },
            { upTo: 4, label: "Weak",      tone: "weak" },
            { upTo: 6, label: "OK",        tone: "neutral" },
            { upTo: 7, label: "Good",      tone: "good" },
            { upTo: 9, label: "Excellent", tone: "excellent" },
          ],
          note: "Near-perfect quality screen — Infosys passes eight of the nine Piotroski tests, missing only on share-count reduction (it pays dividends rather than buying back).",
        },
      },
      {
        name: "Altman Z-Score",
        tagline: "Distress predictor for non-financial companies.",
        formula: "Z = 1.2A + 1.4B + 3.3C + 0.6D + 1.0E (working capital, retained earnings, EBIT, mcap/debt, sales-to-assets ratios)",
        meaning:
          "Designed by Edward Altman in 1968 to predict bankruptcy within two years. Still surprisingly accurate for manufacturers and retailers; not meaningful for banks or NBFCs.",
        high: "Z > 3 = safe zone.",
        low: "Z < 1.8 = distress zone; in between is grey.",
        example: {
          context: "TITAN FY24",
          parts: [
            { label: "Composite Z", display: "5.4" },
          ],
          result: { display: "5.4", numeric: 5.4 },
          bands: [
            { upTo: 1.0, label: "Critical",  tone: "poor" },
            { upTo: 1.8, label: "Distress",  tone: "weak" },
            { upTo: 2.6, label: "Grey",      tone: "neutral" },
            { upTo: 3.5, label: "Safe",      tone: "good" },
            { upTo: 8.0, label: "Fortress",  tone: "excellent" },
          ],
          note: "Comfortably in the fortress zone — Titan's combination of strong profitability, low debt, and high asset productivity puts bankruptcy risk effectively at zero.",
        },
      },
      {
        name: "Earnings Stability",
        tagline: "How smooth and predictable the earnings stream is.",
        formula: "Earnings Stability = 1 − (StdDev of YoY PAT growth ÷ Mean PAT growth), 5y window",
        meaning:
          "A high-stability business posts similar earnings growth every year. Lumpy earnings (cyclicals, commodity plays) score low even if the long-run growth is fine.",
        high: "≥ 0.8 = compounder-grade smoothness. FMCG and IT services cluster here.",
        low: "< 0.3 = boom-bust pattern. Often a sign earnings are commodity-linked.",
        example: {
          context: "ASIANPAINT 5y FY19–24",
          parts: [
            { label: "Mean PAT growth",   display: "15%" },
            { label: "StdDev of growth",  display: "3.0%" },
          ],
          result: { display: "0.80", numeric: 0.80 },
          bands: [
            { upTo: 0.2, label: "Erratic",    tone: "poor" },
            { upTo: 0.4, label: "Choppy",     tone: "weak" },
            { upTo: 0.6, label: "OK",         tone: "neutral" },
            { upTo: 0.8, label: "Smooth",     tone: "good" },
            { upTo: 1.0, label: "Compounder", tone: "excellent" },
          ],
          note: "Compounder-grade — Asian Paints grows earnings within a tight band year after year, the smoothness the market is willing to pay a premium multiple for.",
        },
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
        example: {
          context: "BAJAJ-AUTO 12m vs NIFTY",
          parts: [
            { label: "Stock Return", display: "+78%" },
            { label: "NIFTY Return", display: "+22%" },
          ],
          result: { display: "+56 pp", numeric: 56 },
          bands: [
            { upTo: -30, label: "Lagging",       tone: "poor" },
            { upTo: -10, label: "Underperform",  tone: "weak" },
            { upTo: 5,   label: "Inline",        tone: "neutral" },
            { upTo: 25,  label: "Outperform",    tone: "good" },
            { upTo: 80,  label: "Strong",        tone: "excellent" },
          ],
          note: "Massive 12-month outperformance — Bajaj Auto trounced the NIFTY by over 50 percentage points as the market re-rated its premium-motorcycle story.",
        },
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
        example: {
          context: "CHOLAFIN Q4 FY24",
          parts: [
            { label: "Q4 FY23 PAT", display: "₹685 cr" },
            { label: "Q4 FY24 PAT", display: "₹1,060 cr" },
          ],
          result: { display: "+55%", numeric: 55 },
          bands: [
            { upTo: -10, label: "Declining",    tone: "poor" },
            { upTo: 5,   label: "Flat",         tone: "weak" },
            { upTo: 15,  label: "OK",           tone: "neutral" },
            { upTo: 30,  label: "Accelerating", tone: "good" },
            { upTo: 100, label: "Surging",      tone: "excellent" },
          ],
          note: "Earnings surge — Chola's profit grew 55% YoY on book growth and stable credit costs, the kind of acceleration that typically precedes a multiple re-rating.",
        },
      },
      {
        name: "Trend Strength",
        tagline: "How smoothly the stock has trended in one direction.",
        formula: "Linear regression R² of price vs time over 6–12 months",
        meaning:
          "A measure of whether price action is a clean trend or noise. Clean uptrends often continue; choppy ones often reverse.",
        high: "R² > 0.7 with positive slope = a real trend.",
        low: "Low R² = directionless; price is whipsawing.",
        example: {
          context: "TITAN 12m price trend",
          parts: [
            { label: "Slope",  display: "+ve" },
            { label: "R²",     display: "0.82" },
          ],
          result: { display: "0.82", numeric: 0.82 },
          bands: [
            { upTo: 0.2, label: "Noise",   tone: "poor" },
            { upTo: 0.4, label: "Choppy",  tone: "weak" },
            { upTo: 0.6, label: "Mixed",   tone: "neutral" },
            { upTo: 0.8, label: "Clean",   tone: "good" },
            { upTo: 1.0, label: "Strong",  tone: "excellent" },
          ],
          note: "Textbook clean uptrend — Titan's 12-month price action sits tightly along its regression line, the type of low-volatility climb that institutions favour.",
        },
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
        example: {
          context: "TITAN Q4 FY24",
          parts: [
            { label: "Promoter (Tata Sons + group)", display: "52.9%" },
          ],
          result: { display: "52.9%", numeric: 52.9 },
          bands: [
            { upTo: 20, label: "Weak",      tone: "poor" },
            { upTo: 35, label: "Low",       tone: "weak" },
            { upTo: 50, label: "OK",        tone: "neutral" },
            { upTo: 65, label: "Aligned",   tone: "good" },
            { upTo: 85, label: "Founder",   tone: "excellent" },
          ],
          note: "Healthy alignment — the Tata group holds majority economic interest in Titan, with zero promoter pledging.",
        },
      },
      {
        name: "FII Holding",
        tagline: "Foreign Institutional Investor ownership.",
        formula: "FII shares ÷ Total outstanding shares",
        meaning:
          "How much foreign money is in the stock. FII accumulation is a flow story — they tend to move in and out together, in size.",
        high: "FII % rising for 2+ consecutive quarters in a mid-cap = a meaningful flow signal.",
        low: "FII selling is often the first sign of a multi-quarter de-rating.",
        example: {
          context: "HDFCBANK Q4 FY24",
          parts: [
            { label: "FII holding", display: "47.8%" },
          ],
          result: { display: "47.8%", numeric: 47.8 },
          bands: [
            { upTo: 5,  label: "Negligible", tone: "poor" },
            { upTo: 15, label: "Low",        tone: "weak" },
            { upTo: 25, label: "Moderate",   tone: "neutral" },
            { upTo: 40, label: "High",       tone: "good" },
            { upTo: 75, label: "Crowded",    tone: "excellent" },
          ],
          note: "Among the most FII-owned large-caps in India — useful for liquidity but means the stock is sensitive to global EM flows in either direction.",
        },
      },
      {
        name: "DII Holding",
        tagline: "Domestic Institutional Investor ownership (mutual funds, insurance, etc.).",
        formula: "DII shares ÷ Total outstanding shares",
        meaning:
          "Indian institutional money — historically smaller than FII but growing fast with SIP flows. DIIs often buy what FIIs sell.",
        high: "DII accumulation is slower-moving and often a longer-term positive.",
        low: "Persistent DII selling is rarer and harder to ignore.",
        example: {
          context: "ICICIBANK Q4 FY24",
          parts: [
            { label: "DII holding", display: "42.0%" },
          ],
          result: { display: "42.0%", numeric: 42.0 },
          bands: [
            { upTo: 5,  label: "Negligible", tone: "poor" },
            { upTo: 12, label: "Low",        tone: "weak" },
            { upTo: 22, label: "Moderate",   tone: "neutral" },
            { upTo: 35, label: "High",       tone: "good" },
            { upTo: 60, label: "Anchor",     tone: "excellent" },
          ],
          note: "ICICIBANK has become a core DII holding — Indian mutual funds and LIC together own a higher share than the promoter equivalent, anchoring the stock through FII outflows.",
        },
      },
    ],
  },

  {
    id: "sector-specific",
    title: "Sector-Specific",
    blurb:
      "Ratios that only make sense within a specific industry. Banking · NBFC · Insurance · IT/SaaS · FMCG · Real Estate. Don't compare across the dividers.",
    color: "var(--color-accent-500)",
    entries: [
      // ─── Banking ──────────────────────────────────────────────────────
      {
        name: "Net Interest Margin (NIM) — Banking",
        tagline: "Spread the bank earns on its loan book.",
        formula: "NIM = (Interest Earned − Interest Paid) ÷ Avg Interest-Earning Assets",
        meaning:
          "The core profitability lever for a bank — what it lends at minus what it borrows at, expressed as % of the loan book. The single most-watched bank KPI.",
        high: "Indian private banks: 4%+ is strong. PSU banks: 3% is healthy.",
        low: "< 2.5% on a private bank = pricing pressure or asset-mix shifting toward low-yield segments.",
        example: {
          context: "HDFCBANK FY24",
          parts: [
            { label: "Net Interest Income",       display: "₹1,08,500 cr" },
            { label: "Avg Earning Assets",        display: "₹26,40,000 cr" },
          ],
          result: { display: "4.1%", numeric: 4.1 },
          bands: [
            { upTo: 2.0, label: "Weak",      tone: "poor" },
            { upTo: 2.7, label: "Low",       tone: "weak" },
            { upTo: 3.3, label: "OK",        tone: "neutral" },
            { upTo: 4.0, label: "Good",      tone: "good" },
            { upTo: 6.0, label: "Excellent", tone: "excellent" },
          ],
          note: "Top-tier NIM for a universal Indian bank — HDFCBANK's retail-heavy book lets it earn over 4% spread on a balance sheet north of ₹26 lakh crore.",
        },
      },
      {
        name: "CASA Ratio — Banking",
        tagline: "Cheap-deposit share of the funding base.",
        formula: "CASA = (Current + Savings deposits) ÷ Total Deposits",
        meaning:
          "Current and savings deposits pay near-zero interest, so a high CASA ratio means lower cost of funds, which means higher NIM. The structural advantage in retail banking.",
        high: "≥ 45% is strong for an Indian bank.",
        low: "< 30% = the bank is dependent on expensive term deposits.",
        example: {
          context: "KOTAKBANK FY24",
          parts: [
            { label: "CASA Deposits",  display: "₹1,90,000 cr" },
            { label: "Total Deposits", display: "₹4,46,000 cr" },
          ],
          result: { display: "42.6%", numeric: 42.6 },
          bands: [
            { upTo: 25, label: "Weak",      tone: "poor" },
            { upTo: 33, label: "Low",       tone: "weak" },
            { upTo: 40, label: "OK",        tone: "neutral" },
            { upTo: 48, label: "Good",      tone: "good" },
            { upTo: 60, label: "Excellent", tone: "excellent" },
          ],
          note: "Healthy CASA franchise — Kotak funds nearly 43% of deposits at near-zero cost, the structural reason its NIM stays in the 4–5% range.",
        },
      },
      {
        name: "Gross NPA — Banking",
        tagline: "Share of the loan book that's stopped paying.",
        formula: "Gross NPA = Non-performing Loans ÷ Total Loans",
        meaning:
          "What % of the bank's loans are 90+ days overdue. The blunt asset-quality measure — but ignore until you read Net NPA and provision coverage alongside.",
        high: "Low is good. < 2% is excellent for an Indian bank.",
        low: "Rising GNPA QoQ is a leading warning even at low absolute levels.",
        example: {
          context: "ICICIBANK FY24",
          parts: [
            { label: "Gross NPAs",   display: "₹27,960 cr" },
            { label: "Gross Loans",  display: "₹11,84,000 cr" },
          ],
          result: { display: "2.36%", numeric: 2.36 },
          bands: [
            // Lower = better.
            { upTo: 1.5, label: "Excellent", tone: "excellent" },
            { upTo: 3.0, label: "Good",      tone: "good" },
            { upTo: 5.0, label: "OK",        tone: "neutral" },
            { upTo: 8.0, label: "Stressed",  tone: "weak" },
            { upTo: 15,  label: "Distress",  tone: "poor" },
          ],
          note: "Clean private-bank book — ICICIBANK has brought GNPA below 2.5% after the 2018 cleanup, and the downward trajectory is what the market rewards.",
        },
      },
      {
        name: "Net NPA — Banking",
        tagline: "GNPA after provisioning.",
        formula: "Net NPA = (Gross NPA − Provisions) ÷ Net Loans",
        meaning:
          "What's left of bad loans after the bank has set aside money to cover them. Net NPA + capital adequacy together tell you whether the bank can absorb the bad book.",
        high: "Low is good. < 0.5% is excellent.",
        low: "Net NPA > 2% on a private bank = under-provisioned given current GNPA levels.",
        example: {
          context: "SBIN FY24",
          parts: [
            { label: "Net NPAs",  display: "₹21,100 cr" },
            { label: "Net Loans", display: "₹36,80,000 cr" },
          ],
          result: { display: "0.57%", numeric: 0.57 },
          bands: [
            { upTo: 0.5, label: "Excellent", tone: "excellent" },
            { upTo: 1.2, label: "Good",      tone: "good" },
            { upTo: 2.5, label: "OK",        tone: "neutral" },
            { upTo: 5.0, label: "Stressed",  tone: "weak" },
            { upTo: 10,  label: "Distress",  tone: "poor" },
          ],
          note: "Best-in-class for a PSU — SBI's Net NPA is now near private-bank levels, a remarkable turnaround from the 5%+ levels of 2018.",
        },
      },
      {
        name: "Capital Adequacy Ratio (CAR) — Banking",
        tagline: "Capital cushion vs risk-weighted assets.",
        formula: "CAR = (Tier 1 Capital + Tier 2 Capital) ÷ Risk-Weighted Assets",
        meaning:
          "How thick the bank's capital buffer is, relative to the riskiness of its loan book. RBI requires minimum 11.5% including buffers.",
        high: "≥ 16% gives growth headroom without raising equity.",
        low: "< 13% = the bank may need to raise capital soon, diluting shareholders.",
        example: {
          context: "HDFCBANK FY24",
          parts: [
            { label: "Total Capital", display: "₹4,15,000 cr" },
            { label: "RWA",           display: "₹22,90,000 cr" },
          ],
          result: { display: "18.1%", numeric: 18.1 },
          bands: [
            { upTo: 11.5, label: "Below Min", tone: "poor" },
            { upTo: 13,   label: "Tight",     tone: "weak" },
            { upTo: 15,   label: "OK",        tone: "neutral" },
            { upTo: 17,   label: "Healthy",   tone: "good" },
            { upTo: 22,   label: "Fortress",  tone: "excellent" },
          ],
          note: "Comfortably above the regulatory floor — HDFCBANK has roughly seven percentage points of buffer over the minimum, enough to grow the book for several years without an equity raise.",
        },
      },

      // ─── NBFC ─────────────────────────────────────────────────────────
      {
        name: "AUM Growth — NBFC",
        tagline: "How fast the loan book is expanding.",
        formula: "AUM Growth = (AUM End ÷ AUM Start) − 1",
        meaning:
          "Assets Under Management growth is the top-line metric for an NBFC — equivalent to revenue growth for a corporate. Combined with NIM, it tells you the earnings trajectory.",
        high: "≥ 25% YoY in a high-quality NBFC = strong franchise.",
        low: "< 10% in a non-bank lender = market share loss or asset-quality issues.",
        example: {
          context: "BAJFINANCE FY24",
          parts: [
            { label: "AUM Mar'23", display: "₹2,47,000 cr" },
            { label: "AUM Mar'24", display: "₹3,30,600 cr" },
          ],
          result: { display: "33.8%", numeric: 33.8 },
          bands: [
            { upTo: 5,  label: "Stagnant",  tone: "poor" },
            { upTo: 12, label: "Slow",      tone: "weak" },
            { upTo: 20, label: "OK",        tone: "neutral" },
            { upTo: 30, label: "Strong",    tone: "good" },
            { upTo: 50, label: "Explosive", tone: "excellent" },
          ],
          note: "Bajaj Finance is still compounding AUM in the mid-30s % range at ₹3.3 lakh crore scale — a rate most NBFCs never reach at any size.",
        },
      },
      {
        name: "Spread — NBFC",
        tagline: "Yield on assets minus cost of borrowing.",
        formula: "Spread = Yield on Loans − Cost of Funds",
        meaning:
          "The unleveraged version of NIM — how many percentage points the NBFC earns on every loan after paying the bank/bond market for its funding.",
        high: "≥ 5 pp is strong. Unsecured lenders earn more; mortgage NBFCs less.",
        low: "< 2.5 pp = pricing pressure squeezing the model.",
        example: {
          context: "CHOLAFIN FY24",
          parts: [
            { label: "Yield on Loans", display: "13.8%" },
            { label: "Cost of Funds",  display: "7.6%" },
          ],
          result: { display: "6.2 pp", numeric: 6.2 },
          bands: [
            { upTo: 2,  label: "Weak",      tone: "poor" },
            { upTo: 3.5,label: "Low",       tone: "weak" },
            { upTo: 5,  label: "OK",        tone: "neutral" },
            { upTo: 7,  label: "Good",      tone: "good" },
            { upTo: 12, label: "Excellent", tone: "excellent" },
          ],
          note: "Healthy spread for a diversified NBFC — Chola earns over six percentage points on its vehicle and SME book, comfortably covering credit costs and operating expenses.",
        },
      },

      // ─── Insurance ────────────────────────────────────────────────────
      {
        name: "VNB Margin — Insurance (Life)",
        tagline: "Profitability of new policies sold this year.",
        formula: "VNB Margin = Value of New Business ÷ Annualised Premium Equivalent",
        meaning:
          "Captures the profit embedded in each rupee of new premium written — the cleanest measure of a life insurer's underlying economics.",
        high: "≥ 25% is strong. Protection-heavy mix lifts the ratio.",
        low: "< 15% = mix is shifting to low-margin ULIPs or savings.",
        example: {
          context: "HDFCLIFE FY24",
          parts: [
            { label: "VNB",  display: "₹3,500 cr" },
            { label: "APE",  display: "₹13,200 cr" },
          ],
          result: { display: "26.5%", numeric: 26.5 },
          bands: [
            { upTo: 10, label: "Poor",      tone: "poor" },
            { upTo: 17, label: "Weak",      tone: "weak" },
            { upTo: 22, label: "OK",        tone: "neutral" },
            { upTo: 28, label: "Good",      tone: "good" },
            { upTo: 40, label: "Excellent", tone: "excellent" },
          ],
          note: "Top-quartile margin — HDFC Life's mix of protection and non-par savings pushes new-business profitability above 26%, well clear of the LIC/peer average.",
        },
      },
      {
        name: "Solvency Ratio — Insurance",
        tagline: "Capital cushion an insurer holds vs regulatory minimum.",
        formula: "Solvency = Available Solvency Margin ÷ Required Solvency Margin",
        meaning:
          "IRDAI requires a minimum of 1.5×. Higher = more cushion to absorb claims spikes and to grow without raising fresh capital.",
        high: "≥ 2.0× gives growth headroom.",
        low: "< 1.6× = the insurer is one bad year from needing to raise capital.",
        example: {
          context: "SBILIFE FY24",
          parts: [
            { label: "Available Solvency", display: "₹16,400 cr" },
            { label: "Required Solvency", display: "₹8,200 cr" },
          ],
          result: { display: "2.00×", numeric: 2.00 },
          bands: [
            { upTo: 1.5, label: "Below Min", tone: "poor" },
            { upTo: 1.7, label: "Tight",     tone: "weak" },
            { upTo: 1.9, label: "OK",        tone: "neutral" },
            { upTo: 2.2, label: "Healthy",   tone: "good" },
            { upTo: 3.0, label: "Fortress",  tone: "excellent" },
          ],
          note: "Exactly 2× — SBI Life carries twice the regulatory minimum, the level at which IRDAI considers an insurer well-capitalised for multi-year growth.",
        },
      },

      // ─── IT / SaaS ────────────────────────────────────────────────────
      {
        name: "Revenue per Employee — IT/SaaS",
        tagline: "Productivity of the talent base.",
        formula: "Revenue per Employee = Annual Revenue ÷ Total Headcount",
        meaning:
          "Indian IT runs on labour arbitrage — the higher the revenue per head, the higher up the value chain the company has moved (consulting, platforms, IP).",
        high: "₹70L+ = differentiated. Captures premium project mix.",
        low: "< ₹40L = commoditised staff augmentation.",
        example: {
          context: "TCS FY24",
          parts: [
            { label: "Revenue",   display: "₹2,40,890 cr" },
            { label: "Headcount", display: "6,01,500" },
          ],
          result: { display: "₹40.0 L", numeric: 40 },
          bands: [
            { upTo: 25, label: "Low",       tone: "poor" },
            { upTo: 35, label: "Below Avg", tone: "weak" },
            { upTo: 45, label: "OK",        tone: "neutral" },
            { upTo: 60, label: "Good",      tone: "good" },
            { upTo: 90, label: "Premium",   tone: "excellent" },
          ],
          note: "Industry-average productivity — TCS at ₹40L per head is held back by its sheer scale and entry-level pyramid; smaller firms like Persistent Systems run higher.",
        },
      },
      {
        name: "Attrition Rate — IT/SaaS",
        tagline: "% of staff leaving each year.",
        formula: "Attrition = (Departures over 12 months) ÷ Avg Headcount",
        meaning:
          "High attrition means costly replacement hiring and disrupted projects. Watched obsessively in Indian IT as the canary on margin pressure.",
        high: "Low is good. < 13% (LTM) is healthy.",
        low: "> 22% LTM = a bench problem and a margin problem rolled into one.",
        example: {
          context: "INFY FY24",
          parts: [
            { label: "LTM Attrition", display: "12.6%" },
          ],
          result: { display: "12.6%", numeric: 12.6 },
          bands: [
            // Lower = better.
            { upTo: 10, label: "Excellent", tone: "excellent" },
            { upTo: 14, label: "Good",      tone: "good" },
            { upTo: 18, label: "OK",        tone: "neutral" },
            { upTo: 24, label: "High",      tone: "weak" },
            { upTo: 35, label: "Severe",    tone: "poor" },
          ],
          note: "Back to comfortable levels after the post-COVID surge — Infosys's LTM attrition has dropped under 13%, the kind of stabilisation that protects FY25 margins.",
        },
      },

      // ─── FMCG ─────────────────────────────────────────────────────────
      {
        name: "Volume Growth — FMCG",
        tagline: "Underlying demand growth, stripping out price hikes.",
        formula: "Volume Growth = YoY change in physical units sold",
        meaning:
          "Revenue growth includes price hikes; volume growth strips those out and tells you whether the consumer is actually buying more. The metric FMCG management is most often grilled on.",
        high: "Mid-single-digit volume growth on a mature FMCG = healthy.",
        low: "Flat or negative volumes for 3+ quarters = real demand problem.",
        example: {
          context: "HINDUNILVR FY24",
          parts: [
            { label: "FY24 underlying volume growth", display: "+2%" },
          ],
          result: { display: "+2%", numeric: 2 },
          bands: [
            { upTo: -3, label: "Declining", tone: "poor" },
            { upTo: 0,  label: "Flat",      tone: "weak" },
            { upTo: 3,  label: "Sluggish",  tone: "neutral" },
            { upTo: 7,  label: "Healthy",   tone: "good" },
            { upTo: 15, label: "Strong",    tone: "excellent" },
          ],
          note: "Sluggish but positive — rural demand recovery has been slow, leaving HUL's volume growth in low single digits while smaller premium players run faster.",
        },
      },

      // ─── Real Estate ──────────────────────────────────────────────────
      {
        name: "Pre-sales Growth — Real Estate",
        tagline: "Booking value of new apartments sold this year.",
        formula: "Pre-sales Growth = YoY change in Bookings (₹ value of units sold)",
        meaning:
          "Real estate revenue is recognised on completion (years later), so pre-sales is the forward-looking demand metric. The number that moves the stock on quarterly results.",
        high: "≥ 25% YoY = strong demand cycle.",
        low: "Negative pre-sales for 2 quarters = the cycle is rolling over.",
        example: {
          context: "GODREJPROP FY24",
          parts: [
            { label: "FY23 Bookings", display: "₹12,230 cr" },
            { label: "FY24 Bookings", display: "₹22,530 cr" },
          ],
          result: { display: "84%", numeric: 84 },
          bands: [
            { upTo: -10, label: "Falling",   tone: "poor" },
            { upTo: 5,   label: "Flat",      tone: "weak" },
            { upTo: 20,  label: "OK",        tone: "neutral" },
            { upTo: 40,  label: "Strong",    tone: "good" },
            { upTo: 100, label: "Explosive", tone: "excellent" },
          ],
          note: "Cycle-peak booking growth — Godrej Properties nearly doubled FY24 pre-sales, reflecting both the broader residential up-cycle and its launch pipeline catching up.",
        },
      },
    ],
  },
];

export const metadata = {
  title: "Glossary — every metric & score in plain English · EquityRoots",
  description:
    "Plain-English definitions of every metric and score on EquityRoots: the Quality, Valuation and Momentum pillars, percentile bands, maturity tiers and more.",
};

export default function GlossaryPage() {
  return (
    <div className="theme-indigo mx-auto max-w-[1200px] px-6 py-12">
      <Hero />
      <ScoreLimitsNote />

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

/** What the score deliberately does NOT model. Placed up top so the limits are
 *  read before the ratios — these are metrics OF the reported numbers, and the
 *  score trusts those numbers. It is not a fraud / governance / regulatory check
 *  (e.g. it would not have flagged a misstated-revenue case like a SEBI order). */
function ScoreLimitsNote() {
  return (
    <div
      className="mt-6 max-w-[760px] rounded-[10px] p-4 text-[12.5px] leading-relaxed"
      style={{
        background: "color-mix(in srgb, var(--color-score-weak) 8%, var(--color-card))",
        border: "1px solid color-mix(in srgb, var(--color-score-weak) 30%, transparent)",
      }}
    >
      <div className="font-semibold ink-text mb-1">What these ratios can&apos;t tell you</div>
      <p className="muted-text">
        Every metric here is computed from a company&apos;s <em>reported</em> financials and
        prices — so the score measures how good those numbers look versus peers, and{" "}
        <strong className="ink-text">assumes the numbers are accurate</strong>. It is not a fraud
        or governance check: it cannot detect misstated revenue, circular or related-party
        transactions, aggressive accounting, auditor resignations, or regulatory action (e.g. a
        SEBI order). For those, read the company&apos;s filings, cash-flow statement and any
        exchange/regulator disclosures yourself. Information only — not investment advice.
      </p>
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
