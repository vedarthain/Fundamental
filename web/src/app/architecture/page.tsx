export const revalidate = 86400;

export const metadata = {
  title: "System Architecture — EquityRoots NSE",
  description: "Low-level design diagram of the EquityRoots data pipeline, scoring engine, and web layer.",
};

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12 space-y-16">
      <Header />
      <PipelineDiagram />
      <ScoringEngine />
      <WebLayer />
      <DataFlowTable />
    </div>
  );
}

/* ─── Header ─────────────────────────────────────────────────────────────── */

function Header() {
  return (
    <div className="space-y-3">
      <p className="text-xs font-mono tracking-widest uppercase text-[var(--color-muted)]">
        Internal Reference · Low-Level Design
      </p>
      <h1 className="text-3xl font-bold text-[var(--color-ink)]">
        System Architecture
      </h1>
      <p className="text-[var(--color-muted)] max-w-2xl leading-relaxed">
        End-to-end data flow from Screener.in scraping through the ETL scoring
        engine, Neon cloud sync, and Vercel web deployment. Each node below
        maps to real code and infrastructure.
      </p>
    </div>
  );
}

/* ─── Main Pipeline Diagram ───────────────────────────────────────────────── */

function PipelineDiagram() {
  return (
    <Section title="Full Data Pipeline" subtitle="Source → ETL → Store → Sync → Serve">
      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 1100 520"
          className="w-full min-w-[800px]"
          fontFamily="var(--font-sans)"
        >
          {/* ── Layer labels ── */}
          <LayerLabel x={20} y={60} label="DATA SOURCES" />
          <LayerLabel x={20} y={195} label="ETL (local)" />
          <LayerLabel x={20} y={330} label="STORAGE" />
          <LayerLabel x={20} y={450} label="PRODUCTION" />

          {/* ── Horizontal dividers ── */}
          <line x1={150} y1={130} x2={1090} y2={130} stroke="#eaecf0" strokeWidth={1} strokeDasharray="4 3" />
          <line x1={150} y1={265} x2={1090} y2={265} stroke="#eaecf0" strokeWidth={1} strokeDasharray="4 3" />
          <line x1={150} y1={400} x2={1090} y2={400} stroke="#eaecf0" strokeWidth={1} strokeDasharray="4 3" />

          {/* ── DATA SOURCES layer ── */}
          <Node x={175} y={60} w={160} h={52} color="#f0f4ff" border="#7d95b3"
            title="Screener.in" sub="xlsx export per ticker" icon="🌐" />
          <Node x={395} y={60} w={160} h={52} color="#f0f4ff" border="#7d95b3"
            title="NSE Bhavcopy" sub="daily EQ/BE CSV" icon="📊" />
          <Node x={615} y={60} w={160} h={52} color="#f0f4ff" border="#7d95b3"
            title="NSE Price History" sub="252d OHLCV" icon="📈" />
          <Node x={835} y={60} w={160} h={52} color="#f0f4ff" border="#7d95b3"
            title="Technical Signals" sub="EMA, bollinger, RSI" icon="⚡" />

          {/* ── ETL layer ── */}
          <Node x={175} y={165} w={160} h={72} color="#f5f0ff" border="#9f7dc8"
            title="fetch-many" sub={"scraper.py\n1 worker · 1 req/s"} icon="🔄" />
          <Node x={395} y={165} w={160} h={72} color="#f5f0ff" border="#9f7dc8"
            title="formulas.py" sub={"90+ metric fns\nquality/val/mom"} icon="🧮" />
          <Node x={615} y={165} w={160} h={72} color="#f5f0ff" border="#9f7dc8"
            title="scorer.py" sub={"percentile rank\nper peer cluster"} icon="🎯" />
          <Node x={835} y={165} w={160} h={72} color="#f5f0ff" border="#9f7dc8"
            title="scorecards.py" sub={"42 cluster configs\n4 tier variants"} icon="📋" />

          {/* ── STORAGE layer ── */}
          <Node x={175} y={295} w={220} h={72} color="#f0fff4" border="#4a9e6b"
            title="app DB (local Postgres)" sub={"metrics_snapshot\nscores · cluster · screener_meta"} icon="🗄️" />
          <Node x={495} y={295} w={220} h={72} color="#f0fff4" border="#4a9e6b"
            title="golden DB (local Postgres)" sub={"price_history · indicators\ndaily_signals · nifty_returns"} icon="💰" />
          <Node x={815} y={295} w={220} h={52} color="#fffbf0" border="#c9a83c"
            title="sync-neon.sh" sub="Nifty 200 subset → cloud" icon="☁️" />

          {/* ── PRODUCTION layer ── */}
          <Node x={175} y={415} w={220} h={52} color="#fff0f0" border="#c94a4a"
            title="Neon (app DB)" sub="cloud Postgres · scores + meta" icon="🔵" />
          <Node x={495} y={415} w={220} h={52} color="#fff0f0" border="#c94a4a"
            title="Neon (golden DB)" sub="cloud Postgres · price history" icon="🔵" />
          <Node x={815} y={415} w={220} h={52} color="#e8f4fd" border="#3d7db3"
            title="Vercel (Next.js)" sub="EquityRoots web app" icon="▲" />

          {/* ── Arrows: Sources → ETL ── */}
          <Arrow x1={255} y1={112} x2={255} y2={165} />
          <Arrow x1={475} y1={112} x2={437} y2={165} />
          <Arrow x1={695} y1={112} x2={695} y2={165} />
          <Arrow x1={915} y1={112} x2={915} y2={165} />

          {/* ── Arrows: within ETL ── */}
          <Arrow x1={335} y1={195} x2={395} y2={195} />
          <Arrow x1={555} y1={195} x2={615} y2={195} />
          <Arrow x1={915} y1={237} x2={695} y2={237} />

          {/* ── Arrows: ETL → Storage ── */}
          <Arrow x1={290} y1={237} x2={290} y2={295} />
          <Arrow x1={695} y1={237} x2={605} y2={295} />

          {/* ── Arrows: Storage → sync ── */}
          <Arrow x1={395} y1={330} x2={815} y2={330} label="weekly manual" />

          {/* ── Arrows: sync → Neon ── */}
          <Arrow x1={925} y1={347} x2={290} y2={415} label="" bend />
          <Arrow x1={925} y1={347} x2={605} y2={415} />

          {/* ── Arrow: Neon → Vercel ── */}
          <Arrow x1={395} y1={440} x2={815} y2={440} label="query on request" />

          {/* ── GitHub Action badge ── */}
          <rect x={750} y={52} width={160} height={52} rx={6}
            fill="#fff8e8" stroke="#c9a83c" strokeWidth={1.5} />
          <text x={830} y={74} textAnchor="middle" fontSize={11} fontWeight={600} fill="#7a6020">
            GitHub Action
          </text>
          <text x={830} y={90} textAnchor="middle" fontSize={10} fill="#7a6020">
            refresh-ltp.yml
          </text>
          <text x={830} y={104} textAnchor="middle" fontSize={9} fill="#9a8040">
            18:30 IST Mon-Fri
          </text>

          {/* Action → Neon direct arrow */}
          <line x1={830} y1={104} x2={830} y2={415} stroke="#c9a83c" strokeWidth={1.5}
            strokeDasharray="5 3" markerEnd="url(#arr)" />
          <text x={843} y={280} fontSize={9} fill="#7a6020">LTP only</text>

          <defs>
            <marker id="arr" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
            </marker>
            <marker id="arr-gold" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#c9a83c" />
            </marker>
          </defs>
        </svg>
      </div>
    </Section>
  );
}

