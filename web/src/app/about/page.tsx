import { Fragment } from "react";
import Link from "next/link";
import { RevealOnScroll } from "@/components/RevealOnScroll";
import { ArrowRight, Layers, Filter, GitBranch, Database } from "lucide-react";

export const revalidate = 86400;

/**
 * Public methodology page — graphical walkthrough.
 *
 * Replaces the previous text-only page with an animated visual journey:
 *   1. Pipeline diagram — how a stock becomes a score
 *   2. Three pillars — animated SVG mini-charts per pillar
 *   3. Maturity tiers — ladder visual
 *   4. Peer-relative — scatter showing "your bucket" highlighted
 *   5. Data sources — pipeline of upstream feeds
 *
 * All animations are pure CSS (keyframes from globals.css: growbar, drawline,
 * fadein) so the page is fully server-rendered — no client hydration cost.
 * Reveal-on-scroll triggers replay each time a section enters the viewport.
 */
export const metadata = {
  title: "About — how we score NSE stocks & the score archive · EquityRoots",
  description:
    "How EquityRoots scores every NSE stock: 46 industry peer groups, each with its own scorecard, plus a weekly append-only score archive you can audit.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-12">
      <Hero />
      <RevealOnScroll><PipelineSection /></RevealOnScroll>
      <RevealOnScroll><PillarsSection /></RevealOnScroll>
      <RevealOnScroll><MaturitySection /></RevealOnScroll>
      <RevealOnScroll><PeerRelativeSection /></RevealOnScroll>
      <RevealOnScroll><DataSourcesSection /></RevealOnScroll>
      <Footer />
    </div>
  );
}

/* =============================================================== HERO === */

function Hero() {
  return (
    <header className="max-w-[760px]">
      <div className="text-[12px] uppercase tracking-wide muted-text">Methodology</div>
      <h1 className="font-display text-[44px] tracking-tight leading-[1.05] mt-2">
        How a stock becomes <em className="accent">a score</em>.
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed muted-text max-w-[640px]">
        Every actively-traded NSE stock is scored on three pillars — Quality,
        Valuation, Momentum — within its peer cluster and maturity tier. The
        result is a 0–100 percentile that means the same thing everywhere on
        the site.
      </p>
    </header>
  );
}

/* ========================================================== PIPELINE === */

/**
 * Pipeline diagram — five stages from raw data to a final composite score.
 * Each stage has an icon + label; arrows between them pulse outward (drift
 * animation) to suggest data flow.
 */
