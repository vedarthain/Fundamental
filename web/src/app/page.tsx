import Link from "next/link";
import { sql } from "@/lib/db";
import { ArrowRight } from "lucide-react";
import { band, bandColor } from "@/lib/score";

export const revalidate = 1800;

type Snapshot = {
  stocks: number;
  clusters: number;
  veterans: number;
  snapshot_date: string | null;
};

type TilePreview = {
  cluster_id: string;
  cluster_name: string;
  meta_cluster_id: string;
  meta_display_order: number;
  avg_composite: number | null;
};

async function loadHero() {
  const [snap, tiles] = await Promise.all([
    sql<Snapshot[]>`
      SELECT
        (SELECT COUNT(*)::int FROM app.universe WHERE is_active) AS stocks,
        (SELECT COUNT(*)::int FROM app.cluster WHERE id <> 'unclassified') AS clusters,
        (SELECT COUNT(*)::int FROM app.universe WHERE is_active AND maturity_tier='veteran') AS veterans,
        (SELECT MAX(snapshot_date)::text FROM app.scores) AS snapshot_date
    `,
    sql<TilePreview[]>`
      SELECT c.id AS cluster_id, c.name AS cluster_name,
             c.meta_cluster_id, mc.display_order AS meta_display_order,
             AVG(s.composite_pct)::float AS avg_composite
      FROM app.cluster c
      JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
      LEFT JOIN app.scores s ON s.cluster_id = c.id
        AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      WHERE c.id <> 'unclassified'
      GROUP BY c.id, c.name, c.meta_cluster_id, mc.display_order
      ORDER BY mc.display_order, c.name
    `,
  ]);
  return { snap: snap[0], tiles };
}

export default async function Landing() {
  const { snap, tiles } = await loadHero();
  return (
    <>
      <Hero snap={snap} />
      <ByTheNumbers snap={snap} />
      <WhatWeDo />
      <ThreePillars />
      <SpiderMoment />
      <MoatStrip />
      <FooterCTA />
    </>
  );
}

/* -------------------------------------------------------------- Hero --- */