/* ─── Scoring Engine Detail ───────────────────────────────────────────────── */

function ScoringEngine() {
  return (
    <Section title="Scoring Engine — Low-Level Design" subtitle="How a stock becomes a score">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <StepCard step="1" title="Metric Computation" color="indigo">
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            <code className="font-mono text-xs">metrics.py</code> loads annual/quarterly fundamentals
            from <code className="font-mono text-xs">app.fundamentals_*</code> and 252-day price
            history from <code className="font-mono text-xs">golden.price_history</code>. It calls all
            formulas in the cluster's active scorecard and writes raw values to{" "}
            <code className="font-mono text-xs">app.metrics_snapshot</code> as a JSONB dict.
          </p>
          <CodeBlock>{`{
  "roe_3y": 18.4,
  "pe_ttm": null,      ← loss-maker fallback
  "ret_12m_rel": 12.3,
  ...90+ fields
}`}</CodeBlock>
        </StepCard>

        <StepCard step="2" title="Peer Bucket Assignment" color="violet">
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            Each stock is placed in a peer bucket by <code className="font-mono text-xs">(cluster_id, maturity_tier)</code>.
            If the bucket has fewer than 10 peers, the system falls back to the whole cluster or the meta-cluster.
            <code className="font-mono text-xs">score_status</code> records which bucket was used.
          </p>
          <div className="mt-3 space-y-1 text-xs font-mono">
            <div className="flex gap-2 items-center">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span><strong>full</strong> — (cluster, tier) ≥10 peers</span>
            </div>
            <div className="flex gap-2 items-center">
              <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
              <span><strong>partial-cluster-mixed-tiers</strong> — all tiers merged</span>
            </div>
            <div className="flex gap-2 items-center">
              <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
              <span><strong>partial-meta-cluster</strong> — meta-cluster fallback</span>
            </div>
          </div>
        </StepCard>

        <StepCard step="3" title="Percentile Ranking" color="teal">
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            For each formula, raw values are converted to a 0–100 percentile rank within the peer bucket.
            Direction-aware: lower P/E → higher rank; higher ROE → higher rank. Null values stay null.
          </p>
          <CodeBlock>{`rank = 1 − (position / (n−1)) × 100
# Best peer = 100, worst = 0
# Null values excluded from ranking`}</CodeBlock>
        </StepCard>

        <StepCard step="4" title="Pillar Scores" color="amber">
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            Component percentiles are weighted within each pillar. Weights re-normalize across
            non-null components so missing data doesn't collapse the pillar.
          </p>
          <CodeBlock>{`quality_pct =
  Σ(component_pct[k] × w[k])
  ─────────────────────────────
      Σ(w[k] for non-null k)
`}</CodeBlock>
        </StepCard>

        <StepCard step="5" title="Industry Score" color="green">
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            Cluster-default pillar weights blend the three pillars into a raw composite. That raw
            composite is then <strong>re-percentiled</strong> within the peer bucket to produce the
            final <code className="font-mono text-xs">composite_pct</code> (Industry Score).
          </p>
          <CodeBlock>{`raw = Q×w_q + V×w_v + M×w_m
composite_pct = percentile(raw)
# Re-ranking ensures uniform 0-100
# distribution regardless of pillar skew`}</CodeBlock>
        </StepCard>

        <StepCard step="6" title="Your Score (Custom)" color="slate">
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            Stored pillar percentiles are re-blended in SQL using slider weights. No re-percentiling —
            instant computation from already-stored values.
          </p>
          <CodeBlock>{`blend =
  ROUND((quality_pct  × :w_q +
         valuation_pct × :w_v +
         momentum_pct  × :w_m) / 100)
# w_q + w_v + w_m = 100 always`}</CodeBlock>
        </StepCard>
      </div>
    </Section>
  );
}