function PipelineSection() {
  const stages = [
    { icon: Database, label: "Public filings",    sub: "Annual + quarterly fundamentals"  },
    { icon: Filter,   label: "Peer cluster",      sub: "Industry × business model"        },
    { icon: Layers,   label: "Pillar percentiles", sub: "Quality · Valuation · Momentum"  },
    { icon: GitBranch,label: "Cluster-tuned blend", sub: "Weights vary by industry"       },
    { icon: ArrowRight, label: "Industry Score 0–100", sub: "Re-percentiled within bucket"     },
  ];

  return (
    <section className="mt-16">
      <div className="text-[11px] uppercase tracking-wide muted-text">The pipeline</div>
      <h2 className="font-display text-[28px] tracking-tight mt-1">
        Raw filings to a <em className="accent">comparable score</em> in five steps.
      </h2>

      <div className="mt-8 card p-6">
        {/* Desktop: 5 columns with horizontal arrow flow. Mobile: stacked vertical. */}
        <div className="hidden md:grid items-stretch gap-1" style={{ gridTemplateColumns: "1fr auto 1fr auto 1fr auto 1fr auto 1fr" }}>
          {stages.map((s, i) => (
            <Fragment key={i}>
              <PipelineNode icon={s.icon} label={s.label} sub={s.sub} delay={i * 0.2} />
              {i < stages.length - 1 && <PipelineArrow delay={i * 0.2 + 0.1} />}
            </Fragment>
          ))}
        </div>
        {/* Mobile fallback */}
        <div className="md:hidden flex flex-col gap-3">
          {stages.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <PipelineNode icon={s.icon} label={s.label} sub={s.sub} delay={i * 0.15} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PipelineNode({ icon: Icon, label, sub, delay }: { icon: React.ElementType; label: string; sub: string; delay: number }) {
  return (
    <div
      className="flex flex-col items-center text-center p-3 rounded-md border hairline"
      style={{
        backgroundColor: "var(--color-card)",
        animation: `fadein 0.5s ease-out ${delay}s both`,
        opacity: 0,
      }}
    >
      <div
        className="w-10 h-10 rounded-md flex items-center justify-center mb-2"
        style={{ backgroundColor: "var(--color-accent-50)", color: "var(--color-accent-700)" }}
      >
        <Icon size={18} strokeWidth={1.8} />
      </div>
      <div className="font-medium text-[12.5px] leading-tight">{label}</div>
      <div className="muted-text text-[10.5px] leading-tight mt-1">{sub}</div>
    </div>
  );
}

function PipelineArrow({ delay }: { delay: number }) {
  return (
    <div className="flex items-center justify-center px-1">
      <svg viewBox="0 0 28 8" width="28" height="8" className="block">
        <line
          x1="0" y1="4" x2="22" y2="4"
          stroke="var(--color-accent-400)"
          strokeWidth="1.5"
          strokeDasharray="100"
          strokeDashoffset="100"
          style={{ animation: `drawline 0.6s ease-out ${delay}s forwards` }}
        />
        <path
          d="M22,1 L27,4 L22,7"
          fill="none"
          stroke="var(--color-accent-400)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0"
          style={{ animation: `fadein 0.3s ease-out ${delay + 0.5}s forwards` }}
        />
      </svg>
    </div>
  );
}

/* ============================================================ PILLARS === */

function PillarsSection() {
  return (
    <section className="mt-20">
      <div className="text-[11px] uppercase tracking-wide muted-text">The three pillars</div>
      <h2 className="font-display text-[28px] tracking-tight mt-1">
        What we actually <em className="accent">measure</em>.
      </h2>
      <p className="muted-text text-[14px] leading-relaxed mt-3 max-w-[640px]">
        Each pillar asks one question. The specific inputs differ by cluster (a bank
        scores differently from a paint company), but the question doesn&apos;t.
      </p>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <PillarCard
          n="01"
          color="var(--color-accent-600)"
          name="Quality"
          q="Does this business compound?"
          body="Returns on capital, multi-window CAGR, growth consistency, cash conversion, balance-sheet discipline. The question we're answering is whether the business has built durable economics — or just had a good year."
          graphic={<QualityGraphic />}
        />
        <PillarCard
          n="02"
          color="var(--color-accent-500)"
          name="Valuation"
          q="Are we paying a fair price?"
          body="P/E, P/B, EV/EBITDA, FCF and dividend yield — but always relative to peers in the same cluster, never the whole market. A 25× P/E in pharma means something very different from a 25× P/E in cement."
          graphic={<ValuationGraphic />}
        />
        <PillarCard
          n="03"
          color="var(--color-accent-400)"
          name="Momentum"
          q="Is the market noticing?"
          body="Price momentum across 3, 6, 12-month horizons relative to the broader market — blended with latest-quarter earnings momentum. The two together separate hype from fundamentals turning."
          graphic={<MomentumGraphic />}
        />
      </div>
    </section>
  );
}

function PillarCard({ n, color, name, q, body, graphic }: {
  n: string; color: string; name: string; q: string; body: string; graphic: React.ReactNode;
}) {
  return (
    <article className="card p-5 flex flex-col" style={{ borderTop: `3px solid ${color}` }}>
      <div className="h-[110px] flex items-center justify-center mb-3">{graphic}</div>
      <div className="ntag" style={{ fontSize: 28 }}>{n}</div>
      <h3 className="font-display mt-1.5" style={{ fontSize: 21, color }}>{name}</h3>
      <div className="muted-text italic text-[12.5px] mt-1">{q}</div>
      <p className="muted-text mt-3 text-[13px] leading-relaxed">{body}</p>
    </article>
  );
}

function QualityGraphic() {
  // Climbing RoE bars — visual metaphor for compounding quality
  return (
    <svg width="240" height="120" viewBox="0 0 240 120">
      <text x="120" y="14" fontSize="9" fill="var(--color-muted)" textAnchor="middle" fontFamily="Inter">
        Return on equity · 8y trend
      </text>
      {[68, 62, 74, 56, 44, 38, 32, 20].map((y, i) => (
        <rect
          key={i}
          x={4 + i * 28}
          y={y}
          width={22}
          height={100 - y}
          rx={2}
          fill="var(--color-accent-600)"
          opacity={0.35 + i * 0.085}
          className="svg-bar"
          style={{ animationDelay: `${0.05 + i * 0.07}s` }}
        />
      ))}
      <line x1="0" y1="100" x2="232" y2="100" stroke="var(--color-border-default)" />
    </svg>
  );
}

function ValuationGraphic() {
  // Peer vs stock P/E — horizontal bar comparison
  return (
    <svg width="240" height="120" viewBox="0 0 240 120">
      <text x="0" y="20" fontSize="10" fill="var(--color-ink)" fontFamily="Inter">Peer median P/E</text>
      <rect x="0" y="28" width="160" height="14" rx="3" fill="var(--color-muted)" opacity="0.30" className="svg-hbar" style={{ animationDelay: "0.1s" }} />
      <text x="166" y="40" fontSize="11" fill="var(--color-muted)" fontFamily="JetBrains Mono">28×</text>
      <text x="0" y="68" fontSize="10" fill="var(--color-ink)" fontFamily="Inter">This stock</text>
      <rect x="0" y="76" width="120" height="14" rx="3" fill="var(--color-accent-400)" className="svg-hbar" style={{ animationDelay: "0.55s" }} />
      <text x="126" y="88" fontSize="11" fill="var(--color-accent-600)" fontFamily="JetBrains Mono">21×</text>
      <text x="0" y="112" fontSize="9" fill="var(--color-muted)" fontFamily="Inter">
        25% cheaper than the cluster median
      </text>
    </svg>
  );
}

function MomentumGraphic() {
  // Two lines: market (dashed) vs stock (solid, climbing)
  return (
    <svg width="240" height="120" viewBox="0 0 240 120">
      <path d="M12,80 L32,76 L52,78 L72,72 L92,68 L112,72 L132,66 L152,60 L172,64 L192,58 L212,56 L228,62"
        fill="none" stroke="var(--color-muted)" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M12,80 L32,72 L52,66 L72,58 L92,48 L112,42 L132,32 L152,24 L172,20 L192,14 L212,10 L228,8"
        fill="none" stroke="var(--color-accent-300)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
        className="svg-line-slow" style={{ animationDelay: "0.3s" }} />
      <circle cx="228" cy="8" r="3.5" fill="var(--color-accent-500)" className="svg-dot" style={{ animationDelay: "2.5s" }} />
      <text x="12" y="116" fontSize="9" fill="var(--color-muted)" fontFamily="Inter">12 months ago</text>
      <text x="228" y="116" fontSize="9" fill="var(--color-muted)" fontFamily="Inter" textAnchor="end">today</text>
    </svg>
  );
}

/* ============================================================ MATURITY === */

function MaturitySection() {
  // Each tier shown as a horizontal bar whose length encodes years of history.
  // The widest gets the brand color, narrower tiers get progressively lighter.
  const tiers = [
    { name: "Long-term Compounder", years: 10, label: "10+ years",   desc: "Richest set of long-window metrics; consistency-over-a-decade matters",  color: "var(--color-accent-600)", widthPct: 100 },
    { name: "Established",          years: 7,  label: "7–9 years",   desc: "Base scorecard with full 5-year trends",                                  color: "var(--color-accent-500)", widthPct: 80 },
    { name: "Emerging",             years: 3,  label: "3–6 years",   desc: "Shorter-window metrics; momentum weighted slightly higher",               color: "var(--color-accent-400)", widthPct: 55 },
    { name: "New Listing",          years: 1,  label: "1–2 years",   desc: "Latest-year metrics + momentum-tilted weighting; listed in last 24 months", color: "var(--color-accent-300)", widthPct: 30 },
  ];

  return (
    <section className="mt-20">
      <div className="text-[11px] uppercase tracking-wide muted-text">Maturity tiers</div>
      <h2 className="font-display text-[28px] tracking-tight mt-1">
        Apples to <em className="accent">apples</em>, by history.
      </h2>
      <p className="muted-text text-[14px] leading-relaxed mt-3 max-w-[640px]">
        A 1-year-old IPO can&apos;t be scored on a 5-year CAGR. We bucket stocks by available
        history so the comparison is fair within each tier.
      </p>

      <div className="mt-8 card p-6">
        <div className="flex flex-col gap-4">
          {tiers.map((t, i) => (
            <div key={t.name} className="grid items-center gap-4" style={{ gridTemplateColumns: "180px 1fr 100px" }}>
              <div>
                <div className="font-medium text-[14px]" style={{ color: t.color }}>{t.name}</div>
                <div className="muted-text text-[11px] tabular-nums mt-0.5">{t.label}</div>
              </div>
              <div className="relative h-8 rounded-md overflow-hidden" style={{ background: "var(--color-paper)" }}>
                <div
                  className="absolute inset-y-0 left-0 rounded-md"
                  style={{
                    width: `${t.widthPct}%`,
                    background: t.color,
                    transformOrigin: "left",
                    animation: `growbar 1.4s cubic-bezier(.22,.7,.25,1) ${i * 0.15}s both`,
                    opacity: 0.85,
                  }}
                />
                {/* Year tick marks (1, 3, 7, 10) for scale reference */}
                {[10, 30, 70].map((p) => (
                  <span
                    key={p}
                    className="absolute inset-y-1"
                    style={{ left: `${p}%`, width: 1, background: "rgba(0,0,0,0.06)" }}
                  />
                ))}
              </div>
              <div className="muted-text text-[12px] tabular-nums">
                ≈ {t.years} yr{t.years === 1 ? "" : "s"}+
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-5 border-t hairline text-[12.5px] muted-text leading-relaxed max-w-[720px]">
          A stock is scored against <em>other stocks in the same tier</em> (e.g. an Emerging
          mid-cap NBFC is compared to other Emerging mid-cap NBFCs, not to HDFC Bank).
          Tiers shift as a company accumulates history.
        </div>
      </div>
    </section>
  );
}

/* ========================================================== PEER-RELATIVE === */

function PeerRelativeSection() {
  // Scatter plot showing stocks across the universe. A cluster's stocks are
  // highlighted to make the "peer bucket" concept visible at a glance.
  // The plot is pure SVG — random-but-deterministic positions seeded by index.
  const universeDots = Array.from({ length: 70 }, (_, i) => {
    // Deterministic pseudo-random distribution
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
    return { x: Math.abs(x), y: Math.abs(y) };
  });
  const clusterDots = Array.from({ length: 9 }, (_, i) => {
    // Tighter cluster around mid-right
    const angle = (i / 9) * Math.PI * 2;
    return { x: 0.62 + Math.cos(angle) * 0.07, y: 0.35 + Math.sin(angle) * 0.06 };
  });

  return (
    <section className="mt-20">
      <div className="text-[11px] uppercase tracking-wide muted-text">Why peer-relative</div>
      <h2 className="font-display text-[28px] tracking-tight mt-1">
        Compared to <em className="accent">its bucket</em>, not the whole market.
      </h2>
      <p className="muted-text text-[14px] leading-relaxed mt-3 max-w-[640px]">
        Comparing a small-cap NBFC to HDFC Bank on absolute RoE is meaningless — they
        operate at different scales, regulatory regimes, and growth profiles.
        Comparing it to other small-cap NBFCs on the same scorecard <em>is</em>.
      </p>

      <div className="mt-8 grid md:grid-cols-[1.3fr_1fr] gap-6 items-center">
        <div className="card p-5">
          <svg viewBox="0 0 360 220" className="w-full block">
            <text x="180" y="14" fontSize="10" fill="var(--color-muted)" textAnchor="middle" fontFamily="Inter">
              All NSE stocks · one dot per company
            </text>
            {/* Background dots: the broader market */}
            {universeDots.map((d, i) => (
              <circle
                key={`u-${i}`}
                cx={20 + d.x * 320}
                cy={28 + d.y * 170}
                r="2.4"
                fill="var(--color-muted)"
                opacity="0.25"
                className="svg-dot"
                style={{ animationDelay: `${i * 0.012}s` }}
              />
            ))}
            {/* Highlighted cluster — animated last */}
            <ellipse
              cx={20 + 0.62 * 320}
              cy={28 + 0.35 * 170}
              rx="38"
              ry="34"
              fill="var(--color-accent-100)"
              stroke="var(--color-accent-400)"
              strokeWidth="1.5"
              opacity="0"
              style={{ animation: "fadein 0.8s ease-out 1.2s forwards" }}
            />
            {clusterDots.map((d, i) => (
              <circle
                key={`c-${i}`}
                cx={20 + d.x * 320}
                cy={28 + d.y * 170}
                r="3.2"
                fill="var(--color-accent-600)"
                opacity="0"
                style={{ animation: `fadein 0.4s ease-out ${1.4 + i * 0.08}s forwards` }}
              />
            ))}
            {/* Label */}
            <text
              x={20 + 0.62 * 320 + 55}
              y={28 + 0.35 * 170 - 4}
              fontSize="10.5"
              fontFamily="Inter"
              fill="var(--color-accent-700)"
              opacity="0"
              style={{ animation: "fadein 0.6s ease-out 2.2s forwards" }}
            >
              Your stock&apos;s
            </text>
            <text
              x={20 + 0.62 * 320 + 55}
              y={28 + 0.35 * 170 + 9}
              fontSize="10.5"
              fontFamily="Inter"
              fill="var(--color-accent-700)"
              fontWeight="600"
              opacity="0"
              style={{ animation: "fadein 0.6s ease-out 2.4s forwards" }}
            >
              peer bucket
            </text>
          </svg>
        </div>

        <div>
          <p className="text-[14px] leading-relaxed">
            Every percentile on the platform is computed within a stock&apos;s{" "}
            <em>(peer cluster, maturity tier)</em> bucket. A <strong>75</strong> always
            means &quot;top 25% within its bucket&quot; — same meaning across the site.
          </p>
          <p className="muted-text text-[13px] leading-relaxed mt-3">
            That&apos;s why a small Pharma stock with a 70 Industry Score is genuinely
            ranked above its peers, even if a Bank with a 70 Industry Score looks
            completely different on the absolute numbers. Same percentile, same
            relative position.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ DATA SOURCES === */

function DataSourcesSection() {
  return (
    <section className="mt-20">
      <div className="text-[11px] uppercase tracking-wide muted-text">Data sources</div>
      <h2 className="font-display text-[28px] tracking-tight mt-1">
        Public filings, <em className="accent">weekly cadence</em>.
      </h2>
      <p className="muted-text text-[14px] leading-relaxed mt-3 max-w-[640px]">
        Fundamentals are derived from publicly disclosed company filings.
        Daily prices and technical indicators are computed from open market data.
        All scores recompute weekly after each Friday&apos;s market close.
      </p>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <DataPill
          label="Fundamentals"
          sub="Annual + quarterly filings"
          examples={["P&L", "Balance sheet", "Cash flow"]}
          delay={0}
        />
        <DataPill
          label="Prices & technicals"
          sub="Daily close from open market data"
          examples={["1d / 1w / 1m returns", "Trend strength", "Earnings momentum"]}
          delay={0.15}
        />
        <DataPill
          label="Ownership"
          sub="Quarterly shareholding patterns"
          examples={["Promoter %", "FII %", "DII %"]}
          delay={0.3}
        />
      </div>

      <div
        className="mt-8 p-5 rounded-lg flex items-center gap-3"
        style={{ background: "var(--color-accent-50)", border: "1px solid var(--color-accent-200)" }}
      >
        <span
          className="w-2 h-2 rounded-full animate-livepulse shrink-0"
          style={{ backgroundColor: "var(--color-score-excellent)" }}
        />
        <div className="text-[13px] leading-relaxed" style={{ color: "var(--color-accent-700)" }}>
          <strong>Weekly cadence.</strong> Every Friday after market close, the
          full universe is rescored. The previous snapshot is preserved — we
          never edit history. A score from week 1 is exactly what we said
          back then.
        </div>
      </div>
    </section>
  );
}

function DataPill({ label, sub, examples, delay }: {
  label: string; sub: string; examples: string[]; delay: number;
}) {
  return (
    <article
      className="card p-4"
      style={{ animation: `fadein 0.5s ease-out ${delay}s both`, opacity: 0 }}
    >
      <div className="font-medium text-[14px]">{label}</div>
      <div className="muted-text text-[11.5px] mt-0.5">{sub}</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {examples.map((e) => (
          <span
            key={e}
            className="inline-flex items-center px-2 py-0.5 rounded-sm hairline border text-[10.5px]"
            style={{ color: "var(--color-accent-600)" }}
          >
            {e}
          </span>
        ))}
      </div>
    </article>
  );
}

/* ============================================================ FOOTER === */

function Footer() {
  return (
    <footer className="mt-20 pt-6 border-t hairline">
      <div className="text-[14px] leading-relaxed max-w-[760px]">
        <h3 className="font-medium text-[14.5px] mb-2">What we don&apos;t publish</h3>
        <p className="muted-text">
          The specific peer-cluster definitions, per-cluster pillar weights, and the
          underlying metric weights inside each pillar are research IP we maintain
          in-house and continuously refine. On any individual stock&apos;s page we show
          you exactly how that stock&apos;s score is built — its pillar percentiles,
          which metrics drove them up or down, and which strengths and gaps stand out
          vs peers. That&apos;s the transparency that matters when reading a score.
        </p>
      </div>
      <div className="mt-6 text-[12px] muted-text leading-relaxed">
        Not investment advice. Scores are quantitative rankings, not buy/sell
        recommendations. Always do your own research.{" "}
        <Link href="/" className="underline hover:no-underline">
          Back to the heat map
        </Link>.
      </div>
    </footer>
  );
}
