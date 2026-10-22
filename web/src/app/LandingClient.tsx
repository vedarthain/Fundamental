"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Sparkles, TrendingUp, ShieldCheck, Bell } from "lucide-react";

/* =============================================================== SAMPLE STOCK SCORECARD === */

type SampleStock = {
  symbol: string;
  sector: string;
  score: number;
  tier: string;
  quality: number;
  momentum: number;
  valuation: number;
  highlights: string;
};

const SAMPLE_STOCKS: Record<string, SampleStock> = {
  TRENT: {
    symbol: "TRENT",
    sector: "Retail & Apparel",
    score: 88,
    tier: "Top 12%",
    quality: 94,
    momentum: 91,
    valuation: 42,
    highlights: "High capital efficiency and aggressive store roll-out",
  },
  TATAMOTORS: {
    symbol: "TATAMOTORS",
    sector: "Automobiles & Ancillary",
    score: 84,
    tier: "Top 16%",
    quality: 82,
    momentum: 93,
    valuation: 68,
    highlights: "EV domestic market share leader with JLR deleveraging",
  },
  COFORGE: {
    symbol: "COFORGE",
    sector: "IT Services & Software",
    score: 81,
    tier: "Top 19%",
    quality: 89,
    momentum: 78,
    valuation: 51,
    highlights: "Top-tier deal order conversion and operating cash flow",
  },
};