/* ─── Web Layer ──────────────────────────────────────────────────────────── */

function WebLayer() {
  return (
    <Section title="Web Layer — Routes & Components" subtitle="Next.js App Router, server components">
      <div className="overflow-x-auto">
        <svg viewBox="0 0 1100 360" className="w-full min-w-[700px]" fontFamily="var(--font-sans)">
          {/* Neon */}
          <Node x={20} y={140} w={140} h={72} color="#fff0f0" border="#c94a4a"
            title="Neon Postgres" sub="app DB + golden DB" icon="🔵" />

          {/* Next.js server */}
          <Node x={230} y={100} w={160} h={52} color="#e8f4fd" border="#3d7db3"
            title="Next.js Server" sub="Vercel edge / Node" icon="▲" />

          {/* Routes */}
          <RouteNode x={470} y={30} route="/tools/screener" desc="Screener + custom weights" color="#f0f4ff" border="#7d95b3" />
          <RouteNode x={470} y={110} route="/sectors" desc="Cluster heatmap + returns" color="#f0f4ff" border="#7d95b3" />
          <RouteNode x={470} y={190} route="/stock/[symbol]" desc="Stock detail + tabs" color="#f0f4ff" border="#7d95b3" />
          <RouteNode x={470} y={270} route="/industry/[id]" desc="Industry peer table" color="#f0f4ff" border="#7d95b3" />

          {/* Components */}
          <ComponentNode x={740} y={20} name="Controls.tsx" desc="Weight sliders, presets" color="#f5f0ff" />
          <ComponentNode x={740} y={80} name="SnapshotRibbon.tsx" desc="Dark sticky metadata bar" color="#f5f0ff" />
          <ComponentNode x={740} y={140} name="StockPageTabs.tsx" desc="Latest / About / Numbers" color="#f5f0ff" />
          <ComponentNode x={740} y={200} name="MetricViz.tsx" desc="Animated gauge + count-up" color="#f5f0ff" />
          <ComponentNode x={740} y={260} name="spider.ts" desc="6D radar chart data" color="#f5f0ff" />
          <ComponentNode x={740} y={310} name="score.ts" desc="Band colors, fmtPct" color="#f5f0ff" />

          {/* Cache */}
          <Node x={960} y={140} w={120} h={52} color="#f0fff4" border="#4a9e6b"
            title="unstable_cache" sub="1h TTL · revalidate" icon="⚡" />

          {/* Arrows */}
          <Arrow x1={160} y1={176} x2={230} y2={145} />
          <Arrow x1={390} y1={126} x2={470} y2={56} />
          <Arrow x1={390} y1={126} x2={470} y2={136} />
          <Arrow x1={390} y1={126} x2={470} y2={216} />
          <Arrow x1={390} y1={126} x2={470} y2={296} />
          <Arrow x1={660} y1={46} x2={740} y2={46} />
          <Arrow x1={660} y1={136} x2={740} y2={106} />
          <Arrow x1={660} y1={216} x2={740} y2={166} />
          <Arrow x1={660} y1={296} x2={740} y2={226} />
          <Arrow x1={860} y1={166} x2={960} y2={166} />

          <defs>
            <marker id="arr" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
            </marker>
          </defs>
        </svg>
      </div>
    </Section>
  );
}

