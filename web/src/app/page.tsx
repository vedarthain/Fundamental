import Link from "next/link";
import { sql } from "@/lib/db";
import { ArrowRight, Check } from "lucide-react";
import { RevealOnScroll } from "@/components/RevealOnScroll";
import {
  SampleScorecard,
  WorkspacePreview,
  ThreePillarsSegmented,
  ResponsiveSectorHeatmap,
} from "./LandingClient";

// Scores update weekly — 24h cache is safe and dramatically cuts Neon wakes.
export const revalidate = 86400;

type Snapshot = {
  stocks: number;
  clusters: number;
  veterans: number;
  weeks: number;
  snapshot_date: string | null;
};

type IndustryTile = {
  industry_id: string;
  industry_name: string;
  avg_composite: number | null;
};

const DEFAULT_SNAPSHOT: Snapshot = {
  stocks: 2122,
  clusters: 46,
  veterans: 1650,
  weeks: 48,
  snapshot_date: null,
};

const DEFAULT_TILES: IndustryTile[] = [
  { industry_id: "auto", industry_name: "Automobiles & Ancillary", avg_composite: 84 },
  { industry_id: "it-services", industry_name: "IT Services & Software", avg_composite: 79 },
  { industry_id: "private-banks", industry_name: "Private Banks", avg_composite: 72 },
  { industry_id: "chemicals", industry_name: "Specialty Chemicals", avg_composite: 64 },
  { industry_id: "pharma", industry_name: "Pharmaceuticals", avg_composite: 58 },
  { industry_id: "cement", industry_name: "Cement & Building Materials", avg_composite: 53 },
  { industry_id: "metals", industry_name: "Metals & Mining", avg_composite: 47 },
  { industry_id: "fmcg", industry_name: "FMCG & Consumer Foods", avg_composite: 68 },
  { industry_id: "capital-goods", industry_name: "Capital Goods & Engineering", avg_composite: 74 },
  { industry_id: "power", industry_name: "Power & Renewable Energy", avg_composite: 62 },
  { industry_id: "oil-gas", industry_name: "Oil & Gas Refining", avg_composite: 55 },
  { industry_id: "realty", industry_name: "Real Estate & Construction", avg_composite: 66 },
  { industry_id: "telecom", industry_name: "Telecom & Towers", avg_composite: 59 },
  { industry_id: "textiles", industry_name: "Textiles & Apparels", avg_composite: 51 },
  { industry_id: "consumer-durables", industry_name: "Consumer Durables", avg_composite: 60 },
];

async function loadHero() {
  try {
    const snapPromise = sql<Snapshot[]>`
      SELECT
        (SELECT COUNT(*)::int FROM app.scores
          WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)) AS stocks,
        (SELECT COUNT(*)::int FROM app.cluster_composite_cache
          WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)) AS clusters,
        (SELECT COUNT(*)::int FROM app.scores
          WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
            AND maturity_tier = 'veteran') AS veterans,
        (SELECT COUNT(DISTINCT snapshot_date)::int FROM app.scores) AS weeks,
        (SELECT MAX(snapshot_date)::text FROM app.scores) AS snapshot_date
    `;

    const tilesPromise = sql<IndustryTile[]>`
      SELECT cluster_id AS industry_id,
             industry_name,
             composite_aggr_pct::float AS avg_composite
      FROM app.cluster_composite_cache
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      ORDER BY composite_aggr_pct DESC NULLS LAST
    `;

    const [snapRows, tiles] = await Promise.all([snapPromise, tilesPromise]);
    return {
      snap: snapRows[0] ?? DEFAULT_SNAPSHOT,
      tiles: tiles.length > 0 ? tiles : DEFAULT_TILES,
    };
  } catch {
    // Zero latency fallback if DB is cold
    return { snap: DEFAULT_SNAPSHOT, tiles: DEFAULT_TILES };
  }
}

