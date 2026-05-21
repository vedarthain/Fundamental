import Link from "next/link";
import { sql } from "@/lib/db";
import { ArrowRight } from "lucide-react";
import { band, bandColor } from "@/lib/score";
import { RevealOnScroll } from "@/components/RevealOnScroll";

export const revalidate = 1800;

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

type TrendingRow = {
  symbol: string;
  composite_pct: number;
  cluster_short: string;
};


async function loadHero() {
  const snapPromise = sql<Snapshot[]>`
    SELECT
      (SELECT COUNT(*)::int FROM app.universe WHERE is_active) AS stocks,
      (SELECT COUNT(*)::int FROM app.cluster WHERE id <> 'unclassified') AS clusters,
      (SELECT COUNT(*)::int FROM app.universe WHERE is_active AND maturity_tier='veteran') AS veterans,
      (SELECT COUNT(DISTINCT snapshot_date)::int FROM app.scores) AS weeks,
      (SELECT MAX(snapshot_date)::text FROM app.scores) AS snapshot_date
  `;
  // Industry tiles use app.cluster_composite, which scores each cluster by
  // its cluster-aggregate fundamentals (avg ROE, avg P/E, etc.) percent-
  // ranked across all clusters. We can't use AVG(scores.composite_pct) here
  // because that's a within-cluster percentile rank — its mean is always ~50
  // for every cluster by construction, so it can't distinguish strong from
  // weak industries.
  const tilesPromise = sql<IndustryTile[]>`
    SELECT cluster_id AS industry_id,
           industry_name,
           composite_aggr_pct::float AS avg_composite
    FROM app.cluster_composite
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.metrics_snapshot)
    ORDER BY composite_aggr_pct DESC NULLS LAST
  `;
  // Top + bottom marquee items — proxy for "trending" until we have a 2nd snapshot
  const trendingPromise = sql<TrendingRow[]>`
    (SELECT s.symbol, s.composite_pct, c.name AS cluster_short
     FROM app.scores s JOIN app.cluster c ON c.id = s.cluster_id
     WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
       AND s.maturity_tier = 'veteran'
     ORDER BY s.composite_pct DESC NULLS LAST LIMIT 8)
    UNION ALL
    (SELECT s.symbol, s.composite_pct, c.name AS cluster_short
     FROM app.scores s JOIN app.cluster c ON c.id = s.cluster_id
     WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
       AND s.maturity_tier = 'veteran' AND s.composite_pct < 30
     ORDER BY s.composite_pct ASC NULLS LAST LIMIT 4)
  `;
  const [snapRows, tiles] = await Promise.all([snapPromise, tilesPromise]);
  void trendingPromise; // marquee removed; data fetch retained for cheap revalidation tracking
  return { snap: snapRows[0], tiles };
}

export default async function Landing() {
  const { snap, tiles } = await loadHero();
  return (
    <>
      {/* Landing flow — re-sequenced based on user feedback ("too much
          writing"): hero with benefit pills first, then the visual heat
          map (most compelling proof), three pillars (how scoring works),
          per-industry cards (proof of nuance). The Moat / "Built to
          compound" section is dropped from the landing — it was a long
          philosophical block users were skipping. The same trust signals
          live on /about (Methodology page) for users who want depth. */}
      <Hero snap={snap} />
      <RevealOnScroll><HeatMapTear tiles={tiles} /></RevealOnScroll>
      <RevealOnScroll><ThreePillars /></RevealOnScroll>
      <RevealOnScroll><PerIndustryCards /></RevealOnScroll>
      <FooterCTA />
    </>
  );
}

/* =============================================================== PER-INDUSTRY === */