/* ─── Data Flow Reference Table ───────────────────────────────────────────── */

function DataFlowTable() {
  const rows: Array<{
    from: string; to: string; what: string; how: string; freq: string;
  }> = [
    { from: "Screener.in", to: "local app DB", what: "Annual + quarterly financials", how: "Python httpx, xlsx parse", freq: "Weekly manual" },
    { from: "NSE Bhavcopy", to: "Neon app DB", what: "Current LTP per symbol", how: "GitHub Action (refresh-ltp.yml)", freq: "Daily (18:30 IST)" },
    { from: "local app DB", to: "local golden DB", what: "Price signals, 200 EMA", how: "Pre-computed by signals script", freq: "Weekly manual" },
    { from: "local app DB", to: "Neon cloud (app)", what: "Scores + meta for Nifty 200", how: "sync-neon.sh (psql COPY)", freq: "After each ETL run" },
    { from: "local golden DB", to: "Neon cloud (golden)", what: "Price history for Nifty 200", how: "sync-neon.sh (psql COPY)", freq: "After each ETL run" },
    { from: "Neon cloud", to: "Next.js server", what: "Scores, prices, fundamentals", how: "postgres.js over TLS", freq: "On each page request" },
    { from: "Next.js server", to: "Browser", what: "HTML + hydration data", how: "Vercel edge CDN", freq: "Per request (cached)" },
  ];

  return (
    <Section title="Data Flow Reference" subtitle="Every hop in the pipeline">
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border-default)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-paper)] border-b border-[var(--color-border-default)]">
              {["From", "To", "What moves", "How", "Frequency"].map(h => (
                <th key={h} className="px-4 py-3 text-left font-semibold text-[var(--color-ink)] text-xs uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-b border-[var(--color-border-default)] ${i % 2 === 0 ? "" : "bg-[var(--color-paper)]"}`}>
                <td className="px-4 py-3 font-mono text-xs text-[var(--color-accent-600)]">{r.from}</td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--color-accent-600)]">{r.to}</td>
                <td className="px-4 py-3 text-[var(--color-ink)]">{r.what}</td>
                <td className="px-4 py-3 text-[var(--color-muted)] font-mono text-xs">{r.how}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded text-xs bg-[var(--color-accent-50)] text-[var(--color-accent-600)]">
                    {r.freq}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* ─── Shared SVG Primitives ──────────────────────────────────────────────── */

function Node({
  x, y, w, h, color, border, title, sub, icon,
}: {
  x: number; y: number; w: number; h: number;
  color: string; border: string; title: string; sub: string; icon: string;
}) {
  const lines = sub.split("\n");
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={color} stroke={border} strokeWidth={1.5} />
      <text x={x + 28} y={y + h / 2 - (lines.length > 1 ? 8 : 0)} fontSize={11} fontWeight={600} fill="#15171c">
        {title}
      </text>
      {lines.map((line, i) => (
        <text key={i} x={x + 28} y={y + h / 2 + 6 + i * 12} fontSize={9} fill="#5b6470">
          {line}
        </text>
      ))}
      <text x={x + 10} y={y + h / 2 + 4} fontSize={13} textAnchor="middle">
        {icon}
      </text>
    </g>
  );
}

