/**
 * /today/[date] — auto-generated daily insight permalink.
 *
 * Each calendar date deterministically maps to ONE of seven insight types
 * (see lib/today-insight.ts).  The page renders the title, methodology,
 * matched stocks, and prev/next navigation.
 *
 * Cost (Rule #1): one indexed SELECT per unique-date page load.  Wrapped
 * in unstable_cache(revalidate=86400) so each date renders AT MOST once
 * per Vercel region per day. Older permalinks (e.g. /today/2026-05-01)
 * become essentially static once the cache is warm — they never
 * regenerate again because the underlying score data for that snapshot
 * doesn't change.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import type { Metadata } from "next";
import { loadInsight } from "@/lib/today-insight";
import { band, bandColor, tierLabel } from "@/lib/score";

export const revalidate = 86400;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const getCachedInsight = unstable_cache(
  (dateStr: string) => loadInsight(dateStr),
  ["today-insight"],
  { revalidate: 86400 },
);

export async function generateMetadata(
  { params }: { params: Promise<{ date: string }> },
): Promise<Metadata> {
  const { date } = await params;
  if (!ISO_DATE_RE.test(date)) return {};
  const insight = await getCachedInsight(date);
  const stockList = insight.stocks.slice(0, 5).map((s) => s.symbol).join(", ");
  return {
    title: `${insight.title} — ${date} · EquityRoots`,
    description: `${insight.subtitle} Featuring ${stockList}.`,
    openGraph: {
      title: insight.title,
      description: insight.subtitle,
    },
  };
}

export default async function TodayInsightPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!ISO_DATE_RE.test(date)) notFound();

  const insight = await getCachedInsight(date);

  // Prev/next date links — pure date math, no DB. Cap "next" at today (no
  // future dates) so we don't link to empty permalinks.
  const dateObj = new Date(date + "T12:00:00Z");
  const prevDate = new Date(dateObj.getTime() - 86400_000).toISOString().slice(0, 10);
  const nextDate = new Date(dateObj.getTime() + 86400_000).toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  const showNext = nextDate <= todayStr;

  return (
    <div className="theme-teal mx-auto max-w-[1000px] px-4 md:px-6 py-8 md:py-12">
      <Hero insight={insight} />

      {insight.stocks.length === 0 ? (
        <EmptyState />
      ) : (
        <StockGrid stocks={insight.stocks} />
      )}

      <MethodologyCallout text={insight.methodology} snapshotDate={insight.snapshotDate} />

      <ShareBar insight={insight} />

      <Disclaimer />

      <PrevNext date={date} prevDate={prevDate} nextDate={nextDate} showNext={showNext} />
    </div>
  );
}

// ── Share + disclaimer ────────────────────────────────────────────────────

function ShareBar({
  insight,
}: {
  insight: Awaited<ReturnType<typeof loadInsight>>;
}) {
  // Build the tweet text + URL.  Pre-filled but the user can edit before
  // posting from Twitter's compose screen.  Length-aware: keep symbols
  // under ~5 so we stay well under Twitter's 280-char limit.
  const url = `https://equityroots.in/today/${insight.date}`;
  const symbols = insight.stocks.slice(0, 5).map((s) => s.symbol).join(", ");
  const tweet = `${insight.title}\n\n${symbols}\n\nMore: ${url}\n\n#NSE #IndianStocks`;
  const twitterHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`;
  const linkedInHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  const waText = `${insight.title} — ${url}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="muted-text">Share this signal:</span>
      <a
        href={twitterHref}
        target="_blank"
        rel="noopener noreferrer"
        className="px-2.5 py-1 rounded-md border font-medium transition-colors hover:bg-[var(--color-paper)]"
        style={{ borderColor: "var(--color-border-default)" }}
      >
        𝕏 / Twitter
      </a>
      <a
        href={linkedInHref}
        target="_blank"
        rel="noopener noreferrer"
        className="px-2.5 py-1 rounded-md border font-medium transition-colors hover:bg-[var(--color-paper)]"
        style={{ borderColor: "var(--color-border-default)" }}
      >
        LinkedIn
      </a>
      <a
        href={waHref}
        target="_blank"
        rel="noopener noreferrer"
        className="px-2.5 py-1 rounded-md border font-medium transition-colors hover:bg-[var(--color-paper)]"
        style={{ borderColor: "var(--color-border-default)" }}
      >
        WhatsApp
      </a>
    </div>
  );
}

function Disclaimer() {
  // Prominent + un-muted so the framing is unmissable.  Sits right above
  // the prev/next nav so anyone scrolling past stocks reads it before
  // leaving the page.  SEBI / regulatory framing — "data + analysis, not
  // advice" — is the line we never blur.
  return (
    <section
      className="mt-8 p-4 rounded-md text-[12.5px] leading-relaxed"
      style={{
        backgroundColor: "color-mix(in srgb, var(--color-delta-down) 6%, transparent)",
        border: "1px solid color-mix(in srgb, var(--color-delta-down) 30%, transparent)",
      }}
    >
      <div
        className="text-[11px] uppercase tracking-wide font-bold mb-2"
        style={{ color: "var(--color-delta-down)" }}
      >
        Not investment advice
      </div>
      <p style={{ color: "var(--color-ink)" }}>
        These stocks are surfaced by a deterministic, peer-relative scoring algorithm
        — <strong>not a recommendation to buy or sell</strong>. Past percentile scores
        do not predict future returns. EquityRoots is <strong>not a SEBI-registered
        investment adviser</strong>. Do your own research and, if you need personalised
        guidance, consult a SEBI-registered investment adviser before transacting.
      </p>
    </section>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Hero({ insight }: { insight: Awaited<ReturnType<typeof loadInsight>> }) {
  const formattedDate = formatNiceDate(insight.date);
  return (
    <header className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] uppercase tracking-wide muted-text font-semibold">
          {insight.isToday ? "Today's Signal" : "Past Signal"}
        </span>
        <span className="muted-text">·</span>
        <span className="text-[11px] tabular-nums muted-text">{formattedDate}</span>
      </div>
      <h1 className="font-display text-[28px] md:text-[34px] leading-tight tracking-tight mb-2">
        {insight.title}
      </h1>
      <p className="muted-text text-[14.5px] leading-relaxed max-w-[640px]">
        {insight.subtitle}
      </p>
    </header>
  );
}

function StockGrid({
  stocks,
}: {
  stocks: Awaited<ReturnType<typeof loadInsight>>["stocks"];
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {stocks.map((s) => (
        <StockCard key={s.symbol} stock={s} />
      ))}
    </div>
  );
}

function StockCard({
  stock,
}: {
  stock: Awaited<ReturnType<typeof loadInsight>>["stocks"][number];
}) {
  const cBand = band(stock.composite_pct);
  const cColor = bandColor(cBand);
  return (
    <Link
      href={`/stock/${stock.symbol}`}
      className="card p-4 group hover:border-[var(--color-accent-300)] transition-colors block"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-[15px] tabular-nums">{stock.symbol}</span>
            <span className="muted-text text-[11.5px]">·</span>
            <span className="text-[11.5px] muted-text">
              {tierLabel(stock.maturity_tier)}
            </span>
          </div>
          <div className="text-[12.5px] muted-text truncate mt-0.5">
            {stock.company_name}
          </div>
          <div className="text-[10.5px] muted-text mt-0.5">
            {stock.sector_name} · {stock.industry_name}
          </div>
        </div>
        {stock.composite_pct != null && (
          <span
            className="inline-block min-w-[42px] text-center px-2 py-1 rounded-md tabular-nums font-semibold text-[14px] shrink-0"
            style={{
              backgroundColor: cColor,
              color: cBand === "neutral" ? "var(--color-ink)" : "white",
            }}
            title="Composite peer-cluster score"
          >
            {Math.round(stock.composite_pct)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-[10.5px] mb-3">
        <Pillar label="Q" value={stock.quality_pct} />
        <Pillar label="V" value={stock.valuation_pct} />
        <Pillar label="M" value={stock.momentum_pct} />
      </div>

      <div className="text-[11px] muted-text tabular-nums flex flex-wrap gap-x-3">
        {stock.current_price != null && (
          <span>
            ₹{stock.current_price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </span>
        )}
        {stock.market_cap_cr != null && (
          <span>
            mcap{" "}
            {stock.market_cap_cr >= 1_00_000
              ? `₹${(stock.market_cap_cr / 1_00_000).toFixed(1)}L Cr`
              : `₹${Math.round(stock.market_cap_cr).toLocaleString("en-IN")} Cr`}
          </span>
        )}
      </div>
    </Link>
  );
}

function Pillar({ label, value }: { label: string; value: number | null }) {
  if (value == null) {
    return (
      <div className="flex flex-col items-center rounded-sm px-2 py-1 hairline border opacity-50">
        <span
          className="text-[9.5px] font-semibold tracking-wider"
          style={{ color: "var(--color-muted)" }}
        >
          {label}
        </span>
        <span className="tabular-nums font-semibold text-[11.5px] muted-text">—</span>
      </div>
    );
  }
  const b = band(value);
  const color = bandColor(b);
  return (
    <div
      className="flex flex-col items-center rounded-sm px-2 py-1 hairline border"
      style={{ borderColor: color }}
    >
      <span
        className="text-[9.5px] font-semibold tracking-wider"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </span>
      <span className="tabular-nums font-semibold text-[11.5px]" style={{ color }}>
        {Math.round(value)}
      </span>
    </div>
  );
}

function MethodologyCallout({
  text, snapshotDate,
}: { text: string; snapshotDate: string | null }) {
  return (
    <aside
      className="mt-8 p-4 rounded-md text-[12.5px] leading-relaxed"
      style={{
        backgroundColor: "var(--color-paper)",
        border: "1px solid var(--color-border-default)",
      }}
    >
      <div className="text-[11px] uppercase tracking-wide muted-text font-semibold mb-2">
        How we picked these
      </div>
      <p style={{ color: "var(--color-ink)" }}>{text}</p>
      {snapshotDate && (
        <p className="muted-text text-[11px] mt-2 tabular-nums">
          Scoring snapshot: {snapshotDate}
        </p>
      )}
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="card p-10 text-center">
      <div className="font-display text-[20px] mb-2">No matches today</div>
      <p className="muted-text text-[13px]">
        The filter for this day didn&apos;t surface any stocks. Check back tomorrow
        — the theme rotates daily.
      </p>
    </div>
  );
}

function PrevNext({
  date, prevDate, nextDate, showNext,
}: { date: string; prevDate: string; nextDate: string; showNext: boolean }) {
  return (
    <nav className="mt-8 pt-6 border-t hairline flex items-center justify-between text-[12.5px]">
      <Link
        href={`/today/${prevDate}`}
        className="muted-text hover:text-[var(--color-accent-700)] transition-colors"
      >
        ← {formatNiceDate(prevDate)}
      </Link>
      <span className="muted-text tabular-nums">{date}</span>
      {showNext ? (
        <Link
          href={`/today/${nextDate}`}
          className="muted-text hover:text-[var(--color-accent-700)] transition-colors"
        >
          {formatNiceDate(nextDate)} →
        </Link>
      ) : (
        <span className="opacity-30 cursor-not-allowed">tomorrow →</span>
      )}
    </nav>
  );
}

function formatNiceDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