function PerIndustryCards() {
  const items = [
    {
      meta: "Banks",
      headline: "Capital, not capex.",
      body: "Return on assets, book-value compounding, capital cushion — what matters when revenue is interest income.",
      pills: [
        { k: "RoA", colour: "var(--color-accent-600)" },
        { k: "Book CAGR", colour: "var(--color-accent-500)" },
        { k: "Capital cushion", colour: "var(--color-accent-400)" },
      ],
    },
    {
      meta: "Cement",
      headline: "Tonnes, not P/E.",
      body: "EBITDA margin and capacity utilization say whether prices are firm and new plants are paying off. P/E for cement is noise.",
      pills: [
        { k: "EBITDA margin", colour: "var(--color-accent-600)" },
        { k: "Capacity", colour: "var(--color-accent-500)" },
        { k: "Capex intensity", colour: "var(--color-accent-400)" },
      ],
    },
    {
      meta: "IT Services",
      headline: "Margin, not breadth.",
      body: "Operating-margin trend and cash conversion separate compounders from deal-grabbers. Revenue growth alone is a trap.",
      pills: [
        { k: "Op margin trend", colour: "var(--color-accent-600)" },
        { k: "CFO/EBITDA", colour: "var(--color-accent-500)" },
        { k: "DSO", colour: "var(--color-accent-400)" },
      ],
    },
  ];
  return (
    <section className="border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="max-w-[1200px] mx-auto px-6 py-12 md:py-14">
        <div className="text-center max-w-[640px] mx-auto mb-10">
          <div className="eyebrow mb-3">Different sectors, different recipes</div>
          <h2 className="font-display" style={{ fontSize: "clamp(28px, 3.5vw, 42px)", lineHeight: 1.05 }}>
            One scorecard <em className="accent">per industry.</em>
          </h2>
          <p className="muted-text mt-3.5 text-[14.5px] leading-[1.55] max-w-[540px] mx-auto">
            We don&apos;t score a bank the way we score a paint company. Each sector has its own
            recipe — tuned for what an analyst in that space would actually look at.
          </p>
        </div>
        {/* 1 col on phones, 3 on desktop. Forced 3-col was squishing
            cards on mobile into unreadable slivers. */}
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          {items.map((it) => (
            <article
              key={it.meta}
              className="card p-5 flex flex-col"
              style={{ borderTop: "3px solid var(--color-accent-300)" }}
            >
              <div className="eyebrow">{it.meta}</div>
              <h3 className="font-display mt-2.5" style={{ fontSize: 22, lineHeight: 1.15 }}>
                {it.headline}
              </h3>
              <p className="muted-text mt-3 text-[13px] leading-[1.6] flex-1">{it.body}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {it.pills.map((p) => (
                  <span
                    key={p.k}
                    className="inline-flex items-center px-2 py-0.5 rounded-sm border hairline text-[11px]"
                    style={{ borderColor: p.colour, color: p.colour }}
                  >
                    {p.k}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =============================================================== HERO === */

function Hero({ snap }: { snap: Snapshot }) {
  return (
    <section className="grain relative overflow-hidden">
      <div className="relative max-w-[1200px] mx-auto px-6 pt-10 pb-8 md:pt-14 md:pb-12">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full border hairline mb-5 text-[11.5px] muted-text"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-livepulse"
            style={{ backgroundColor: "var(--color-score-excellent)" }}
          />
          Live · {snap.stocks.toLocaleString("en-IN")} NSE stocks · week {snap.weeks}
        </div>

        {/* H1 — benefit-forward. Old line was poetic ("where India's market
            really stands") but didn't tell visitors what they GET. New line
            is shorter, names the audience (Indian stocks) and the core
            differentiator (real peers). */}
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(34px, 5vw, 64px)",
            lineHeight: 1.02,
            letterSpacing: "-0.022em",
            maxWidth: 880,
            textWrap: "balance",
          }}
        >
          Indian stocks, scored against their{" "}
          <em className="accent">real peers</em>.
        </h1>

        <p className="muted-text mt-4 text-[15.5px] leading-[1.55] max-w-[560px]">
          Quality, Valuation, and Momentum percentiles within every peer sector —
          recomputed weekly, never edited. Stop comparing a small-cap bank to HDFC.
        </p>

        {/* What you can do — 3 concrete benefit pills. This is the section
            users were missing: previously the hero said WHAT we do, never
            what they could DO with it. Each pill links directly to the
            surface that delivers that benefit. */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-2 max-w-[760px]">
          <BenefitPill
            icon="🔍"
            label="Find compounders"
            sub="Quality + value, in sector"
            href="/ideas?bucket=compounder"
          />
          <BenefitPill
            icon="⚖️"
            label="Compare 2–5 stocks"
            sub="Apples-to-apples scorecards"
            href="/tools/peer-comparison"
          />
          <BenefitPill
            icon="📈"
            label="See weekly movers"
            sub="What's strengthening / slipping"
            href="/feed"
          />
        </div>

        <div className="mt-7 flex gap-3 items-center flex-wrap">
          <Link href="/sectors" className="btn-primary">
            Browse all sectors
            <ArrowRight size={14} />
          </Link>
          <Link href="/tools/screener" className="btn-ghost">
            Discover by filter
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Benefit pill — quick visual link from the hero to a specific surface that
 *  delivers that benefit. Solves the "what does this give me?" question
 *  users were asking after only seeing the prose. */
function BenefitPill({ icon, label, sub, href }: { icon: string; label: string; sub: string; href: string }) {
  return (
    <Link
      href={href}
      className="card px-3.5 py-2.5 flex items-center gap-3 hover:border-[var(--color-accent-400)] transition-colors group"
    >
      <span className="text-[20px] leading-none">{icon}</span>
      <span className="flex flex-col">
        <span className="font-medium text-[13.5px]" style={{ color: "var(--color-ink)" }}>
          {label}
        </span>
        <span className="text-[11px] muted-text">{sub}</span>
      </span>
      <ArrowRight size={12} className="ml-auto shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: "var(--color-accent-600)" }} />
    </Link>
  );
}

/**
 * @deprecated HeroMosaic + MobileHeroStats were removed from the landing
 * hero entirely (user feedback: floating cards felt cluttered, distracted
 * from the benefit-pill flow). Function bodies kept below as dead code in
 * case we want to revive a scaled-down version later; safe to delete.
 */
function _UnusedHeroMosaic() {
  return (
    <div className="mt-10 relative h-[280px] hidden md:block">
      {/* Composite score — the centerpiece, slightly rotated, deeper shadow */}
      <div
        className="card absolute right-[6%] bottom-[10px] w-[220px] p-5"
        style={{
          transform: "rotate(-2deg)",
          boxShadow: "0 1px 0 rgba(255,255,255,.7) inset, 0 22px 48px -10px rgba(25,25,25,0.20)",
        }}
      >
        <div className="eyebrow">Industry Score</div>
        <div
          className="font-display tabular-nums mt-1"
          style={{
            fontSize: 76,
            lineHeight: 0.9,
            color: "var(--color-score-excellent)",
            letterSpacing: "-0.04em",
          }}
        >
          82
        </div>
        <div className="muted-text text-[13px] mt-3">
          Top <span className="font-semibold" style={{ color: "var(--color-ink)" }}>18%</span> in its peer cluster
        </div>
        <svg viewBox="0 0 220 40" className="w-full mt-4 block">
          <path
            d="M0,30 L20,28 L40,26 L60,29 L80,24 L100,22 L120,18 L140,16 L160,14 L180,12 L200,10 L220,8"
            fill="none"
            stroke="var(--color-score-excellent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="500"
            strokeDashoffset="500"
            style={{ animation: "drawline 1.6s ease forwards .6s" }}
          />
          <circle
            cx="220" cy="8" r="3.5"
            fill="var(--color-score-excellent)"
            opacity="0"
            style={{ animation: "fadein .3s ease forwards 1.8s" }}
          />
        </svg>
        <div className="muted-text text-[11px] mt-2 flex justify-between">
          <span>12 weeks ago · 71</span>
          <span className="font-semibold" style={{ color: "var(--color-score-excellent)" }}>+11 ▲</span>
        </div>
      </div>

      {/* Strengths & gaps — left side, slight counter-rotation, lighter shadow */}
      <div
        className="card absolute left-[4%] top-[10px] w-[280px] p-5"
        style={{
          transform: "rotate(-1.5deg)",
          boxShadow: "0 1px 0 rgba(255,255,255,.7) inset, 0 14px 34px -10px rgba(25,25,25,0.12)",
        }}
      >
        <div className="mb-3.5">
          <div className="eyebrow">Strengths &amp; gaps</div>
          <div className="muted-text text-[11px] mt-1">5 axes vs cluster median</div>
        </div>
        {[
          ["Momentum",     91, "var(--color-score-excellent)", 0],
          ["Growth",       84, "var(--color-score-good)",      0.15],
          ["Profitability",78, "var(--color-score-good)",      0.3],
          ["Cash & BS",    62, "var(--color-score-neutral)",   0.45],
          ["Valuation",    47, "var(--color-score-weak)",      0.6],
        ].map(([label, value, color, delay]) => (
          <div
            key={label as string}
            className="grid items-center gap-2.5 text-[12px] mb-2.5"
            style={{ gridTemplateColumns: "100px 1fr 28px" }}
          >
            <span className="muted-text">{label as string}</span>
            <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-paper)" }}>
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${value}%`,
                  background: color as string,
                  transformOrigin: "left",
                  animation: `growbar 1.4s cubic-bezier(.4,.7,.3,1) ${delay}s both`,
                }}
              />
            </div>
            <span className="tabular-nums font-semibold text-right" style={{ color: color as string }}>
              {value as number}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================ MARQUEE === */

function TickerMarquee({ items }: { items: TrendingRow[] }) {
  if (!items.length) return null;
  // Two copies for seamless loop
  const repeated = [...items, ...items];

  return (
    <section
      className="border-y hairline overflow-hidden"
      style={{ backgroundColor: "var(--color-card)" }}
    >
      <div className="flex items-center h-14 gap-6 px-6">
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="w-2 h-2 rounded-full animate-livepulse"
            style={{ backgroundColor: "var(--color-score-excellent)" }}
          />
          <span className="eyebrow" style={{ color: "var(--color-ink)" }}>Top of cluster</span>
        </div>
        <div
          className="flex-1 overflow-hidden"
          style={{
            maskImage: "linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%)",
          }}
        >
          <div
            className="flex w-max font-mono text-[13px] gap-9 animate-marquee"
            style={{ animation: "marquee 60s linear infinite" }}
          >
            {repeated.map((it, i) => {
              const colour =
                it.composite_pct >= 80 ? "var(--color-score-excellent)" :
                it.composite_pct >= 60 ? "var(--color-score-good)" :
                it.composite_pct >= 40 ? "var(--color-score-neutral)" :
                                          "var(--color-score-poor)";
              const symbol = (
                <Link href={`/stock/${it.symbol}`} className="hover:underline">
                  <strong>{it.symbol}</strong>
                </Link>
              );
              return (
                <span key={`${it.symbol}-${i}`} className="whitespace-nowrap">
                  {symbol}{" "}
                  <span style={{ color: colour }}>● {Math.round(it.composite_pct)}</span>{" "}
                  <span className="muted-text">→ {it.cluster_short}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ====================================================== POLAROID BANNER === */

function PolaroidBanner({ snap }: { snap: Snapshot }) {
  return (
    <section className="border-b hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="max-w-[1100px] mx-auto px-6 py-8 md:py-10 flex justify-center">
        <div
          className="relative inline-block px-8 py-7 swing-banner"
          style={{
            backgroundColor: "var(--color-card)",
            border: "1px solid var(--color-border-default)",
            boxShadow:
              "0 22px 40px -20px rgba(25,25,25,0.28), 0 6px 14px -8px rgba(25,25,25,0.18)",
          }}
        >
          {/* Pushpin head */}
          <div
            aria-hidden
            className="absolute"
            style={{
              top: -14,
              left: "50%",
              transform: "translateX(-50%)",
              width: 24,
              height: 24,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 35% 30%, #d97757 0%, #b04a2c 55%, #7a2f18 100%)",
              boxShadow:
                "0 4px 8px rgba(0,0,0,0.28), inset -2px -3px 4px rgba(0,0,0,0.35), inset 2px 2px 3px rgba(255,255,255,0.35)",
              zIndex: 2,
            }}
          />
          {/* Pushpin shaft */}
          <div
            aria-hidden
            className="absolute"
            style={{
              top: 6,
              left: "50%",
              transform: "translateX(-50%)",
              width: 2,
              height: 8,
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.05))",
              zIndex: 1,
            }}
          />
          <div className="flex gap-9 items-baseline">
            <BannerStat value={snap.stocks.toLocaleString("en-IN")} label="stocks" />
            <Divider />
            <BannerStat value={String(snap.clusters)} label="clusters" />
            <Divider />
            <BannerStat value={String(snap.weeks)} label={snap.weeks === 1 ? "weekly snapshot" : "weekly snapshots"} />
          </div>
        </div>
      </div>
    </section>
  );
}

function BannerStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="font-display tabular-nums" style={{ fontSize: 48, lineHeight: 1, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      <div className="eyebrow mt-2" style={{ fontSize: 10 }}>{label}</div>
    </div>
  );
}

function Divider() {
  return <div className="self-stretch w-px" style={{ backgroundColor: "var(--color-border-default)" }} />;
}

/* ====================================================== HEAT-MAP TEAR === */

function HeatMapTear({ tiles }: { tiles: IndustryTile[] }) {
  // Show top 15 tiles (sorted by avg composite desc); rest fades vertically below
  const SHOW = 15;
  const visible = tiles.slice(0, SHOW);
  return (
    <section style={{ backgroundColor: "var(--color-paper)", position: "relative", overflow: "hidden" }}>
      <div className="max-w-[1200px] mx-auto px-6 py-12 md:py-14">
        <div className="grid gap-10 items-center" style={{ gridTemplateColumns: "1.15fr 0.85fr" }}>
          {/* LEFT: writing */}
          <div>
            <div className="eyebrow mb-3">The map</div>
            <h2
              className="font-display"
              style={{ fontSize: "clamp(28px, 3.5vw, 42px)", lineHeight: 1.05, letterSpacing: "-0.022em" }}
            >
              The whole market,<br />
              <em className="accent">torn open.</em>
            </h2>
            <p className="muted-text mt-4 text-[14.5px] leading-[1.6] max-w-[420px]">
              Forty-one peer sectors — every one scored and ranked, every week. Greens compound.
              Reds need a closer look. Open the map to see the rest.
            </p>
            <div className="mt-6 flex items-center gap-3 flex-wrap">
              <Link href="/sectors" className="btn-primary">
                Open all sectors
                <ArrowRight size={14} />
              </Link>
              <span className="muted-text text-[13px]">
                <span className="tabular-nums font-semibold" style={{ color: "var(--color-ink)" }}>
                  +{Math.max(0, tiles.length - SHOW)} sectors
                </span>{" "}
                behind the tear
              </span>
            </div>
            <div className="muted-text mt-5 text-[11px] flex items-center gap-2.5">
              <span>weak</span>
              <span
                style={{
                  width: 110,
                  height: 8,
                  borderRadius: 2,
                  background:
                    "linear-gradient(90deg, var(--color-score-poor), var(--color-score-weak), var(--color-score-neutral), var(--color-score-good), var(--color-score-excellent))",
                }}
              />
              <span>strong</span>
            </div>
          </div>

          {/* RIGHT: top tiles with vertical fade mask — half-screen wide */}
          <div className="relative w-full max-w-[360px] ml-auto">
            <div
              className="relative"
              style={{
                WebkitMaskImage:
                  "linear-gradient(180deg, #000 0%, #000 60%, rgba(0,0,0,.45) 80%, transparent 100%)",
                maskImage:
                  "linear-gradient(180deg, #000 0%, #000 60%, rgba(0,0,0,.45) 80%, transparent 100%)",
              }}
            >
              <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                {visible.map((t, i) => {
                  const v = t.avg_composite ?? 0;
                  const bg = bandColor(band(v));
                  const numColor = v >= 50 && v < 65 ? "var(--color-ink)" : "#fff";
                  return (
                    <Link
                      key={t.industry_id}
                      href={`/industry/${t.industry_id}`}
                      className="heat-tile heat-tile-drop rounded-[5px] flex flex-col items-center justify-center p-1"
                      title={`${t.industry_name} · ${Math.round(v)}`}
                      style={{
                        aspectRatio: "1 / 1",
                        background: bg,
                        boxShadow: "0 1px 3px rgba(25,25,25,.08)",
                        animationDelay: `${i * 0.07}s`,
                      }}
                    >
                      <span
                        className="font-display tabular-nums leading-none font-medium"
                        style={{ color: numColor, fontSize: 16 }}
                      >
                        {Math.round(v)}
                      </span>
                      <span
                        className="leading-tight tracking-wide font-medium text-center mt-0.5"
                        style={{ color: numColor, opacity: 0.86, fontSize: 8 }}
                      >
                        {t.industry_name}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Floating "+N more" CTA — sits over the bottom fade */}
            <Link
              href="/sectors"
              className="absolute z-10 inline-flex items-center gap-2 card animate-tearwobble"
              style={{
                left: "50%",
                bottom: -10,
                transform: "translateX(-50%)",
                padding: "7px 12px 7px 10px",
                borderRadius: 999,
                fontSize: 12,
                boxShadow: "0 10px 24px -6px rgba(25,25,25,0.24)",
              }}
            >
              <span className="inline-flex gap-px">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--color-score-good)" }} />
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--color-score-neutral)" }} />
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--color-score-weak)" }} />
              </span>
              <span className="tabular-nums font-semibold">
                +{Math.max(0, tiles.length - SHOW)} more
              </span>
              <ArrowRight size={11} style={{ color: "var(--color-accent-600)" }} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ====================================================== THREE PILLARS === */

function ThreePillars() {
  return (
    <section className="border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="max-w-[1200px] mx-auto px-6 py-12 md:py-14">
        <div className="text-center max-w-[640px] mx-auto mb-10">
          <div className="eyebrow mb-3">How we score</div>
          <h2 className="font-display" style={{ fontSize: "clamp(28px, 3.5vw, 42px)", lineHeight: 1.05 }}>
            Three pillars. <em className="accent">One ranking.</em>
          </h2>
          <p className="muted-text mt-3.5 text-[14.5px] leading-[1.55] max-w-[540px] mx-auto">
            The way an analyst would actually think about a business — not a dump of every ratio in the book.
          </p>
        </div>

        {/* 1 col on phones, 3 on desktop — pillars stack on narrow screens. */}
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          <PillarCard
            n="01"
            color="var(--color-accent-600)"
            name="Quality"
            tagline="Does this business compound?"
            body="Returns on capital, multi-year growth, cash conversion, balance-sheet discipline — built to spot durable economics over a single good year."
            graphic={<RoeGraphic />}
          />
          <PillarCard
            n="02"
            color="var(--color-score-excellent)"
            name="Valuation"
            tagline="Are we paying a fair price?"
            body="P/E, P/B, EV/EBITDA, FCF, dividend yield — always relative to peers in the same sector. A 25× P/E in pharma means nothing like a 25× P/E in cement."
            graphic={<PeGraphic />}
          />
          <PillarCard
            n="03"
            color="var(--color-score-weak)"
            name="Momentum"
            tagline="Is the market noticing yet?"
            body="3, 6, 12-month relative price returns blended with latest-quarter earnings momentum — separates hype from fundamentals turning."
            graphic={<MomentumGraphic />}
          />
        </div>
      </div>
    </section>
  );
}

function PillarCard({ n, color, name, tagline, body, graphic }: {
  n: string; color: string; name: string; tagline: string; body: string; graphic: React.ReactNode;
}) {
  return (
    <article
      className="card flex flex-col p-5"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="h-[110px] flex items-center justify-center mb-3">{graphic}</div>
      <div className="ntag" style={{ fontSize: 28 }}>{n}</div>
      <h3 className="font-display mt-1.5" style={{ fontSize: 21, color }}>{name}</h3>
      <div className="muted-text italic text-[12.5px] mt-1">{tagline}</div>
      <p className="muted-text mt-3 text-[13px] leading-[1.55]">{body}</p>
    </article>
  );
}

function RoeGraphic() {
  return (
    <svg width="240" height="120" viewBox="0 0 240 120">
      <text x="120" y="14" fontSize="9" fill="var(--color-muted)" textAnchor="middle" fontFamily="Inter">Return on equity · 8y</text>
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

function PeGraphic() {
  return (
    <svg width="240" height="120" viewBox="0 0 240 120">
      <text x="0" y="20" fontSize="10" fill="var(--color-ink)" fontFamily="Inter">Peer median P/E</text>
      <rect x="0" y="28" width="160" height="14" rx="3" fill="var(--color-muted)" opacity="0.30" className="svg-hbar" style={{ animationDelay: "0.1s" }} />
      <text x="166" y="40" fontSize="11" fill="var(--color-muted)" fontFamily="JetBrains Mono">28×</text>
      <text x="0" y="68" fontSize="10" fill="var(--color-ink)" fontFamily="Inter">This stock</text>
      <rect x="0" y="76" width="120" height="14" rx="3" fill="var(--color-score-excellent)" className="svg-hbar" style={{ animationDelay: "0.55s" }} />
      <text x="126" y="88" fontSize="11" fill="var(--color-score-excellent)" fontFamily="JetBrains Mono">21×</text>
      <text x="0" y="112" fontSize="9" fill="var(--color-muted)" fontFamily="Inter">25% cheaper than the sector median</text>
    </svg>
  );
}

function MomentumGraphic() {
  return (
    <svg width="240" height="120" viewBox="0 0 240 120">
      <path d="M12,80 L32,76 L52,78 L72,72 L92,68 L112,72 L132,66 L152,60 L172,64 L192,58 L212,56 L228,62"
        fill="none" stroke="var(--color-muted)" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M12,80 L32,72 L52,66 L72,58 L92,48 L112,42 L132,32 L152,24 L172,20 L192,14 L212,10 L228,8"
        fill="none" stroke="var(--color-score-weak)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
        className="svg-line-slow" style={{ animationDelay: "0.3s" }} />
      <circle cx="228" cy="8" r="3.5" fill="var(--color-score-poor)" className="svg-dot" style={{ animationDelay: "2.5s" }} />
      <text x="12" y="116" fontSize="9" fill="var(--color-muted)" fontFamily="Inter">12 months ago</text>
      <text x="228" y="116" fontSize="9" fill="var(--color-muted)" fontFamily="Inter" textAnchor="end">today</text>
    </svg>
  );
}

/* ================================================== STRENGTHS & GAPS === */

function StrengthsAndGaps() {
  const rows = [
    { name: "Momentum",     v: 91, c: "var(--color-score-excellent)" },
    { name: "Growth",       v: 84, c: "var(--color-score-good)" },
    { name: "Profitability", v: 78, c: "var(--color-score-good)" },
    { name: "Cash & Balance Sheet", v: 62, c: "var(--color-score-neutral)" },
    { name: "Valuation",    v: 47, c: "var(--color-score-weak)" },
  ];
  return (
    <section className="border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="max-w-[1100px] mx-auto px-6 py-12 md:py-14">
        <div className="grid gap-12 items-center" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <div className="eyebrow mb-3">The single page that matters</div>
            <h2 className="font-display" style={{ fontSize: "clamp(28px, 3.6vw, 44px)", lineHeight: 1.0 }}>
              Strengths.<br />
              <em className="accent">And gaps.</em>
            </h2>
            <p className="muted-text mt-4 text-[14.5px] leading-[1.6] max-w-[340px]">
              Five axes, sorted. The strongest dimensions rise to the top — without you having to
              read a footnote.
            </p>
          </div>
          <div className="flex flex-col gap-2.5 max-w-[360px]">
            {rows.map((r, i) => (
              <div key={r.name}>
                <div className="flex justify-between mb-1">
                  <span className="text-[11.5px]">{r.name}</span>
                  <span className="tabular-nums font-semibold text-[11.5px]" style={{ color: r.c }}>{r.v}</span>
                </div>
                <div
                  className="relative h-2 rounded-full border hairline"
                  style={{ backgroundColor: "var(--color-card)" }}
                >
                  <div
                    className="absolute top-0 bottom-0 w-px"
                    style={{ left: "50%", background: "rgba(90,88,79,.4)" }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded-full svg-hbar"
                    style={{
                      width: `${r.v}%`,
                      background: r.c,
                      opacity: 0.92,
                      animationDelay: `${i * 0.12}s`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================================================== BUILT TO COMPOUND === */

function BuiltToCompound({ snap }: { snap: Snapshot }) {
  return (
    <section style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="max-w-[1200px] mx-auto px-6 py-12 md:py-14">
        <div className="text-center max-w-[640px] mx-auto mb-12">
          <div className="eyebrow mb-3">What compounds</div>
          <h2 className="font-display" style={{ fontSize: "clamp(28px, 3.5vw, 44px)", lineHeight: 1.05 }}>
            Built to <em className="accent">compound.</em>
          </h2>
          <p className="muted-text mt-3 text-[14.5px] leading-[1.55] max-w-[540px] mx-auto">
            Anyone can ship a stock screener in a weekend. None of these three can be cloned in a sprint.
          </p>
        </div>

        <div className="flex flex-col gap-10 mt-8">
          <MoatHistory weeks={snap.weeks} />
          <MoatNarrative />
          <MoatCommunity />
        </div>
      </div>
    </section>
  );
}

function MoatHistory({ weeks }: { weeks: number }) {
  return (
    <article className="grid gap-10 items-center" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <div className="card p-6">
        <div className="flex justify-between items-baseline mb-2.5">
          <span className="eyebrow">Score history · ledger</span>
          <span className="muted-text text-[11px] tabular-nums">{weeks} weekly snapshot{weeks === 1 ? "" : "s"}</span>
        </div>
        <svg viewBox="0 0 360 180" className="w-full">
          <defs>
            <linearGradient id="hg" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent-400)" stopOpacity=".22" />
              <stop offset="100%" stopColor="var(--color-accent-400)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="16" y1="100" x2="344" y2="100" stroke="var(--color-border-default)" strokeDasharray="3 3" />
          <path
            d="M16,140 L46,134 L76,138 L106,128 L136,118 L166,124 L196,110 L226,98 L256,84 L286,72 L316,62 L344,52 L344,164 L16,164 Z"
            fill="url(#hg)"
            className="svg-fill-in"
          />
          <path
            d="M16,140 L46,134 L76,138 L106,128 L136,118 L166,124 L196,110 L226,98 L256,84 L286,72 L316,62 L344,52"
            fill="none"
            stroke="var(--color-accent-500)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            className="svg-line-slow"
          />
          <circle cx="344" cy="52" r="4.5" fill="var(--color-accent-600)" className="svg-dot" style={{ animationDelay: "2.4s" }} />
          <text x="16" y="176" fontSize="10" fill="var(--color-muted)" fontFamily="Inter">Week 1</text>
          <text x="344" y="176" fontSize="10" fill="var(--color-muted)" fontFamily="Inter" textAnchor="end">today</text>
        </svg>
        <div
          className="mt-3.5 pt-3.5 border-t hairline grid gap-3"
          style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
        >
          <div>
            <div className="eyebrow" style={{ fontSize: 9 }}>First</div>
            <div className="font-display tabular-nums mt-0.5" style={{ fontSize: 18 }}>—</div>
          </div>
          <div>
            <div className="eyebrow" style={{ fontSize: 9 }}>Today</div>
            <div className="font-display tabular-nums mt-0.5" style={{ fontSize: 18, color: "var(--color-score-excellent)" }}>
              today
            </div>
          </div>
          <div>
            <div className="eyebrow" style={{ fontSize: 9 }}>Edits</div>
            <div className="font-display tabular-nums mt-0.5" style={{ fontSize: 18 }}>0</div>
          </div>
        </div>
      </div>
      <div>
        <div className="ntag" style={{ fontSize: 28 }}>01</div>
        <h3 className="font-display mt-2" style={{ fontSize: "clamp(22px, 2.4vw, 30px)", lineHeight: 1.1, maxWidth: 420 }}>
          A score history that <em className="accent">can&apos;t be backdated.</em>
        </h3>
        <p className="muted-text mt-4 text-[16px] leading-[1.6]" style={{ maxWidth: 460 }}>
          Every Monday at 09:30 IST we freeze the score for every covered name and write it to an
          append-only ledger. We don&apos;t edit history — if we were wrong, you can see we were
          wrong. A competitor launching tomorrow can backfill price data, but they cannot backfill
          our judgment from week one.
        </p>
      </div>
    </article>
  );
}

function MoatNarrative() {
  return (
    <article className="grid gap-10 items-center" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <div className="flex justify-center order-1">
        <div
          className="card relative p-7 max-w-[460px] swing-narrative"
          style={{
            boxShadow:
              "0 26px 50px -22px rgba(25,25,25,0.28), 0 8px 18px -10px rgba(25,25,25,0.18)",
          }}
        >
          {/* Pushpin */}
          <div
            aria-hidden
            className="absolute"
            style={{
              top: -14,
              left: "50%",
              transform: "translateX(-50%)",
              width: 26,
              height: 26,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 35% 30%, #d97757 0%, #b04a2c 55%, #7a2f18 100%)",
              boxShadow:
                "0 4px 8px rgba(0,0,0,0.28), inset -2px -3px 4px rgba(0,0,0,0.35), inset 2px 2px 3px rgba(255,255,255,0.35)",
              zIndex: 2,
            }}
          />
          <div
            aria-hidden
            className="absolute"
            style={{
              top: 6,
              left: "50%",
              transform: "translateX(-50%)",
              width: 2,
              height: 10,
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.05))",
              zIndex: 1,
            }}
          />
          <div className="eyebrow mb-4">Why this score · INFY</div>
          <div className="flex flex-col gap-3.5 text-[15px] leading-[1.55]">
            {[
              ["↑", "Returns on equity beat the cluster.", "var(--color-score-good)"],
              ["↑", "Operating margin has improved over five years.", "var(--color-score-good)"],
              ["↑", "Net cash; balance sheet is in the 99th percentile.", "var(--color-score-good)"],
              ["↓", "P/E is richer than peers.", "var(--color-score-poor)"],
              ["↓", "Revenue growth trails cluster median by ~160 bps.", "var(--color-score-weak)"],
            ].map(([arrow, text, c], i) => (
              <div key={i} className="flex gap-2.5">
                <span className="font-semibold" style={{ color: c }}>{arrow}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="order-2">
        <div className="ntag" style={{ fontSize: 28 }}>02</div>
        <h3 className="font-display mt-2" style={{ fontSize: "clamp(22px, 2.4vw, 30px)", lineHeight: 1.1, maxWidth: 420 }}>
          Plain language. <em className="accent">Not a wall of ratios.</em>
        </h3>
        <p className="muted-text mt-4 text-[16px] leading-[1.6]" style={{ maxWidth: 460 }}>
          Every score ships with a paragraph that explains what changed and why it matters. The
          model behind it gets tuned on analyst corrections and reader feedback — patient input
          a generic prompt cannot replicate.
        </p>
      </div>
    </article>
  );
}

function MoatCommunity() {
  return (
    <article className="grid gap-10 items-center" style={{ gridTemplateColumns: "1fr 1fr" }}>
      {/* Corkboard with hanging trending-list card */}
      <div
        className="relative flex justify-center"
        style={{
          padding: "28px 24px 32px",
          borderRadius: 14,
          background: `
            radial-gradient(ellipse at 30% 20%, #efe3d0 0%, transparent 55%),
            radial-gradient(ellipse at 70% 80%, #d8c6a8 0%, transparent 50%),
            repeating-radial-gradient(circle at 50% 50%, #e4d5b8 0px, #e4d5b8 1px, #d4c19e 1.5px, #e4d5b8 2.5px),
            #e4d5b8`,
          boxShadow:
            "inset 0 0 24px rgba(120,90,50,0.18), inset 0 0 6px rgba(255,255,255,0.25)",
        }}
      >
        <svg
          aria-hidden
          viewBox="0 0 200 60"
          preserveAspectRatio="none"
          className="absolute pointer-events-none"
          style={{ top: 4, left: "50%", transform: "translateX(-50%)", width: "70%", height: 38 }}
        >
          <path
            d="M 4,4 Q 100,46 196,4"
            fill="none"
            stroke="#7a5a38"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.6"
          />
        </svg>
        <div
          className="card relative max-w-[320px] mt-3.5 p-[18px] px-5 swing-trending"
          style={{
            boxShadow:
              "0 22px 38px -18px rgba(0,0,0,0.45), 0 6px 14px -8px rgba(0,0,0,0.3)",
          }}
        >
          <div
            aria-hidden
            className="absolute"
            style={{
              top: -12,
              left: "50%",
              transform: "translateX(-50%)",
              width: 22,
              height: 22,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 35% 30%, #d97757 0%, #b04a2c 55%, #7a2f18 100%)",
              boxShadow:
                "0 4px 7px rgba(0,0,0,0.4), inset -2px -3px 4px rgba(0,0,0,0.35), inset 2px 2px 3px rgba(255,255,255,0.4)",
              zIndex: 2,
            }}
          />
          <div className="flex justify-between items-center mb-2.5">
            <span className="eyebrow" style={{ fontSize: 9.5 }}>Trending in financials</span>
            <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--color-score-excellent)" }}>
              <span
                className="w-[5px] h-[5px] rounded-full animate-livepulse"
                style={{ backgroundColor: "var(--color-score-excellent)" }}
              />
              live
            </span>
          </div>
          <div className="flex flex-col">
            {[
              ["NORTHARC", "71 → 83", "+12", "var(--color-score-excellent)"],
              ["MUTHOOTMF", "68 → 76", "+8", "var(--color-score-excellent)"],
              ["AFSL", "62 → 68", "+6", "var(--color-score-good)"],
              ["APTUS", "71 → 76", "+5", "var(--color-score-good)"],
            ].map(([sym, range, delta, c], i, arr) => (
              <div
                key={sym}
                className="grid items-center text-[12.5px] py-1.5"
                style={{
                  gridTemplateColumns: "1fr 56px 28px",
                  borderBottom: i < arr.length - 1 ? "1px solid var(--color-border-default)" : "none",
                }}
              >
                <span className="font-semibold">{sym}</span>
                <span className="tabular-nums muted-text" style={{ fontSize: 11.5 }}>{range}</span>
                <span className="tabular-nums text-right font-semibold" style={{ color: c }}>{delta}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 pt-2.5 border-t hairline font-mono text-[10px] muted-text">
            2.1M anonymous signals · this week
          </div>
        </div>
      </div>
      <div>
        <div className="ntag" style={{ fontSize: 28 }}>03</div>
        <h3 className="font-display mt-2" style={{ fontSize: "clamp(22px, 2.4vw, 30px)", lineHeight: 1.1, maxWidth: 420 }}>
          What everyone&apos;s <em className="accent">watching.</em>
        </h3>
        <p className="muted-text mt-4 text-[16px] leading-[1.6]" style={{ maxWidth: 460 }}>
          Watchlists, screens, and reads — anonymized into a demand-side dataset that&apos;s
          uniquely ours. We feed it back into scoring and surface what&apos;s moving. We don&apos;t
          sell it. Every visit makes the next score a little better.
        </p>
      </div>
    </article>
  );
}

/* ============================================================== CTA === */

function FooterCTA() {
  return (
    <section
      className="border-t hairline"
      style={{ backgroundColor: "var(--color-accent-50)" }}
    >
      <div className="max-w-[1200px] mx-auto px-6 py-10 md:py-12 text-center">
        <h2
          className="font-display mx-auto"
          style={{
            fontSize: "clamp(44px, 6vw, 68px)",
            lineHeight: 1.04,
            maxWidth: 760,
            textWrap: "balance",
          }}
        >
          Start with the part of the market{" "}
          <em className="accent" style={{ color: "var(--color-accent-700)" }}>
            you care about.
          </em>
        </h2>
        <div className="mt-9 flex gap-3 justify-center flex-wrap">
          <Link href="/sectors" className="btn-primary">
            Open all sectors
            <ArrowRight size={14} />
          </Link>
          <Link href="/tools/screener" className="btn-ghost">
            Open Discover
          </Link>
        </div>
      </div>
    </section>
  );
}