function Hero({ snap }: { snap: Snapshot }) {
  return (
    <section className="relative">
      <div className="mx-auto max-w-[1200px] px-6 pt-20 md:pt-28 pb-12 text-center">
        <h1 className="font-display text-[52px] sm:text-[72px] md:text-[96px] leading-[0.98] tracking-[-0.02em] mx-auto max-w-[920px]">
          Where India&apos;s market{" "}
          <em className="not-italic" style={{ color: "var(--color-accent-600)" }}>
            really
          </em>{" "}
          stands.
        </h1>
        <p className="mt-7 text-[16px] md:text-[18px] muted-text max-w-[520px] mx-auto">
          Every NSE stock, scored against its true peers.{" "}
          <span className="tabular-nums">{snap.stocks.toLocaleString("en-IN")}</span>{" "}
          companies. {snap.clusters} clusters. Updated weekly.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <Link
            href="/clusters"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[14px] font-medium text-white transition-transform hover:scale-[1.03]"
            style={{ backgroundColor: "var(--color-accent-500)" }}
          >
            Open the heat map
            <ArrowRight size={14} />
          </Link>
          <Link
            href="/about"
            className="text-[14px] underline underline-offset-4 hover:no-underline muted-text"
          >
            How it works
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------- By the numbers --------- */

function ByTheNumbers({ snap }: { snap: Snapshot }) {
  const items = [
    { value: snap.stocks.toLocaleString("en-IN"), label: "stocks scored" },
    { value: String(snap.clusters), label: "peer clusters" },
    { value: snap.veterans.toLocaleString("en-IN"), label: "long-term compounders" },
  ];
  return (
    <section className="border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="mx-auto max-w-[1100px] px-6 py-24 md:py-32">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-6 items-end">
          {items.map((it, i) => (
            <div
              key={it.label}
              className={`text-center ${
                i < items.length - 1
                  ? "md:border-r md:hairline md:border-r-[var(--color-border-default)]"
                  : ""
              } md:px-4`}
            >
              <div
                className="font-display tabular-nums leading-[0.9]"
                style={{
                  fontSize: "clamp(72px, 12vw, 132px)",
                  letterSpacing: "-0.03em",
                }}
              >
                {it.value}
              </div>
              <div className="mt-4 text-[12px] uppercase tracking-[0.18em] muted-text">
                {it.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------- (legacy) heat map ------- */

// Kept temporarily — not rendered. Can delete once design lands.
function _HeatMapShowcase({ tiles }: { tiles: TilePreview[] }) {
  // All 41 tiles, sorted by avg_composite descending so the colour
  // gradient itself tells the story — green at top, red at bottom.
  const sorted = [...tiles].sort((a, b) => {
    const av = a.avg_composite ?? -1;
    const bv = b.avg_composite ?? -1;
    return bv - av;
  });

  return (
    <section className="border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 gap-2 max-w-[1000px] mx-auto">
          {sorted.map((t) => {
            const b = band(t.avg_composite);
            const bg = bandColor(b);
            const numColor = b === "neutral" ? "var(--color-ink)" : "white";
            return (
              <Link
                key={t.cluster_id}
                href={`/cluster/${t.cluster_id}`}
                className="aspect-square rounded-md flex flex-col items-center justify-center p-2 transition-transform hover:scale-[1.05]"
                style={{ backgroundColor: bg }}
                title={t.cluster_name}
              >
                <span
                  className="font-display text-[20px] md:text-[24px] tabular-nums leading-none"
                  style={{ color: numColor }}
                >
                  {t.avg_composite == null ? "—" : Math.round(t.avg_composite)}
                </span>
                <span
                  className="text-[8.5px] md:text-[9.5px] mt-1 text-center leading-tight line-clamp-2"
                  style={{ color: numColor, opacity: 0.85 }}
                >
                  {t.cluster_name}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="mt-10 text-center text-[12px] muted-text">
          Every peer cluster, today. Click any tile.
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------- What we do ------------- */

function WhatWeDo() {
  return (
    <section className="mx-auto max-w-[1100px] px-6 py-24 md:py-32">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-14 items-center">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] muted-text mb-4">
            What we do
          </div>
          <h2 className="font-display text-[36px] md:text-[44px] leading-[1.05] tracking-tight">
            Stock analysis, the way an{" "}
            <em className="not-italic" style={{ color: "var(--color-accent-600)" }}>
              analyst
            </em>{" "}
            actually thinks.
          </h2>
          <div className="mt-6 space-y-4 text-[15.5px] leading-[1.65] muted-text max-w-[480px]">
            <p>
              Indian retail investors get one of two things today: raw fundamentals
              tables, or someone else&apos;s buy/sell call. Neither tells you how a
              business actually stacks up against its real peers.
            </p>
            <p>
              We score every actively-traded NSE stock against the companies it should
              be compared to — not the whole market — across three dimensions an analyst
              would use: <strong className="ink-text">does it compound</strong>,{" "}
              <strong className="ink-text">is it fairly priced</strong>,{" "}
              <strong className="ink-text">is the market noticing yet</strong>.
            </p>
            <p>
              The result: a single 0–100 ranking that means the same thing everywhere on
              the site, with the strengths and gaps spelled out in plain English.
            </p>
          </div>
        </div>

        <ProductMosaic />
      </div>
    </section>
  );
}

/** Stylized "product moment" — three nested cards as a glimpse. */
function ProductMosaic() {
  return (
    <div className="relative h-[360px] md:h-[420px]">
      {/* Back card — fundamentals snippet */}
      <div
        className="absolute right-0 top-0 w-[260px] card p-4 rotate-[3deg] origin-bottom-right"
        style={{ backgroundColor: "var(--color-card)" }}
      >
        <div className="text-[10px] uppercase tracking-wide muted-text">
          Annual P&amp;L · last 5 years
        </div>
        <div className="mt-2 space-y-1.5">
          {[
            ["FY22", "₹254K"],
            ["FY23", "₹289K"],
            ["FY24", "₹322K"],
            ["FY25", "₹358K"],
            ["FY26", "₹401K"],
          ].map(([y, v]) => (
            <div key={y} className="flex justify-between text-[12px]">
              <span className="muted-text">{y}</span>
              <span className="tabular-nums">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Middle card — strength bars */}
      <div
        className="absolute left-0 top-[60px] w-[260px] card p-4 -rotate-[2deg]"
        style={{ backgroundColor: "var(--color-card)" }}
      >
        <div className="text-[10px] uppercase tracking-wide muted-text mb-2">
          Strengths &amp; gaps
        </div>
        {[
          { name: "Momentum", v: 91 },
          { name: "Growth", v: 84 },
          { name: "Profitability", v: 78 },
          { name: "Cash & BS", v: 62 },
          { name: "Valuation", v: 47 },
        ].map((r) => (
          <div key={r.name} className="grid grid-cols-[80px_1fr_24px] items-center gap-2 mb-1.5 text-[10.5px]">
            <span className="muted-text">{r.name}</span>
            <div className="relative h-1.5 rounded-full bg-[var(--color-paper)]">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${r.v}%`,
                  backgroundColor: bandColor(band(r.v)),
                  opacity: 0.9,
                }}
              />
              <div
                className="absolute top-0 bottom-0 w-px bg-[var(--color-muted)]/40"
                style={{ left: "50%" }}
              />
            </div>
            <span className="text-right tabular-nums" style={{ color: bandColor(band(r.v)) }}>
              {r.v}
            </span>
          </div>
        ))}
      </div>

      {/* Front card — composite badge */}
      <div
        className="absolute right-[20px] bottom-0 w-[200px] card p-5 rotate-[-2deg] shadow-sm"
        style={{ backgroundColor: "var(--color-card)" }}
      >
        <div className="text-[10px] uppercase tracking-wide muted-text">
          Composite
        </div>
        <div
          className="font-display text-[64px] tabular-nums leading-none mt-1"
          style={{ color: "var(--color-score-excellent)" }}
        >
          82
        </div>
        <div className="mt-2 text-[10.5px] muted-text">
          Top 18% in Pharmaceuticals · Established
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------- Three pillars ---------- */

function ThreePillars() {
  const pillars = [
    {
      name: "Quality",
      color: "var(--color-accent-600)",
      tagline: "Does this business compound?",
      body: "Returns on capital, top- and bottom-line growth across multiple windows, growth consistency, cash conversion, balance-sheet discipline, and margin trends. The question we&apos;re answering is whether the business has built durable economics — or just had a good year.",
      examples: ["Returns on equity & capital", "5y, 7y, 10y CAGR", "Cash flow vs reported profit", "Debt discipline"],
      graphic: <RoeBars />,
    },
    {
      name: "Valuation",
      color: "var(--color-accent-400)",
      tagline: "Are we paying a fair price?",
      body: "Earnings yield, book value, EBITDA multiples, dividend yield, free cash flow yield. But always relative to peers in the same industry, never the broader market — because a 25 P/E in pharma means something very different from a 25 P/E in cement.",
      examples: ["P/E, P/B, EV/EBITDA", "PEG, FCF yield, dividend yield", "Earnings-yield trend", "Peer-median anchored"],
      graphic: <PeBars />,
    },
    {
      name: "Momentum",
      color: "var(--color-accent-300)",
      tagline: "Is the market noticing yet?",
      body: "We blend price momentum across multiple horizons (3, 6, 12 months relative to the broader market) with earnings momentum at the latest quarter. The two together separate stocks moving on hype from stocks moving because the fundamentals are turning.",
      examples: ["3M, 6M, 12M relative returns", "Position vs 200-day EMA", "Latest-quarter sales YoY", "Latest-quarter profit YoY"],
      graphic: <MomentumLine />,
    },
  ];
  return (
    <section className="border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="text-center max-w-[680px] mx-auto mb-16">
          <div className="text-[11px] uppercase tracking-[0.22em] muted-text mb-3">
            How we score
          </div>
          <h2 className="font-display text-[40px] md:text-[52px] leading-[1.02] tracking-tight">
            Three pillars.{" "}
            <em className="not-italic" style={{ color: "var(--color-accent-600)" }}>
              One ranking.
            </em>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {pillars.map((p) => (
            <article
              key={p.name}
              className="card p-6 flex flex-col"
              style={{ borderTop: `3px solid ${p.color}` }}
            >
              <div className="h-[140px] flex items-center justify-center mb-5">
                {p.graphic}
              </div>
              <h3 className="font-display text-[24px] leading-tight" style={{ color: p.color }}>
                {p.name}
              </h3>
              <div className="text-[12.5px] muted-text mt-1 italic">{p.tagline}</div>
              <p
                className="mt-4 text-[14px] leading-[1.6] muted-text"
                dangerouslySetInnerHTML={{ __html: p.body }}
              />
              <ul className="mt-5 space-y-1.5 text-[12.5px] muted-text">
                {p.examples.map((e) => (
                  <li key={e} className="flex items-start gap-2">
                    <span style={{ color: p.color }} className="mt-[3px]">●</span>
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -- Pillar graphics ----------------------------------------------- */

function RoeBars() {
  // 8 years of RoE — gentle improvement, illustrating "does it compound"
  const data = [12, 13, 11, 14, 16, 17, 18, 21];
  const max = 25;
  return (
    <svg width="240" height="120" viewBox="0 0 240 120">
      {data.map((v, i) => {
        const w = 22, gap = 6;
        const x = i * (w + gap) + 4;
        const h = (v / max) * 90;
        const y = 100 - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={2}
            fill="var(--color-accent-600)"
            opacity={0.35 + (i / data.length) * 0.6}
          />
        );
      })}
      <line x1="0" y1="100" x2="232" y2="100" stroke="var(--color-border-default)" />
      <text x="0" y="115" fontSize="9" fill="var(--color-muted)">FY18</text>
      <text x="232" y="115" fontSize="9" fill="var(--color-muted)" textAnchor="end">FY26</text>
      <text x="116" y="20" fontSize="9" fill="var(--color-muted)" textAnchor="middle">
        Return on equity
      </text>
    </svg>
  );
}

function PeBars() {
  // Two horizontal bars: this stock vs peer median P/E
  return (
    <svg width="240" height="120" viewBox="0 0 240 120">
      <text x="0" y="20" fontSize="10" fill="var(--color-ink)">Peer median P/E</text>
      <rect x="0" y="28" width="160" height="14" rx="3" fill="var(--color-muted)" opacity="0.35" />
      <text x="166" y="40" fontSize="11" fill="var(--color-muted)" className="tabular-nums">28×</text>

      <text x="0" y="68" fontSize="10" fill="var(--color-ink)">This stock</text>
      <rect x="0" y="76" width="120" height="14" rx="3" fill="var(--color-accent-400)" />
      <text x="126" y="88" fontSize="11" fill="var(--color-accent-600)" className="tabular-nums">21×</text>

      <text x="0" y="112" fontSize="9" fill="var(--color-muted)">
        25% cheaper than the cluster median
      </text>
    </svg>
  );
}

function MomentumLine() {
  // Two lines: stock vs market over 12 months
  const market = [50, 52, 51, 53, 55, 54, 56, 58, 57, 59, 60, 58];
  const stock = [50, 53, 55, 58, 62, 64, 68, 72, 75, 78, 82, 85];
  const w = 240, h = 120, pad = 12;
  const max = 90, min = 45;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (market.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (h - 2 * pad - 12);
  const path = (data: number[]) =>
    data.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={path(market)} fill="none" stroke="var(--color-muted)" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d={path(stock)} fill="none" stroke="var(--color-accent-300)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(stock.length - 1)} cy={y(stock[stock.length - 1])} r="3" fill="var(--color-accent-500)" />
      <text x={pad} y={h - 4} fontSize="9" fill="var(--color-muted)">12 months ago</text>
      <text x={w - pad} y={h - 4} fontSize="9" fill="var(--color-muted)" textAnchor="end">today</text>
      <text x={pad + 6} y={pad + 8} fontSize="9" fill="var(--color-accent-600)">stock</text>
      <text x={pad + 50} y={pad + 8} fontSize="9" fill="var(--color-muted)">vs market</text>
    </svg>
  );
}

/* ------------------------------------------- Spider moment ----------- */

function SpiderMoment() {
  const rows = [
    { axis: "Profitability", value: 78 },
    { axis: "Growth",        value: 84 },
    { axis: "Cash & Balance Sheet", value: 62 },
    { axis: "Valuation",     value: 47 },
    { axis: "Momentum",      value: 91 },
  ].sort((a, b) => b.value - a.value);

  return (
    <section className="border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="mx-auto max-w-[1100px] px-6 py-24 md:py-28">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-12 md:gap-20 items-center">
          <div className="text-center md:text-left">
            <h2 className="font-display text-[40px] md:text-[56px] leading-[0.98] tracking-tight">
              Strengths.
              <br />
              <em className="not-italic" style={{ color: "var(--color-accent-600)" }}>
                And gaps.
              </em>
            </h2>
            <p className="mt-5 text-[15px] muted-text max-w-[400px] mx-auto md:mx-0">
              Five axes, sorted. The strongest dimensions rise to the top — without
              you having to read.
            </p>
          </div>

          <div className="space-y-3">
            {rows.map((r) => {
              const b = band(r.value);
              const fillColor = bandColor(b);
              const delta = r.value - 50;
              return (
                <div key={r.axis}>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-[13px]">{r.axis}</span>
                    <span
                      className="text-[13px] tabular-nums font-medium"
                      style={{ color: fillColor }}
                    >
                      {r.value}
                    </span>
                  </div>
                  <div className="relative h-3 rounded-full bg-[var(--color-card)] border hairline">
                    <div
                      className="absolute top-0 bottom-0 w-px bg-[var(--color-muted)]/40"
                      style={{ left: "50%" }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${r.value}%`,
                        backgroundColor: fillColor,
                        opacity: 0.92,
                      }}
                    />
                    {delta > 0 && (
                      <span
                        className="absolute top-1/2 -translate-y-1/2 text-[9px] muted-text"
                        style={{ left: "calc(50% + 2px)" }}
                      >
                        +{delta}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="pt-1 text-[10px] muted-text text-center">
              ↑ above peer median &nbsp; · &nbsp; ↓ below
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------- The MOAT (visual) ------- */

function MoatStrip() {
  return (
    <section className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
      <div className="text-center max-w-[680px] mx-auto mb-16">
        <div className="text-[11px] uppercase tracking-[0.22em] muted-text mb-3">
          What compounds
        </div>
        <h2 className="font-display text-[40px] md:text-[56px] leading-[1.02] tracking-tight">
          Built to{" "}
          <em className="not-italic" style={{ color: "var(--color-accent-600)" }}>
            compound.
          </em>
        </h2>
      </div>

      <div className="space-y-24">
        <MoatItem
          n="01"
          title="A score history that can't be backdated."
          graphic={<SparklineGraphic />}
          align="right"
        />
        <MoatItem
          n="02"
          title="Plain language. Not a wall of ratios."
          graphic={<NarrativeGraphic />}
          align="left"
        />
        <MoatItem
          n="03"
          title="What everyone's watching."
          graphic={<TrendingGraphic />}
          align="right"
        />
      </div>
    </section>
  );
}

function MoatItem({
  n, title, graphic, align,
}: { n: string; title: string; graphic: React.ReactNode; align: "left" | "right" }) {
  const order = align === "right" ? "md:order-1" : "md:order-2";
  const orderText = align === "right" ? "md:order-2" : "md:order-1";
  return (
    <article className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 items-center">
      <div className={`flex justify-center ${order}`}>
        {graphic}
      </div>
      <div className={`${orderText}`}>
        <div
          className="font-display text-[40px] tabular-nums leading-none mb-3"
          style={{ color: "var(--color-accent-300)" }}
        >
          {n}
        </div>
        <h3 className="font-display text-[28px] md:text-[36px] leading-[1.1] tracking-tight max-w-[420px]">
          {title}
        </h3>
      </div>
    </article>
  );
}

/* -- Moat graphics ------------------------------------------------- */

function SparklineGraphic() {
  // 12 weekly score points, gently rising — illustrates archive depth
  const pts = [42, 45, 43, 47, 51, 54, 53, 58, 62, 65, 71, 74];
  const w = 360, h = 180, pad = 16;
  const max = 100, min = 0;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (pts.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (h - 2 * pad);
  const path = pts.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const area = `${path} L ${x(pts.length - 1)} ${h - pad} L ${x(0)} ${h - pad} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="card p-0">
      <defs>
        <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent-400)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-accent-400)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* baseline */}
      <line
        x1={pad} y1={y(50)} x2={w - pad} y2={y(50)}
        stroke="var(--color-border-default)" strokeDasharray="3 3"
      />
      {/* area + line */}
      <path d={area} fill="url(#sparkfill)" />
      <path d={path} fill="none" stroke="var(--color-accent-500)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* dots at each weekly snapshot */}
      {pts.map((v, i) => (
        <circle
          key={i}
          cx={x(i)} cy={y(v)} r={i === pts.length - 1 ? 4 : 2.5}
          fill={i === pts.length - 1 ? "var(--color-accent-600)" : "var(--color-card)"}
          stroke="var(--color-accent-500)" strokeWidth="1.5"
        />
      ))}
      {/* labels */}
      <text x={pad} y={h - 4} fontSize="10" fill="var(--color-muted)">12 weeks ago</text>
      <text x={w - pad} y={h - 4} fontSize="10" fill="var(--color-muted)" textAnchor="end">today</text>
    </svg>
  );
}

function NarrativeGraphic() {
  return (
    <div className="card p-6 max-w-[420px]">
      <div className="text-[10px] uppercase tracking-wide muted-text mb-3">
        Why this score
      </div>
      <div className="space-y-3 text-[14px] leading-relaxed">
        <div className="flex gap-2">
          <span style={{ color: "var(--color-score-good)" }} className="font-medium">↑</span>
          <span>Returns on equity beat the cluster.</span>
        </div>
        <div className="flex gap-2">
          <span style={{ color: "var(--color-score-good)" }} className="font-medium">↑</span>
          <span>Operating margin has improved over five years.</span>
        </div>
        <div className="flex gap-2">
          <span style={{ color: "var(--color-score-poor)" }} className="font-medium">↓</span>
          <span>P/E is richer than peers.</span>
        </div>
      </div>
    </div>
  );
}

function TrendingGraphic() {
  // Stylized "trending in financials" list
  const items = [
    { sym: "NORTHARC", delta: "+12" },
    { sym: "MUTHOOTMF", delta: "+8" },
    { sym: "AFSL", delta: "+6" },
    { sym: "APTUS", delta: "+5" },
  ];
  return (
    <div className="card p-5 w-[300px]">
      <div className="text-[10px] uppercase tracking-wide muted-text mb-3">
        Trending in financials
      </div>
      <ul className="space-y-2.5">
        {items.map((it) => (
          <li key={it.sym} className="flex items-center justify-between text-[13px]">
            <span className="font-medium tabular-nums">{it.sym}</span>
            <span
              className="tabular-nums text-[12px]"
              style={{ color: "var(--color-score-good)" }}
            >
              {it.delta}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------- Footer CTA ------- */

function FooterCTA() {
  return (
    <section
      className="border-t hairline"
      style={{ backgroundColor: "var(--color-accent-50)" }}
    >
      <div className="mx-auto max-w-[1200px] px-6 py-24 text-center">
        <h2 className="font-display text-[40px] md:text-[56px] leading-[1.05] tracking-tight max-w-[680px] mx-auto">
          Start with the part of the market{" "}
          <em className="not-italic" style={{ color: "var(--color-accent-700)" }}>
            you care about.
          </em>
        </h2>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link
            href="/clusters"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[14px] font-medium text-white transition-transform hover:scale-[1.03]"
            style={{ backgroundColor: "var(--color-accent-600)" }}
          >
            Open the heat map
            <ArrowRight size={14} />
          </Link>
          <Link
            href="/screener"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[14px] border bg-white"
            style={{ borderColor: "var(--color-accent-300)" }}
          >
            Open Discover
          </Link>
        </div>
      </div>
    </section>
  );
}
