import Link from "next/link";

export const revalidate = 86400;

/** Public methodology page. Intentionally high-level — describes the framework
 * (pillars, tiers, peer-relative ranking) without enumerating per-cluster
 * scorecards or component weights, which are our research IP.
 */
export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[820px] px-6 py-12">
      <header>
        <div className="text-[12px] uppercase tracking-wide muted-text">Methodology</div>
        <h1 className="font-display text-[42px] tracking-tight leading-tight mt-1">
          How we score Indian equities
        </h1>
        <p className="mt-4 text-[16px] leading-relaxed muted-text">
          Every actively-traded NSE stock is scored on three pillars — Quality,
          Valuation, Momentum — within its <em>peer cluster</em> at its{" "}
          <em>maturity tier</em>. The result is a 0&ndash;100 percentile that means the
          same thing everywhere: top of its bucket, mid-pack, or bottom.
        </p>
      </header>

      <Section title="The two scores you see">
        <Block label="Composite">
          The platform&apos;s default ranking. We percentile every stock against its peer
          group on three pillars, then blend the pillars using <em>cluster-tuned
          weights</em> chosen by what an analyst in that industry would actually look at.
          The blend is then re-percentiled within the bucket so the result is itself a
          ranking.
        </Block>
        <Block label="Custom Score">
          The same pillar percentiles, blended using <em>your</em> chosen weights from
          the Discover sliders. Lets you stress-test how rankings shift under a value
          tilt, growth tilt, or any custom mix.
        </Block>
      </Section>

      <Section title="The three pillars">
        <Block label="Quality">
          Long-term operational durability. Returns on capital, growth and growth
          consistency, cash conversion, balance-sheet discipline, and margin trends.
          The specific metrics differ by cluster — banks score differently from
          consumer companies — but the question is the same: <em>does this business
          compound?</em>
        </Block>
        <Block label="Valuation">
          Price vs fundamentals, relative to peers in the same cluster. Common inputs
          include earnings, book value, EBITDA, free cash flow, and dividend yield —
          weighted differently per cluster. Loss-makers fall back to revenue-based
          valuations or book value.
        </Block>
        <Block label="Momentum">
          Both price action (multi-horizon returns relative to the broader market,
          trend strength) and earnings momentum (latest-quarter year-over-year growth).
        </Block>
      </Section>

      <Section title="Maturity tiers — apples-to-apples comparison">
        <p className="text-[14px] leading-relaxed muted-text mb-4">
          A 1-year-old IPO can&apos;t be scored on a 5-year CAGR. We bucket stocks by
          available history so the comparison is fair within each tier:
        </p>
        <Block label="Long-term Compounder">≥10 years of fundamentals. Scored on the richest set of long-window metrics, including consistency over a decade.</Block>
        <Block label="Established">7–9 years of fundamentals. The base scorecard with full 5-year trends.</Block>
        <Block label="Emerging">3–6 years. Shorter-window metrics; momentum weighted slightly higher.</Block>
        <Block label="New Listing">1–2 years AND listed within the last 24 months. Latest-year metrics + momentum-tilted weighting.</Block>
      </Section>

      <Section title="Why peer-relative">
        <p className="text-[14px] leading-relaxed">
          Comparing a small-cap NBFC to HDFC Bank on absolute return-on-equity is
          meaningless — they operate at different scales, regulatory regimes, and
          growth profiles. Comparing it to other small-cap NBFCs on the same scorecard
          is. Every percentile on the platform is computed within a stock&apos;s{" "}
          <em>(peer cluster, maturity tier)</em> bucket. A 75 always means &quot;top
          25% within its bucket&quot; — same meaning across the entire site.
        </p>
      </Section>

      <Section title="What we don't publish">
        <p className="text-[14px] leading-relaxed muted-text">
          The specific peer-cluster definitions, per-cluster pillar weights, and the
          underlying metric weights inside each pillar are research IP we maintain in
          house and continuously refine. On any individual stock&apos;s page we show
          you exactly how that stock&apos;s score is built — its pillar percentiles,
          which metrics drove them up or down, and which strengths and gaps stand out
          vs peers. That&apos;s the transparency that matters when reading a score.
          We don&apos;t publish a side-by-side catalogue of every cluster&apos;s
          recipe.
        </p>
      </Section>

      <Section title="Data sources">
        <p className="text-[14px] leading-relaxed muted-text">
          Annual and quarterly fundamentals are derived from publicly disclosed
          company filings. Daily prices and technical indicators are computed from
          open market data. All scores recompute weekly after each Friday&apos;s
          market close.
        </p>
      </Section>

      <footer className="mt-14 pt-6 border-t hairline text-[12px] muted-text">
        Not investment advice. Scores are quantitative rankings, not buy/sell
        recommendations. Always do your own research before making investment
        decisions.{" "}
        <Link href="/" className="underline hover:no-underline">
          Back to the heat map
        </Link>.
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-[24px] tracking-tight mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 hairline pl-4">
      <div className="font-medium text-[14px] mb-1">{label}</div>
      <div className="text-[13.5px] leading-relaxed muted-text">{children}</div>
    </div>
  );
}
