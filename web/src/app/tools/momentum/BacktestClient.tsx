"use client";

/**
 * BacktestClient — the evidence tab. Does the Trend Leaders ruleset actually
 * beat the market, or is it survivorship-biased charting?
 *
 * Honesty is the whole point of this tab:
 *  - When the study hasn't run, it shows the METHODOLOGY and a "not yet run"
 *    banner — never fabricated numbers.
 *  - The headline it will report is win-rate-vs-benchmark, NET of costs, over
 *    matched windows — not gross absolute returns in a bull tape.
 *  - The score-filtered config is quarantined as small-sample (only ~2 months
 *    of point-in-time scores exist), so the tab can't imply the fundamental
 *    filter is proven when it isn't.
 */

import type { BacktestRow } from "@/lib/backtest";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";

function pct(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
function horizonLabel(d: number): string {
  if (d <= 21) return "1M";
  if (d <= 63) return "3M";
  if (d <= 126) return "6M";
  return "12M";
}

function svg(size: number | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size ?? 16} height={size ?? 16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      {children}
    </svg>
  );
}
const IconFlask = ({ size }: { size?: number }) =>
  svg(size, <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" /><path d="M7 15h10" /></>);

export default function BacktestClient({
  runDate,
  rows,
}: {
  runDate: string | null;
  rows: BacktestRow[];
}) {
  const hasResults = rows.length > 0;

  return (
    <>
      <header className="max-w-[720px]">
        <div className="eyebrow mb-3 flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
          >
            <IconFlask size={14} />
          </span>
          Evidence
        </div>
        <h1 className="font-display text-[36px] tracking-tight leading-tight">Backtest</h1>
        <p className="muted-text mt-3 text-[15px] leading-[1.55]">
          Does the Trend Leaders signal actually beat the market, or is the
          FEDERALBNK 5.4&times; just survivorship bias? This tab reports how the{" "}
          <strong>fresh-golden-cross-near-high</strong> rule performed on history —{" "}
          <strong>net of costs</strong>, versus buying the benchmark on the same
          dates. The headline is <em>win-rate vs benchmark</em>, not absolute
          return in a bull tape.
        </p>
      </header>

      {/* The load-bearing caveat, shown whether or not results exist. */}
      <div
        className="mt-6 card p-4 max-w-[820px] text-[13px] leading-[1.55]"
        style={{ borderColor: "color-mix(in srgb, var(--color-score-weak, #b7791f) 45%, transparent)" }}
      >
        <div className="font-medium ink-text mb-1">Read this before trusting any number here</div>
        <p className="muted-text">
          Only the <span className="ink-text font-medium">price rule</span> is
          backtestable over the full 35-year history. The{" "}
          <span className="ink-text font-medium">fundamental score filter</span>{" "}
          — the &ldquo;quality&rdquo; half of the pitch — <span style={{ color: RED }}>cannot be
          validated</span>: point-in-time scores exist for only ~2 months. Any
          score-filtered row is flagged <span className="font-medium">small sample</span>{" "}
          and must not be read as proof the quality filter works.
        </p>
      </div>

      {!hasResults ? (
        <div className="mt-6 card p-8 max-w-[820px]">
          <div className="text-[15px] font-medium">Study not yet run.</div>
          <p className="muted-text mt-2 text-[13.5px] leading-[1.55]">
            The backtest engine (<code className="text-[12px]">scripts/backtest-trend-leaders.py</code>)
            hasn&apos;t been built and run yet. When it has, this tab fills with per-year
            cohorts and horizons. The full methodology — no-lookahead entry at next
            open, delisted names kept, benchmark over matched windows, a 1% round-trip
            cost, and a random-entry null to beat — is specced in{" "}
            <code className="text-[12px]">docs/BACKTEST_TREND_LEADERS.md</code>.
          </p>
          <div className="mt-4 text-[11px] uppercase tracking-wide muted-text mb-2">What it will report</div>
          <ul className="space-y-1.5 text-[13.5px] leading-[1.55]">
            <li><span className="ink-text font-medium">Win-rate vs benchmark</span> — % of signals that beat the market over the same window. The number that matters.</li>
            <li><span className="ink-text font-medium">Excess return</span> — net average minus benchmark, per horizon (1M/3M/6M/12M).</li>
            <li><span className="ink-text font-medium">Per-year cohorts</span> — to expose whether the edge only existed in the 2020–21 melt-up.</li>
            <li><span className="ink-text font-medium">vs random</span> — the same count of random entries on the same dates. Beat this or it&apos;s noise.</li>
          </ul>
        </div>
      ) : (
        <div className="mt-6 card overflow-hidden">
          <div className="px-4 py-2.5 border-b hairline text-[12px] muted-text">
            Study run <span className="ink-text font-medium">{runDate}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b hairline text-[11px] uppercase tracking-wide muted-text">
                  <th className="text-left  px-3 py-2.5">Config</th>
                  <th className="text-left  px-2 py-2.5">Cohort</th>
                  <th className="text-right px-2 py-2.5">Horizon</th>
                  <th className="text-right px-2 py-2.5">N</th>
                  <th className="text-right px-2 py-2.5" title="Net average forward return">Avg</th>
                  <th className="text-right px-2 py-2.5" title="Benchmark over matched windows">Bench</th>
                  <th className="text-right px-2 py-2.5" title="Net average minus benchmark">Excess</th>
                  <th className="text-right px-2 py-2.5" title="% of signals beating the benchmark">Beat %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b hairline hover:bg-[var(--color-paper)] transition-colors">
                    <td className="px-3 py-2.5">
                      {r.config}
                      {r.isSmallSample && (
                        <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded" style={{ color: RED, background: "color-mix(in srgb, var(--color-delta-down, #b00) 10%, transparent)" }}>
                          small sample
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">{r.cohort}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{horizonLabel(r.horizonDays)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums muted-text">{r.signalCount}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: (r.avgRet ?? 0) >= 0 ? GREEN : RED }}>{pct(r.avgRet)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums muted-text">{pct(r.benchmarkRet)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums font-semibold" style={{ color: (r.excessRet ?? 0) >= 0 ? GREEN : RED }}>{pct(r.excessRet)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums font-medium">{r.winRateVsBench == null ? "—" : `${Math.round(r.winRateVsBench)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
