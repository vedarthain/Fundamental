/**
 * BusinessVisual — replaces the wall-of-prose "About the company" card with
 * an animated 4-card grid: Company description · What they do · Global
 * footprint · Shareholder breakup.
 *
 * Data comes from yfinance's business_summary (parsed heuristically) and
 * sector/industry metadata. Two of the four cards (Company description CEO/MD
 * line, Shareholder breakup) currently show "Coming soon" placeholders —
 * they unlock in Phase B once we add yfinance companyOfficers + Screener
 * shareholding sheet to the ETL.
 *
 * Animation: relies on the .heat-tile-drop keyframe + RevealOnScroll
 * (already defined in globals.css). Each card and chip gets an inline
 * animationDelay so they cascade in. Pure CSS, no client JS overhead beyond
 * the IntersectionObserver in RevealOnScroll.
 *
 * Server component — no useState, no event handlers (collapse is native HTML).
 */
import {
  Shirt, Landmark, Code2, HeartPulse, Car, Layers, ShoppingBag, Flame,
  Building, Hammer, Tv2, Store, Briefcase, Globe2,
  Calendar, MapPin, Cpu, Beaker, Wheat, Truck, PlaneTakeoff, Hotel,
  Factory, Anchor, Pickaxe, Pill, Wrench, Cable,
  UserRound, History, Tag, PieChart, Target, Lock, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { RevealOnScroll } from "./RevealOnScroll";

export type ShareholdingRow = {
  period_end: string;
  promoter_pct: number | null;
  fii_pct: number | null;
  dii_pct: number | null;
  government_pct: number | null;
  public_pct: number | null;
  shareholders: number | null;
};

type IconCmp = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

// ---------------------------------------------------------------------------
// Sector → icon mapping. Keyed off case-insensitive substring of "sector +
// industry". First match wins. Order matters — most specific patterns first.
// ---------------------------------------------------------------------------

const ICON_RULES: { match: RegExp; icon: IconCmp; tint: string }[] = [
  { match: /textil|garment|apparel|cotton/i,        icon: Shirt,        tint: "var(--color-accent-400)" },
  { match: /bank|financial servic|insurance|nbfc/i, icon: Landmark,     tint: "var(--color-score-good)" },
  { match: /pharma|drug|medicin|health/i,           icon: Pill,         tint: "var(--color-score-excellent)" },
  { match: /software|it servic|technolog|comput/i,  icon: Code2,        tint: "var(--color-accent-500)" },
  { match: /semicond|electron|chip/i,               icon: Cpu,          tint: "var(--color-accent-500)" },
  { match: /chemical|specialty chem|fertil/i,       icon: Beaker,       tint: "var(--color-score-good)" },
  { match: /auto|vehicle|tyre|motor/i,              icon: Car,          tint: "var(--color-score-poor)" },
  { match: /cement|construction materials/i,        icon: Layers,       tint: "var(--color-muted)" },
  { match: /steel|metal|alumin/i,                   icon: Layers,       tint: "var(--color-muted)" },
  { match: /mining|minerals|coal/i,                 icon: Pickaxe,      tint: "var(--color-muted)" },
  { match: /oil|gas|refin|petro|energy/i,           icon: Flame,        tint: "var(--color-score-poor)" },
  { match: /power|utilit|electric/i,                icon: Cable,        tint: "var(--color-accent-500)" },
  { match: /food|fmcg|consumer.*staple|beverage|dairy/i, icon: ShoppingBag, tint: "var(--color-score-good)" },
  { match: /agro|agric|crop|farm/i,                 icon: Wheat,        tint: "var(--color-score-good)" },
  { match: /construction|infrastructure|engineer/i, icon: Hammer,       tint: "var(--color-accent-600)" },
  { match: /real estate|realty|property/i,          icon: Building,     tint: "var(--color-accent-500)" },
  { match: /hotel|hospital|leisure|tourism/i,       icon: Hotel,        tint: "var(--color-accent-400)" },
  { match: /retail|store|e-?comm/i,                 icon: Store,        tint: "var(--color-accent-500)" },
  { match: /media|entertainment|broadcast/i,        icon: Tv2,          tint: "var(--color-accent-500)" },
  { match: /telecom|wireless|broadband/i,           icon: Cable,        tint: "var(--color-accent-500)" },
  { match: /transport|logist|ship|port/i,           icon: Truck,        tint: "var(--color-muted)" },
  { match: /aviat|airline|aerospace/i,              icon: PlaneTakeoff, tint: "var(--color-accent-500)" },
  { match: /shipping|marine/i,                      icon: Anchor,       tint: "var(--color-muted)" },
  { match: /machine|capital goods|equipment/i,      icon: Wrench,       tint: "var(--color-muted)" },
  { match: /heart|cardiac|hospital/i,               icon: HeartPulse,   tint: "var(--color-score-excellent)" },
  { match: /factory|manufact/i,                     icon: Factory,      tint: "var(--color-muted)" },
];

function pickIcon(sector: string | null, industry: string | null): { Icon: IconCmp; tint: string } {
  const txt = `${sector ?? ""} ${industry ?? ""}`;
  for (const rule of ICON_RULES) if (rule.match.test(txt)) return { Icon: rule.icon, tint: rule.tint };
  return { Icon: Briefcase, tint: "var(--color-accent-500)" };
}

// ---------------------------------------------------------------------------
// Heuristic summary parser. yfinance summaries follow predictable templates
// from regulatory disclosures, so simple regex extraction works well.
// ---------------------------------------------------------------------------

const GEO_TOKENS: { label: string; pattern: RegExp }[] = [
  { label: "India",          pattern: /\bIndia\b/i },
  { label: "International",  pattern: /\binternationally\b/i },
  { label: "United States",  pattern: /\bUnited States\b|\bU\.S\.A?\.?\b|\bAmerica\b/i },
  { label: "Europe",         pattern: /\bEurope(?:an)?\b/i },
  { label: "United Kingdom", pattern: /\bUnited Kingdom\b|\bU\.K\.?\b/i },
  { label: "Middle East",    pattern: /\bMiddle East\b/i },
  { label: "Africa",         pattern: /\bAfrica\b/i },
  { label: "Asia",           pattern: /\bAsia\b/i },
  { label: "Australia",      pattern: /\bAustralia\b/i },
  { label: "China",          pattern: /\bChina\b/i },
  { label: "Japan",          pattern: /\bJapan\b/i },
  { label: "Canada",         pattern: /\bCanada\b/i },
  { label: "Singapore",      pattern: /\bSingapore\b/i },
  { label: "Germany",        pattern: /\bGermany\b/i },
];

type Parsed = {
  tagline: string;
  /** Either real "operates through ... segments" splits OR a fallback
   *  list of products/activities mined from "offers", "engages in",
   *  "involved in", "manufactures". Always rendered as chips. */
  segments: string[];
  /** Where the segments came from — drives the chip-row label. */
  segmentsSource: "segments" | "products" | "activities" | null;
  /** Brand names mentioned in "sells under the X and Y brand names". */
  brands: string[];
  geo: string[];
  founded: string | null;
  hq: string | null;
  /** "formerly known as X" / name-change sentences. */
  milestone: string | null;
  /** "exports its products to ..." → renderable region string. */
  exports: string | null;
};

function parseSummary(s: string): Parsed {
  // Tagline = first sentence. Cap at ~220 chars.
  const firstSentence = s.split(/(?<=\.)\s+/)[0] || s;
  const tagline =
    firstSentence.length > 220 ? firstSentence.slice(0, 217).trimEnd() + "…" : firstSentence;

  // What they do — try several patterns in order, stop at the first match.
  // Each pattern carries a label so we can show "Segments" vs "Products"
  // vs "Activities" honestly in the UI.
  let segments: string[] = [];
  let segmentsSource: Parsed["segmentsSource"] = null;
  const splitList = (raw: string): string[] =>
    raw
      .split(/\s*;\s*|\s*,\s*(?:and\s+)?|\s+and\s+/i)
      .map((x) =>
        x
          .replace(/^\s*(?:the\s+|various\s+|a\s+range\s+of\s+|other\s+)/i, "")
          .replace(/\s+(?:segments?|products?|services?|brands?|etc\.?)\s*$/i, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((x) => x.length > 2 && x.length < 80);

  // 1. Real segments: "operates through X, Y, and Z segments."
  const segMatch = s.match(/operates?\s+(?:through|in|as)\s+([^.]+?)\s*(?:segments?\.|\.)/i);
  if (segMatch) {
    segments = splitList(segMatch[1]);
    if (segments.length > 0) segmentsSource = "segments";
  }
  // 2. Products: "offers a range of X, Y, Z."  /  "The company offers X, Y."
  if (segments.length === 0) {
    const offersMatch = s.match(/(?:offers|provides|manufactures(?:\s+and\s+sells)?|produces)\s+(?:a\s+range\s+of\s+|various\s+)?([^.]+?)\./i);
    if (offersMatch) {
      segments = splitList(offersMatch[1]);
      if (segments.length > 0) segmentsSource = "products";
    }
  }
  // 3. Activities: "engages in the manufacture and sale of X."  /
  //    "is involved in the trading of X, Y, Z."
  if (segments.length === 0) {
    const engagesMatch = s.match(/(?:engages?\s+in|is\s+(?:also\s+)?involved\s+in)\s+(?:the\s+)?[a-z\s]+?\s+of\s+([^.]+?)\./i);
    if (engagesMatch) {
      segments = splitList(engagesMatch[1]);
      if (segments.length > 0) segmentsSource = "activities";
    }
  }
  segments = segments.slice(0, 6);

  // Brand names: "sells its products under the X and Y brand names."
  let brands: string[] = [];
  const brandMatch = s.match(/(?:sells?|markets?)\s+(?:its\s+products\s+)?under\s+the\s+([^.]+?)\s+brand\s+names?\./i);
  if (brandMatch) {
    brands = splitList(brandMatch[1]).slice(0, 4);
  }

  // Geography in document order.
  const geo = GEO_TOKENS.filter((g) => g.pattern.test(s)).map((g) => g.label);

  // Founded / incorporated year.
  const foundedMatch = s.match(/(?:founded|incorporated|established|formed)\s+in\s+(\d{4})/i);
  const founded = foundedMatch ? foundedMatch[1] : null;

  // HQ — "based in <city>" / "headquartered in <city>".
  const hqMatch = s.match(/(?:based|headquartered|located)\s+in\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?(?:,\s*[A-Z][A-Za-z]+)?)/);
  const hq = hqMatch ? hqMatch[1].trim() : null;

  // Major milestone — capture the sentence containing "formerly known as" or
  // "spun off" / "merged with" / "demerged".
  let milestone: string | null = null;
  const mileMatch = s.match(
    /([^.]*?(?:formerly known as|spun off|demerged|merged with|acquired by)[^.]+\.)/i,
  );
  if (mileMatch) {
    const m = mileMatch[1].trim();
    if (m.length < 260) milestone = m;
  }

  // Exports — "exports its products to <region>." / "exports to <region>."
  let exportsStr: string | null = null;
  const expMatch = s.match(/exports?\s+(?:its\s+products\s+)?to\s+([^.]+?)(?:\s+markets?)?\./i);
  if (expMatch) {
    const cleaned = expMatch[1].replace(/\s*markets?\s*$/i, "").trim();
    if (cleaned.length < 120) exportsStr = cleaned;
  }

  return { tagline, segments, segmentsSource, brands, geo, founded, hq, milestone, exports: exportsStr };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BusinessVisual({
  symbol,
  sector,
  industry,
  summary,
  website,
  ceoName,
  ceoTitle,
  shareholding,
}: {
  companyName: string;
  symbol: string;
  sector: string | null;
  industry: string | null;
  summary: string;
  website: string | null;
  employees: number | null;
  ceoName?: string | null;
  ceoTitle?: string | null;
  shareholding?: ShareholdingRow[];
}) {
  const parsed = parseSummary(summary);
  const { Icon, tint } = pickIcon(sector, industry);

  return (
    <RevealOnScroll threshold={0.05}>
      <section
        className="mt-8 card overflow-hidden max-w-[1100px] relative"
        style={{
          background:
            "linear-gradient(135deg, var(--color-card) 0%, var(--color-paper) 100%)",
        }}
      >
        {/* Soft accent wash in the corner */}
        <div
          aria-hidden
          className="absolute -top-10 -right-10 w-[260px] h-[260px] rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(204,120,92,0.10), transparent 70%)",
          }}
        />

        <div className="relative p-6 md:p-8">
          {/* ---------------- Top bar ---------------- */}
          <div className="flex items-baseline justify-between gap-4 mb-5">
            <div className="text-[11px] uppercase tracking-[0.18em] muted-text">
              About {symbol}
            </div>
            {website && (
              <a
                href={website.startsWith("http") ? website : `https://${website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] underline hover:no-underline"
                style={{ color: "var(--color-accent-600)" }}
              >
                {website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
              </a>
            )}
          </div>

          {/* ---------------- Hero ---------------- */}
          <div className="flex items-start gap-5 mb-7">
            <div
              className="heat-tile-drop shrink-0 flex items-center justify-center rounded-[14px]"
              style={{
                width: 72, height: 72,
                background: "var(--color-accent-50)",
                border: "1px solid var(--color-accent-200)",
                animationDelay: "0ms",
              }}
            >
              <Icon size={34} strokeWidth={1.6} />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="font-display text-[20px] md:text-[22px] tracking-tight leading-[1.3]"
                style={{ color: "var(--color-ink)" }}
              >
                {parsed.tagline}
              </div>
              {sector && (
                <div
                  className="heat-tile-drop inline-flex items-center gap-1.5 mt-3 px-2.5 py-1 rounded-full text-[11px] font-medium"
                  style={{
                    background: "var(--color-accent-50)",
                    color: tint,
                    border: "1px solid var(--color-accent-200)",
                    animationDelay: "100ms",
                  }}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: tint }}
                  />
                  {sector}
                </div>
              )}
            </div>
          </div>

          {/* ---------------- 4-card grid ---------------- */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <CardDescription parsed={parsed} ceoName={ceoName} ceoTitle={ceoTitle} delay={200} />
            <CardWhatTheyDo parsed={parsed} delay={300} />
            <CardGlobalFootprint parsed={parsed} delay={400} />
            <CardShareholder shareholding={shareholding} delay={500} />
          </div>

          {/* ---------------- Read full description ---------------- */}
          <details className="mt-7 group">
            <summary
              className="cursor-pointer text-[12px] muted-text hover:text-[var(--color-accent-600)] select-none inline-flex items-center gap-1.5"
              style={{ listStyle: "none" }}
            >
              <span className="transition-transform group-open:rotate-90 inline-block">›</span>
              Read full description
            </summary>
            <p className="mt-3 text-[14px] leading-[1.7] text-[var(--color-ink)] max-w-[880px]">
              {summary}
            </p>
            <div className="mt-2 text-[10.5px] muted-text italic">
              Sourced from public company disclosures.
            </div>
          </details>
        </div>
      </section>
    </RevealOnScroll>
  );
}

// ---------------------------------------------------------------------------
// Card primitives
// ---------------------------------------------------------------------------

function Card({
  title,
  icon,
  delay,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="heat-tile-drop card p-4 flex flex-col"
      style={{
        background: "var(--color-card)",
        border: "1px solid var(--color-border-default)",
        animationDelay: `${delay}ms`,
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span style={{ color: "var(--color-accent-500)" }}>{icon}</span>
        <div className="text-[11px] uppercase tracking-[0.18em] muted-text">{title}</div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function FactRow({
  icon, label, value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="shrink-0 mt-[2px]" style={{ color: "var(--color-muted)" }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] uppercase tracking-wide muted-text">{label}</div>
        <div className="text-[13px] leading-tight mt-0.5 break-words">{value}</div>
      </div>
    </div>
  );
}

function ComingSoonValue({ note }: { note: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11.5px] px-2 py-0.5 rounded-full"
      style={{
        background: "var(--color-paper)",
        border: "1px dashed var(--color-border-default)",
        color: "var(--color-muted)",
      }}
      title={note}
    >
      <Lock size={10} strokeWidth={2} /> Coming soon
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card 1 — Company Description
// ---------------------------------------------------------------------------

function CardDescription({
  parsed, ceoName, ceoTitle, delay,
}: {
  parsed: Parsed;
  ceoName?: string | null;
  ceoTitle?: string | null;
  delay: number;
}) {
  // Render CEO as "Name · Title" if both present; just name otherwise.
  let ceoValue: React.ReactNode;
  if (ceoName) {
    ceoValue = (
      <span>
        {ceoName}
        {ceoTitle && (
          <span className="muted-text italic"> · {ceoTitle}</span>
        )}
      </span>
    );
  } else {
    ceoValue = <span className="muted-text italic">Not disclosed</span>;
  }

  return (
    <Card title="Company description" icon={<Briefcase size={13} strokeWidth={1.8} />} delay={delay}>
      <div className="divide-y hairline">
        <FactRow
          icon={<Calendar size={13} strokeWidth={1.8} />}
          label="Founded"
          value={parsed.founded ?? "—"}
        />
        <FactRow
          icon={<MapPin size={13} strokeWidth={1.8} />}
          label="Headquarters"
          value={parsed.hq ?? "—"}
        />
        <FactRow
          icon={<UserRound size={13} strokeWidth={1.8} />}
          label="CEO / MD"
          value={ceoValue}
        />
        <FactRow
          icon={<History size={13} strokeWidth={1.8} />}
          label="Major milestone"
          value={parsed.milestone ?? <span className="muted-text italic">No record found in disclosures</span>}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card 2 — What they do
// ---------------------------------------------------------------------------

function CardWhatTheyDo({ parsed, delay }: { parsed: Parsed; delay: number }) {
  const hasSegments = parsed.segments.length > 0;
  const hasBrands = parsed.brands.length > 0;
  const hasExports = parsed.exports != null;
  // If we know the company is mentioned in India and no international markers,
  // surface that as a positive signal rather than "not disclosed".
  const isDomesticOnly =
    !hasExports && parsed.geo.length === 1 && parsed.geo[0] === "India";

  // Header reflects where the chip data actually came from.
  const segHeader =
    parsed.segmentsSource === "products"   ? "Core products" :
    parsed.segmentsSource === "activities" ? "Activities"     :
                                              "Segments";

  return (
    <Card title="What they do" icon={<Tag size={13} strokeWidth={1.8} />} delay={delay}>
      {hasSegments ? (
        <>
          <div className="text-[10.5px] uppercase tracking-wide muted-text mb-2">
            {segHeader}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {parsed.segments.map((seg, i) => (
              <span
                key={seg + i}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-medium"
                style={{
                  background: "var(--color-paper)",
                  border: "1px solid var(--color-border-default)",
                  color: "var(--color-ink)",
                }}
              >
                {seg}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="text-[12px] muted-text italic mb-3">
          Activities not explicitly listed in public disclosures.
        </div>
      )}

      {hasBrands && (
        <>
          <div className="text-[10.5px] uppercase tracking-wide muted-text mb-2">
            Brands
          </div>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {parsed.brands.map((b, i) => (
              <span
                key={b + i}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-medium"
                style={{
                  background: "var(--color-accent-50)",
                  border: "1px solid var(--color-accent-200)",
                  color: "var(--color-accent-700)",
                }}
              >
                {b}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="text-[10.5px] uppercase tracking-wide muted-text mb-1.5 mt-1">
        Target customers
      </div>
      <div className="flex items-start gap-1.5 text-[12.5px] leading-[1.5]">
        <Target size={12} strokeWidth={1.8} className="mt-0.5 shrink-0" style={{ color: "var(--color-accent-500)" }} />
        {hasExports ? (
          <span>
            Domestic + exports to <span className="font-medium">{parsed.exports}</span>
          </span>
        ) : isDomesticOnly ? (
          <span>Primarily <span className="font-medium">domestic (India)</span></span>
        ) : (
          <span className="muted-text italic">Not explicitly disclosed</span>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card 3 — Global footprint
// ---------------------------------------------------------------------------

function CardGlobalFootprint({ parsed, delay }: { parsed: Parsed; delay: number }) {
  const onlyDomestic = parsed.geo.length === 1 && parsed.geo[0] === "India";
  return (
    <Card title="Global footprint" icon={<Globe2 size={13} strokeWidth={1.8} />} delay={delay}>
      {parsed.geo.length === 0 ? (
        <div className="text-[12px] muted-text italic">
          No regions disclosed.
        </div>
      ) : onlyDomestic ? (
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px]"
            style={{
              background: "var(--color-accent-50)",
              color: "var(--color-accent-700)",
              border: "1px solid var(--color-accent-200)",
            }}
          >
            <Globe2 size={11} strokeWidth={2} />
            India only
          </span>
          <span className="text-[11.5px] muted-text">Domestic operations</span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {parsed.geo.map((g) => (
              <span
                key={g}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px]"
                style={{
                  background: "var(--color-accent-50)",
                  color: "var(--color-accent-700)",
                  border: "1px solid var(--color-accent-200)",
                }}
              >
                <Globe2 size={11} strokeWidth={2} />
                {g}
              </span>
            ))}
          </div>
          <div className="text-[11.5px] muted-text">
            {parsed.geo.length} region{parsed.geo.length === 1 ? "" : "s"} mentioned in disclosures
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card 4 — Shareholder breakup (Phase B placeholder)
// ---------------------------------------------------------------------------

function CardShareholder({
  shareholding, delay,
}: {
  shareholding?: ShareholdingRow[];
  delay: number;
}) {
  // Real data path: latest quarter for the bars, previous quarter for delta arrows.
  const latest = shareholding?.[0];
  const prev = shareholding?.[1];

  if (!latest) return <CardShareholderEmpty delay={delay} />;

  const rows = [
    { key: "promoter_pct",   label: "Promoter",   color: "var(--color-accent-400)" },
    { key: "fii_pct",        label: "FII",        color: "var(--color-score-good)" },
    { key: "dii_pct",        label: "DII",        color: "var(--color-accent-500)" },
    { key: "public_pct",     label: "Public",     color: "var(--color-muted)" },
    { key: "government_pct", label: "Government", color: "var(--color-score-neutral)" },
  ] as const;

  // Filter out zero/null categories and rank by current %.
  const visible = rows
    .map((r) => {
      const curr = latest[r.key as keyof ShareholdingRow] as number | null;
      const last = prev?.[r.key as keyof ShareholdingRow] as number | null | undefined;
      return { ...r, curr: curr ?? 0, prev: last ?? null };
    })
    .filter((r) => r.curr > 0.01)
    .sort((a, b) => b.curr - a.curr);

  // Pretty label for the period (Mar 2026 etc.) — derived from period_end.
  const d = new Date(latest.period_end);
  const periodLabel = d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });

  return (
    <Card title="Shareholder breakup" icon={<PieChart size={13} strokeWidth={1.8} />} delay={delay}>
      <div className="space-y-2">
        {visible.map((r) => {
          const delta = r.prev != null ? r.curr - r.prev : null;
          const showDelta = delta != null && Math.abs(delta) >= 0.1;
          const Arrow = (delta ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;
          const dColor = (delta ?? 0) >= 0 ? "var(--color-score-good)" : "var(--color-score-poor)";
          return (
            <div key={r.key} className="flex items-center gap-2">
              <div className="text-[11px] muted-text w-[68px] shrink-0">{r.label}</div>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-paper)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, r.curr)}%`, background: r.color }}
                />
              </div>
              <div className="flex items-baseline gap-1 tabular-nums shrink-0">
                <span className="text-[11.5px] font-medium">{r.curr.toFixed(1)}%</span>
                {showDelta && (
                  <span className="inline-flex items-center text-[10px]" style={{ color: dColor }}>
                    <Arrow size={9} strokeWidth={2.6} />
                    {delta! >= 0 ? "+" : ""}{delta!.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[10.5px] muted-text">
        <span>As of {periodLabel}</span>
        {latest.shareholders && (
          <span title="Total shareholders count">
            {latest.shareholders.toLocaleString("en-IN")} holders
          </span>
        )}
      </div>
    </Card>
  );
}

function CardShareholderEmpty({ delay }: { delay: number }) {
  return (
    <Card title="Shareholder breakup" icon={<PieChart size={13} strokeWidth={1.8} />} delay={delay}>
      <div className="flex flex-col items-start gap-3 py-2">
        <div className="text-[12px] muted-text leading-[1.55]">
          Quarterly shareholding pattern not yet collected for this stock.
        </div>
        <span
          className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full"
          style={{
            background: "var(--color-paper)",
            border: "1px dashed var(--color-border-default)",
            color: "var(--color-muted)",
          }}
        >
          <Lock size={10} strokeWidth={2} /> ETL backfill in progress
        </span>
      </div>
    </Card>
  );
}