function LayerLabel({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <text
      x={x} y={y}
      fontSize={8}
      fontWeight={700}
      fill="#94a3b8"
      letterSpacing={1.5}
      style={{ textTransform: "uppercase" }}
      writingMode="tb"
    >
      {label}
    </text>
  );
}

function RouteNode({ x, y, route, desc, color, border }: {
  x: number; y: number; route: string; desc: string; color: string; border: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={180} height={52} rx={6} fill={color} stroke={border} strokeWidth={1.5} />
      <text x={x + 10} y={y + 20} fontSize={11} fontWeight={700} fill="#3d5778" fontFamily="monospace">
        {route}
      </text>
      <text x={x + 10} y={y + 36} fontSize={9} fill="#5b6470">{desc}</text>
    </g>
  );
}

function ComponentNode({ x, y, name, desc, color }: {
  x: number; y: number; name: string; desc: string; color: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={190} height={44} rx={5} fill={color} stroke="#9f7dc8" strokeWidth={1} />
      <text x={x + 10} y={y + 17} fontSize={10} fontWeight={600} fill="#5b3fa0" fontFamily="monospace">
        {name}
      </text>
      <text x={x + 10} y={y + 32} fontSize={9} fill="#5b6470">{desc}</text>
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, label, bend }: {
  x1: number; y1: number; x2: number; y2: number; label?: string; bend?: boolean;
}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const d = bend
    ? `M${x1},${y1} C${x1},${y2} ${x2},${y1} ${x2},${y2}`
    : `M${x1},${y1} L${x2},${y2}`;
  return (
    <g>
      <path d={d} fill="none" stroke="#94a3b8" strokeWidth={1.5} markerEnd="url(#arr)" />
      {label && (
        <text x={mx} y={my - 4} textAnchor="middle" fontSize={8} fill="#94a3b8">
          {label}
        </text>
      )}
    </g>
  );
}

/* ─── Layout Helpers ────────────────────────────────────────────────────── */

function Section({
  title, subtitle, children,
}: {
  title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <section className="space-y-6">
      <div className="border-b border-[var(--color-border-default)] pb-3">
        <h2 className="text-xl font-bold text-[var(--color-ink)]">{title}</h2>
        <p className="text-sm text-[var(--color-muted)] mt-0.5">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function StepCard({
  step, title, color, children,
}: {
  step: string; title: string; color: string; children: React.ReactNode;
}) {
  const colors: Record<string, { bg: string; border: string; badge: string; badgeFg: string }> = {
    indigo:  { bg: "#f0f4ff", border: "#7d95b3", badge: "#3d5778", badgeFg: "#fff" },
    violet:  { bg: "#f5f0ff", border: "#9f7dc8", badge: "#5b3fa0", badgeFg: "#fff" },
    teal:    { bg: "#f0fffe", border: "#3da89e", badge: "#1d7a73", badgeFg: "#fff" },
    amber:   { bg: "#fffbf0", border: "#c9a83c", badge: "#7a6020", badgeFg: "#fff" },
    green:   { bg: "#f0fff4", border: "#4a9e6b", badge: "#2e9a47", badgeFg: "#fff" },
    slate:   { bg: "#f4f6f8", border: "#7d8fa0", badge: "#3d5778", badgeFg: "#fff" },
  };
  const c = colors[color] ?? colors.slate;
  return (
    <div
      className="rounded-xl p-5 space-y-3"
      style={{ background: c.bg, border: `1.5px solid ${c.border}` }}
    >
      <div className="flex items-center gap-3">
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: c.badge, color: c.badgeFg }}
        >
          {step}
        </span>
        <h3 className="font-semibold text-[var(--color-ink)]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-2 p-3 rounded-lg bg-[#0f111a] text-[#c9d1d9] text-xs font-mono overflow-x-auto leading-relaxed">
      {children}
    </pre>
  );
}