export default async function Landing() {
  const { snap, tiles } = await loadHero();

  return (
    <>
      <Hero snap={snap} />
      <RevealOnScroll><WorkspacePreview /></RevealOnScroll>
      <RevealOnScroll><ResponsiveSectorHeatmap tiles={tiles} /></RevealOnScroll>
      <RevealOnScroll><MethodologyComparison /></RevealOnScroll>
      <RevealOnScroll><ThreePillarsSegmented /></RevealOnScroll>
      <FooterCTA />
    </>
  );
}

/* =============================================================== HERO === */

function Hero({ snap }: { snap: Snapshot }) {
  const stockCount = snap?.stocks ? snap.stocks.toLocaleString("en-IN") : "2,122";
  const clusterCount = snap?.clusters ? String(snap.clusters) : "46";

  return (
    <section className="grain relative overflow-hidden">
      <div className="relative max-w-[1200px] mx-auto px-4 sm:px-6 pt-6 pb-8 md:pt-14 md:pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          
          {/* Left Column: Core Value Pitch */}
          <div className="lg:col-span-7">
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border hairline mb-4 text-[11.5px] muted-text shadow-2xs"
              style={{ backgroundColor: "var(--color-card)" }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-livepulse"
                style={{ backgroundColor: "var(--color-score-excellent)" }}
              />
              {stockCount} NSE stocks · {clusterCount} true peer clusters
            </div>

            <h1
              className="font-display"
              style={{
                fontSize: "clamp(30px, 4.4vw, 56px)",
                lineHeight: 1.04,
                letterSpacing: "-0.022em",
                maxWidth: 680,
                textWrap: "balance",
              }}
            >
              Indian stocks, ranked against their{" "}
              <em className="accent">real peers.</em>
            </h1>

            <p className="muted-text mt-3.5 text-[15px] sm:text-[15.5px] leading-[1.55] max-w-[540px]">
              Quality, Valuation, and Momentum percentiles recomputed weekly across {clusterCount} custom
              industry recipes. Stop comparing a high-growth small-cap to a mega conglomerate.
            </p>

            {/* Benefit Pills */}
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2 max-w-[620px]">
              <BenefitPill
                icon="🔍"
                label="Compounders"
                sub="Quality + value in cluster"
                href="/ideas?bucket=compounder"
              />
              <BenefitPill
                icon="⚖️"
                label="Peer Compare"
                sub="Apples-to-apples cards"
                href="/tools/peer-comparison"
              />
              <BenefitPill
                icon="💼"
                label="Portfolio Sync"
                sub="Zerodha / Upstox import"
                href="/signup"
              />
            </div>

            {/* CTAs */}
            <div className="mt-6 flex gap-3 items-center flex-wrap">
              <Link href="/sectors" className="btn-primary text-[13.5px]">
                Browse all sectors
                <ArrowRight size={14} />
              </Link>
              <Link href="/signup" className="btn-ghost text-[13.5px]">
                Create free account
              </Link>
            </div>
          </div>

          {/* Right Column: Interactive Sample Scorecard */}
          <div className="lg:col-span-5 w-full">
            <SampleScorecard />
          </div>

        </div>
      </div>
    </section>
  );
}

function BenefitPill({
  icon,
  label,
  sub,
  href,
}: {
  icon: string;
  label: string;
  sub: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="card px-3 py-2.5 flex items-center gap-2.5 hover:border-[var(--color-accent-400)] transition-colors group shadow-2xs"
    >
      <span className="text-[18px] leading-none">{icon}</span>
      <span className="flex flex-col">
        <span className="font-medium text-[13px] text-[var(--color-ink)] leading-snug">
          {label}
        </span>
        <span className="text-[10.5px] muted-text leading-tight">{sub}</span>
      </span>
      <ArrowRight
        size={11}
        className="ml-auto shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
        style={{ color: "var(--color-accent-600)" }}
      />
    </Link>
  );
}

/* =============================================================== METHODOLOGY COMPARISON === */

function MethodologyComparison() {
  return (
    <section className="border-t hairline" style={{ backgroundColor: "var(--color-card)" }}>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-10 sm:py-12 md:py-16">
        <div className="text-center max-w-[640px] mx-auto mb-9">
          <div className="eyebrow mb-2.5">The Core Philosophy</div>
          <h2 className="font-display" style={{ fontSize: "clamp(26px, 3.2vw, 38px)", lineHeight: 1.08 }}>
            Why generic screeners <em className="accent">fail you.</em>
          </h2>
          <p className="muted-text mt-3 text-[14px] leading-[1.55] max-w-[520px] mx-auto">
            Traditional screeners rank every stock on one flat scale. A 20× P/E is cheap for an IT
            giant, but expensive for a commodity cement mill.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[840px] mx-auto">
          {/* Without EquityRoots */}
          <div
            className="card p-4 sm:p-5 border hairline flex flex-col justify-between break-words"
            style={{ backgroundColor: "rgba(198, 63, 35, 0.04)", borderColor: "rgba(198, 63, 35, 0.2)" }}
          >
            <div>
              <div className="flex items-center gap-2 mb-2 font-semibold text-[13px] text-[var(--color-score-poor)]">
                <span>❌</span> Standard Stock Screeners
              </div>
              <p className="text-[13px] text-[var(--color-ink)] leading-[1.55]">
                Compares <strong>AU Small Finance Bank</strong> directly against mega conglomerates like{" "}
                <strong>HDFC Bank</strong> and <strong>ICICI</strong>.
              </p>
              <p className="text-[12px] muted-text mt-2 leading-[1.5]">
                Smaller, high-growth compounders look perpetually distorted on raw scale and branch
                metrics.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t hairline text-[11.5px] muted-text font-mono">
              Result: Misleading valuations &amp; missed multibaggers
            </div>
          </div>

          {/* With EquityRoots */}
          <div
            className="card p-4 sm:p-5 border hairline flex flex-col justify-between break-words"
            style={{ backgroundColor: "rgba(46, 154, 71, 0.04)", borderColor: "rgba(46, 154, 71, 0.2)" }}
          >
            <div>
              <div className="flex items-center gap-2 mb-2 font-semibold text-[13px] text-[var(--color-score-excellent)]">
                <span>✅</span> EquityRoots True Peer Clusters
              </div>
              <p className="text-[13px] text-[var(--color-ink)] leading-[1.55]">
                Ranks AU against true equals: <strong>Equitas</strong>, <strong>Ujjivan</strong>, and{" "}
                <strong>Suryoday</strong>.
              </p>
              <p className="text-[12px] text-[var(--color-ink)] opacity-80 mt-2 leading-[1.5]">
                Loan book CAGR, Return on Assets, and capital cushion are evaluated strictly within its
                actual business peer group.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t hairline text-[11.5px] font-semibold font-mono text-[var(--color-score-excellent)]">
              Result: True percentiles &amp; institutional clarity
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =============================================================== FOOTER CTA === */

function FooterCTA() {
  return (
    <section
      className="border-t hairline"
      style={{ backgroundColor: "var(--color-accent-50)" }}
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 sm:py-12 md:py-16 text-center">
        <h2
          className="font-display mx-auto"
          style={{
            fontSize: "clamp(30px, 4.5vw, 54px)",
            lineHeight: 1.06,
            maxWidth: 680,
            textWrap: "balance",
          }}
        >
          Start with the part of the market{" "}
          <em className="accent" style={{ color: "var(--color-accent-700)" }}>
            you care about.
          </em>
        </h2>
        <p className="muted-text mt-3 text-[14.5px] max-w-[500px] mx-auto">
          Explore 2,122 NSE stocks, diagnose your personal portfolio, and track true peer percentiles.
        </p>
        <div className="mt-7 flex gap-3 justify-center flex-wrap">
          <Link href="/sectors" className="btn-primary text-[13.5px]">
            Open all 46 sectors
            <ArrowRight size={14} />
          </Link>
          <Link href="/signup" className="btn-ghost text-[13.5px]">
            Create free account
          </Link>
        </div>
      </div>
    </section>
  );
}