export function SampleScorecard() {
  const [active, setActive] = useState<string>("TRENT");
  const s = SAMPLE_STOCKS[active] ?? SAMPLE_STOCKS.TRENT;

  return (
    <div className="card p-4 sm:p-6 shadow-sm border border-[var(--color-border-default)]">
      {/* Switcher Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b hairline">
        <span className="kbd-label text-[10px]">Sample Peer Scorecard:</span>
        <div className="flex gap-1.5 shrink-0">
          {Object.keys(SAMPLE_STOCKS).map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => setActive(sym)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
                active === sym
                  ? "bg-[var(--color-accent-600)] text-white font-semibold"
                  : "bg-[var(--color-paper)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {sym}
            </button>
          ))}
        </div>
      </div>

      {/* Stock Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-display font-semibold text-[20px] text-[var(--color-ink)]">
              {s.symbol}
            </span>
            <span className="text-[12px] muted-text truncate">{s.sector}</span>
          </div>
          <div className="text-[11px] muted-text mt-0.5 break-words">{s.highlights}</div>
        </div>
        <div
          className="shrink-0 text-center px-3 py-1 rounded-xl border hairline"
          style={{ backgroundColor: "var(--color-paper)" }}
        >
          <div
            className="text-[20px] font-display font-bold leading-none"
            style={{ color: "var(--color-score-excellent)" }}
          >
            {s.score}
          </div>
          <div
            className="text-[9px] font-semibold uppercase mt-0.5"
            style={{ color: "var(--color-score-good)" }}
          >
            {s.tier}
          </div>
        </div>
      </div>

      {/* 3 Pillar Bars */}
      <div className="space-y-2 pt-2 border-t hairline text-[11.5px]">
        <div>
          <div className="flex justify-between items-center gap-2 mb-0.5">
            <span className="muted-text text-[11px] sm:text-[11.5px] truncate">Quality Percentile</span>
            <span
              className="num num-sm font-semibold shrink-0 text-[11px] sm:text-[11.5px]"
              style={{ color: "var(--color-score-excellent)" }}
            >
              {s.quality}th in Peer Group
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-[var(--color-paper)]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${s.quality}%`,
                backgroundColor: "var(--color-score-excellent)",
              }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center gap-2 mb-0.5">
            <span className="muted-text text-[11px] sm:text-[11.5px] truncate">Momentum Percentile</span>
            <span
              className="num num-sm font-semibold shrink-0 text-[11px] sm:text-[11.5px]"
              style={{ color: "var(--color-score-excellent)" }}
            >
              {s.momentum}th in Peer Group
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-[var(--color-paper)]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${s.momentum}%`,
                backgroundColor: "var(--color-score-excellent)",
              }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center gap-2 mb-0.5">
            <span className="muted-text text-[11px] sm:text-[11.5px] truncate">Valuation Percentile</span>
            <span
              className="num num-sm font-semibold shrink-0 text-[11px] sm:text-[11.5px]"
              style={{ color: "var(--color-score-neutral)" }}
            >
              {s.valuation}th in Peer Group
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-[var(--color-paper)]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${s.valuation}%`,
                backgroundColor: "var(--color-score-neutral)",
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-3.5 pt-2.5 border-t hairline flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-accent-600)] font-medium">
        <span>Recomputed weekly · Append-only ledger</span>
        <Link href="/sectors" className="hover:underline flex items-center gap-1 shrink-0">
          Peer Percentiles <ArrowRight size={11} />
        </Link>
      </div>
    </div>
  );
}

/* =============================================================== WORKSPACE PREVIEW === */

export function WorkspacePreview() {
  const [mobileTab, setMobileTab] = useState<"portfolio" | "watchlist">("portfolio");

  return (
    <section className="border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 sm:py-12 md:py-16">
        <div className="text-center max-w-[640px] mx-auto mb-10">
          <div className="eyebrow mb-2.5">Your Personal Workspace</div>
          <h2 className="font-display" style={{ fontSize: "clamp(28px, 3.5vw, 42px)", lineHeight: 1.05 }}>
            Diagnose your holdings, <em className="accent">not just tickers.</em>
          </h2>
          <p className="muted-text mt-3 text-[14.5px] leading-[1.55] max-w-[540px] mx-auto">
            Import your Zerodha, Upstox, or CSV tradebook to evaluate your personal portfolio on
            true sector percentiles, with automated risk alerts.
          </p>
        </div>

        {/* Mobile View: Segmented Switcher (<lg) */}
        <div className="lg:hidden max-w-[480px] mx-auto">
          <div
            className="p-1 rounded-xl flex gap-1 mb-3 border hairline"
            style={{ backgroundColor: "var(--color-card)" }}
          >
            <button
              type="button"
              onClick={() => setMobileTab("portfolio")}
              className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                mobileTab === "portfolio"
                  ? "bg-[var(--color-accent-600)] text-white font-semibold shadow-xs"
                  : "muted-text hover:text-[var(--color-ink)]"
              }`}
            >
              💼 Portfolio Health
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("watchlist")}
              className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                mobileTab === "watchlist"
                  ? "bg-[var(--color-accent-600)] text-white font-semibold shadow-xs"
                  : "muted-text hover:text-[var(--color-ink)]"
              }`}
            >
              ⭐ Watchlists &amp; Alerts
            </button>
          </div>

          {mobileTab === "portfolio" ? <PortfolioCard /> : <WatchlistCard />}
        </div>

        {/* Desktop View: Side-by-Side Dual Diagnostic (lg+) */}
        <div className="hidden lg:grid grid-cols-2 gap-6">
          <PortfolioCard />
          <WatchlistCard />
        </div>

        {/* What You Unlock Banner */}
        <div
          className="mt-8 max-w-[960px] mx-auto card p-4 sm:p-5 md:p-6 border border-[var(--color-border-default)] shadow-xs"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-5 h-5 rounded-full bg-[var(--color-accent-50)] text-[var(--color-accent-600)] flex items-center justify-center text-[11px] font-bold">
                  ✓
                </span>
                <h4 className="font-semibold text-[14px]">What You Unlock With A Free Account</h4>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] muted-text mt-1">
                <span>• 1-Click tradebook sync (Zerodha, Upstox, CSV)</span>
                <span>• Automated holding risk &amp; margin alerts</span>
                <span>• Custom watchlists &amp; thesis notes</span>
              </div>
            </div>
            <Link
              href="/signup"
              className="btn-primary shrink-0 text-center whitespace-nowrap text-[13px]"
            >
              Create Free Account
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function PortfolioCard() {
  return (
    <article className="card p-4 sm:p-5 flex flex-col justify-between shadow-xs border hairline">
      <div>
        <div className="flex items-start justify-between gap-2 mb-3 pb-3 border-b hairline">
          <div>
            <div className="kbd-label text-[10px]">Portfolio Health Score</div>
            <div className="flex items-baseline gap-2 mt-1 flex-wrap">
              <span className="text-[26px] font-display font-bold num text-[var(--color-ink)]">
                82 <span className="text-[14px] font-normal muted-text">/ 100</span>
              </span>
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full border hairline shrink-0"
                style={{
                  backgroundColor: "var(--color-paper)",
                  color: "var(--color-score-excellent)",
                }}
              >
                Top 18% Quality
              </span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="kbd-label text-[10px]">Holdings</div>
            <div className="text-[13px] font-semibold mt-1">14 Stocks</div>
          </div>
        </div>

        <div className="space-y-2.5 mb-4 text-[12px]">
          <div>
            <div className="flex justify-between items-center gap-2 mb-1">
              <span className="muted-text truncate">Weighted Quality</span>
              <span className="num font-semibold shrink-0" style={{ color: "var(--color-score-excellent)" }}>
                88th percentile
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden bg-[var(--color-paper)]">
              <div
                className="h-full rounded-full"
                style={{ width: "88%", backgroundColor: "var(--color-score-excellent)" }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center gap-2 mb-1">
              <span className="muted-text truncate">Weighted Momentum</span>
              <span className="num font-semibold shrink-0" style={{ color: "var(--color-score-excellent)" }}>
                74th percentile
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden bg-[var(--color-paper)]">
              <div
                className="h-full rounded-full"
                style={{ width: "74%", backgroundColor: "var(--color-score-good)" }}
              />
            </div>
          </div>
        </div>

        <div
          className="rounded-xl p-3 divide-y hairline text-[12px]"
          style={{ backgroundColor: "var(--color-paper)" }}
        >
          <div className="py-1.5 flex justify-between items-center gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold shrink-0">TRENT</span>
              <span className="text-[11px] muted-text truncate">Retail &amp; Apparel (18% wt)</span>
            </div>
            <span className="num font-semibold shrink-0 text-right" style={{ color: "var(--color-score-excellent)" }}>
              Score: 88 ★
            </span>
          </div>
          <div className="py-1.5 flex justify-between items-center gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold shrink-0">HDFCBANK</span>
              <span className="text-[11px] muted-text truncate">Private Bank (14% wt)</span>
            </div>
            <span className="num font-semibold shrink-0 text-right" style={{ color: "var(--color-score-good)" }}>
              Score: 78 ★
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t hairline flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[var(--color-accent-600)] font-medium">
        <span className="text-[11px] leading-tight">1-Click tradebook sync via Zerodha, Upstox &amp; CSV</span>
        <Link href="/signup" className="hover:underline flex items-center gap-1 shrink-0">
          Sync Book <ArrowRight size={11} />
        </Link>
      </div>
    </article>
  );
}

function WatchlistCard() {
  return (
    <article className="card p-4 sm:p-5 flex flex-col justify-between shadow-xs border hairline">
      <div>
        <div className="flex items-start justify-between gap-2 mb-3 pb-3 border-b hairline">
          <div>
            <div className="kbd-label text-[10px]">Saved Watchlist &amp; Alerts</div>
            <div className="text-[16px] font-display font-semibold mt-1">Core Compounders (8)</div>
          </div>
          <span
            className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border hairline shrink-0"
            style={{
              backgroundColor: "var(--color-paper)",
              color: "var(--color-score-excellent)",
            }}
          >
            2 ACTIVE ALERTS
          </span>
        </div>

        <div className="divide-y hairline text-[12px] mb-4">
          <div className="py-2.5 flex justify-between items-center gap-2">
            <div className="min-w-0">
              <div className="font-semibold flex items-center gap-2 flex-wrap">
                <span>NORTHARC</span>
                <span
                  className="kbd-label px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: "var(--color-accent-50)",
                    color: "var(--color-accent-600)",
                  }}
                >
                  ALERT
                </span>
              </div>
              <div className="text-[11px] muted-text mt-0.5 line-clamp-1">
                Promoter accumulating shares in latest quarter
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="num font-semibold" style={{ color: "var(--color-score-excellent)" }}>
                83 <span className="text-[10px]">(+12)</span>
              </div>
              <div className="text-[10px] muted-text num">Top 17% in NBFC</div>
            </div>
          </div>

          <div className="py-2.5 flex justify-between items-center gap-2">
            <div className="min-w-0">
              <div className="font-semibold flex items-center gap-2 flex-wrap">
                <span>APTUS</span>
                <span
                  className="kbd-label px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: "var(--color-accent-50)",
                    color: "var(--color-accent-600)",
                  }}
                >
                  SUPPORT
                </span>
              </div>
              <div className="text-[11px] muted-text mt-0.5 line-clamp-1">
                High RoE business trading near 52W support floor
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="num font-semibold" style={{ color: "var(--color-score-excellent)" }}>
                76 <span className="text-[10px]">(+5)</span>
              </div>
              <div className="text-[10px] muted-text num">Top 24% in Housing</div>
            </div>
          </div>
        </div>

        <div
          className="p-3 rounded-xl flex items-center justify-between text-[11.5px] border hairline"
          style={{ backgroundColor: "var(--color-paper)" }}
        >
          <div className="flex items-center gap-2">
            <Bell size={13} className="shrink-0" style={{ color: "var(--color-accent-600)" }} />
            <span className="muted-text text-[11px] sm:text-[11.5px]">
              Automated price, promoter, and earnings alerts for all saved names.
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t hairline flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[var(--color-accent-600)] font-medium">
        <span>Never miss an inflection point</span>
        <Link href="/signup" className="hover:underline flex items-center gap-1 shrink-0">
          Save Watchlists <ArrowRight size={11} />
        </Link>
      </div>
    </article>
  );
}

/* =============================================================== THREE PILLARS TABS === */

export function ThreePillarsSegmented() {
  const [pillar, setPillar] = useState<"quality" | "valuation" | "momentum">("quality");

  const PILLARS = {
    quality: {
      n: "01",
      color: "var(--color-accent-600)",
      name: "Quality",
      tagline: "Does this business compound?",
      body: "Returns on capital, multi-year growth, cash conversion, balance-sheet discipline — built to spot durable economics over a single good year.",
      metrics: [
        { label: "RoE (8-yr)", val: "24.5%" },
        { label: "CFO / EBITDA", val: "88%" },
        { label: "Debt / Equity", val: "0.05x" },
      ],
    },
    valuation: {
      n: "02",
      color: "var(--color-score-excellent)",
      name: "Valuation",
      tagline: "Are we paying a fair price?",
      body: "P/E, P/B, EV/EBITDA, FCF yield — always relative to peers in the same sector. A 25× P/E in pharma means nothing like a 25× P/E in cement.",
      metrics: [
        { label: "Peer Median", val: "28.0x" },
        { label: "Stock P/E", val: "21.0x" },
        { label: "Discount", val: "-25%" },
      ],
    },
    momentum: {
      n: "03",
      color: "var(--color-score-weak)",
      name: "Momentum",
      tagline: "Is the market noticing yet?",
      body: "3, 6, 12-month relative price returns blended with latest-quarter earnings momentum — separates hype from fundamentals turning.",
      metrics: [
        { label: "3M Return", val: "+8.4%" },
        { label: "6M Return", val: "+19.2%" },
        { label: "RS Rank", val: "92 / 100" },
      ],
    },
  };

  const curr = PILLARS[pillar];

  return (
    <section className="border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 sm:py-12 md:py-16">
        <div className="text-center max-w-[640px] mx-auto mb-10">
          <div className="eyebrow mb-2.5">How We Evaluate</div>
          <h2 className="font-display" style={{ fontSize: "clamp(28px, 3.5vw, 42px)", lineHeight: 1.05 }}>
            Three pillars. <em className="accent">One ranking.</em>
          </h2>
          <p className="muted-text mt-3 text-[14.5px] leading-[1.55] max-w-[540px] mx-auto">
            The way an analyst would actually think about a business — not a dump of every ratio in the book.
          </p>
        </div>

        {/* Mobile View: Segmented Pill (<md) */}
        <div className="md:hidden max-w-[480px] mx-auto">
          <div
            className="p-1 rounded-xl flex gap-1 mb-3 border hairline"
            style={{ backgroundColor: "var(--color-card)" }}
          >
            {(["quality", "valuation", "momentum"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPillar(k)}
                className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium capitalize transition-colors ${
                  pillar === k
                    ? "bg-[var(--color-accent-600)] text-white font-semibold shadow-xs"
                    : "muted-text hover:text-[var(--color-ink)]"
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          <article
            className="card p-4 sm:p-5 flex flex-col"
            style={{ borderTop: `3px solid ${curr.color}` }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="ntag text-[24px]">{curr.n}</span>
              <span className="font-display text-[19px]" style={{ color: curr.color }}>
                {curr.name}
              </span>
            </div>
            <div className="muted-text italic text-[12px] mt-0.5">{curr.tagline}</div>
            <p className="muted-text mt-2.5 text-[13px] leading-[1.55]">{curr.body}</p>

            <div
              className="mt-4 p-3 rounded-xl grid grid-cols-3 text-center border hairline gap-1"
              style={{ backgroundColor: "var(--color-paper)" }}
            >
              {curr.metrics.map((m) => (
                <div key={m.label} className="min-w-0">
                  <div className="kbd-label text-[8.5px] sm:text-[9px] truncate">{m.label}</div>
                  <div
                    className="num num-sm font-semibold mt-0.5 text-[11.5px] sm:text-[13px]"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {m.val}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>

        {/* Desktop View: 3 Columns Parallel (md+) */}
        <div className="hidden md:grid gap-4 grid-cols-3">
          {(["quality", "valuation", "momentum"] as const).map((k) => {
            const p = PILLARS[k];
            return (
              <article
                key={k}
                className="card p-5 flex flex-col justify-between"
                style={{ borderTop: `3px solid ${p.color}` }}
              >
                <div>
                  <div className="ntag text-[26px]">{p.n}</div>
                  <h3 className="font-display mt-1 text-[21px]" style={{ color: p.color }}>
                    {p.name}
                  </h3>
                  <div className="muted-text italic text-[12.5px] mt-0.5">{p.tagline}</div>
                  <p className="muted-text mt-3 text-[13px] leading-[1.55]">{p.body}</p>
                </div>

                <div
                  className="mt-5 p-3 rounded-xl grid grid-cols-3 text-center border hairline"
                  style={{ backgroundColor: "var(--color-paper)" }}
                >
                  {p.metrics.map((m) => (
                    <div key={m.label}>
                      <div className="kbd-label text-[9px]">{m.label}</div>
                      <div
                        className="num num-sm font-semibold mt-0.5"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {m.val}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* =============================================================== RESPONSIVE SECTOR RAIL === */

type IndustryTile = {
  industry_id: string;
  industry_name: string;
  avg_composite: number | null;
};

export function ResponsiveSectorHeatmap({ tiles }: { tiles: IndustryTile[] }) {
  const SHOW = 15;
  const visible = tiles.slice(0, SHOW);

  return (
    <section className="relative overflow-hidden border-t hairline" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 sm:py-12 md:py-16">
        {/* Mobile View: Horizontal Swipe Rail (<lg) */}
        <div className="lg:hidden">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="eyebrow mb-1">46 Peer Groups</div>
              <h3 className="font-display text-[22px] font-semibold text-[var(--color-ink)]">
                Sector Heatmap
              </h3>
            </div>
            <Link
              href="/sectors"
              className="text-[12px] font-medium text-[var(--color-accent-600)] flex items-center gap-1 hover:underline"
            >
              All 46 <ArrowRight size={12} />
            </Link>
          </div>

          <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-4 sm:-mx-6 px-4 sm:px-6">
            {visible.slice(0, 8).map((t) => {
              const v = Math.round(t.avg_composite ?? 50);
              const scoreBg =
                v >= 75
                  ? "var(--color-score-excellent)"
                  : v >= 65
                  ? "var(--color-score-good)"
                  : v >= 50
                  ? "var(--color-score-neutral)"
                  : "var(--color-score-weak)";
              return (
                <Link
                  key={t.industry_id}
                  href={`/industry/${t.industry_id}`}
                  className="shrink-0 w-36 card p-3 flex flex-col justify-between shadow-2xs hover:border-[var(--color-accent-400)] transition-colors"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="kbd-label text-[9px]">PEER GROUP</span>
                    <span
                      className="num num-sm font-bold px-1.5 py-0.5 rounded text-white"
                      style={{ backgroundColor: scoreBg }}
                    >
                      {v}
                    </span>
                  </div>
                  <div className="text-[12.5px] font-semibold text-[var(--color-ink)] leading-snug line-clamp-2 mt-1">
                    {t.industry_name}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Desktop View: Full 2-Column Split (lg+) */}
        <div className="hidden lg:grid grid-cols-12 gap-10 items-center">
          <div className="col-span-6">
            <div className="eyebrow mb-3">46 Peer Groups</div>
            <h2
              className="font-display"
              style={{ fontSize: "clamp(28px, 3.5vw, 42px)", lineHeight: 1.05 }}
            >
              The whole market,<br />
              <em className="accent">torn open.</em>
            </h2>
            <p className="muted-text mt-4 text-[14.5px] leading-[1.6] max-w-[420px]">
              {tiles.length} peer groups — every single one ranked weekly within its sector. Greens
              compound. Reds need a closer look.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Link href="/sectors" className="btn-primary">
                Open all sectors
                <ArrowRight size={14} />
              </Link>
              <span className="muted-text text-[13px]">
                <span className="num font-semibold text-[var(--color-ink)]">
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

          <div className="col-span-6 relative w-full max-w-[380px] ml-auto">
            <div
              className="relative"
              style={{
                WebkitMaskImage:
                  "linear-gradient(180deg, #000 0%, #000 60%, rgba(0,0,0,.45) 80%, transparent 100%)",
                maskImage:
                  "linear-gradient(180deg, #000 0%, #000 60%, rgba(0,0,0,.45) 80%, transparent 100%)",
              }}
            >
              <div className="grid gap-1.5 grid-cols-5">
                {visible.map((t) => {
                  const v = Math.round(t.avg_composite ?? 50);
                  const scoreBg =
                    v >= 75
                      ? "var(--color-score-excellent)"
                      : v >= 65
                      ? "var(--color-score-good)"
                      : v >= 50
                      ? "var(--color-score-neutral)"
                      : "var(--color-score-weak)";
                  const numColor = v >= 50 && v < 65 ? "var(--color-ink)" : "#fff";
                  return (
                    <Link
                      key={t.industry_id}
                      href={`/industry/${t.industry_id}`}
                      className="heat-tile rounded-[5px] flex flex-col items-center justify-center p-1 text-center"
                      title={`${t.industry_name} · ${v}`}
                      style={{
                        aspectRatio: "1 / 1",
                        background: scoreBg,
                        boxShadow: "0 1px 3px rgba(25,25,25,.08)",
                      }}
                    >
                      <span
                        className="font-display tabular-nums leading-none font-medium text-[15px]"
                        style={{ color: numColor }}
                      >
                        {v}
                      </span>
                      <span
                        className="leading-tight tracking-wide font-medium truncate w-full mt-0.5 text-[7.5px]"
                        style={{ color: numColor, opacity: 0.86 }}
                      >
                        {t.industry_name}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <Link
              href="/sectors"
              className="absolute z-10 inline-flex items-center gap-2 card shadow-md hover:border-[var(--color-accent-400)] transition-colors"
              style={{
                left: "50%",
                bottom: -10,
                transform: "translateX(-50%)",
                padding: "7px 14px",
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              <span className="num font-semibold">
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
