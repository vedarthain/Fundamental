"use client";

/**
 * PortfolioClient — the interactive portfolio dashboard.
 *
 * Server hands down a fully-valued `Portfolio` + forward-only equity `curve`;
 * this component only renders + handles the import upload (which triggers a
 * router.refresh() so the server re-values with the new broker's rows).
 *
 * Layout: import panel → summary cards → equity curve vs NIFTY 500 →
 * allocation donuts (broker / sector) → per-instrument holdings table with
 * cross-broker drill-down and the Q/V/M scoring overlay for mapped equities.
 */

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, ScatterChart, Scatter, ZAxis, ReferenceLine,
} from "recharts";
import type { Portfolio, Instrument, CurvePoint, RealizedPnl, RealizedLot, PerformanceStats, RealizedTimeline } from "@/lib/portfolio";

const BROKERS = [
  { value: "upstox", label: "Upstox" },
  { value: "zerodha", label: "Zerodha" },
  { value: "fyers", label: "Fyers" },
  { value: "fivepaisa", label: "5paisa" },
  { value: "groww", label: "Groww" },
] as const;

const DONUT_COLORS = [
  "#1E2761", "#2F6FED", "#15803D", "#B45309", "#7C3AED",
  "#0891B2", "#DC2626", "#65A30D", "#DB2777", "#525252",
];

// ── formatting helpers (Indian grouping) ──
function inr(v: number | null, dp = 0): string {
  if (v == null) return "—";
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function signed(v: number | null, dp = 0): string {
  if (v == null) return "—";
  const s = v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (v >= 0 ? "+₹" : "-₹") + s.replace("-", "");
}
function pct(v: number | null): string {
  if (v == null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}
function up(v: number | null): boolean {
  return (v ?? 0) >= 0;
}
const GREEN = "var(--color-delta-up, #15803D)";
const RED = "var(--color-delta-down, #DC2626)";

type ImportKind = "holdings" | "trades";

type ImportResult = {
  ok?: boolean;
  kind?: ImportKind;
  brokerLabel?: string;
  // holdings-snapshot fields
  imported?: number;
  mapped?: number;
  unmapped?: number;
  unmappedSymbols?: string[];
  // tradebook fields
  parsed?: number;
  skipped?: number;
  mappedSymbols?: number;
  outsideCoverage?: string[];
  dateRange?: { from: string; to: string } | null;
  error?: string;
};

type PortfolioTab = "overview" | "holdings" | "performance" | "transactions" | "booked";

export function PortfolioClient({
  portfolio,
  curve,
  realized,
  owner = false,
  perf = null,
  timeline = null,
}: {
  portfolio: Portfolio;
  curve: CurvePoint[];
  realized: RealizedPnl;
  owner?: boolean; // gates the (personal, owner-only) Performance analysis tab
  perf?: PerformanceStats | null; // time-weighted stats (owner-only)
  timeline?: RealizedTimeline | null; // realized-over-time analytics (owner-only)
}) {
  const router = useRouter();
  const [tab, setTab] = useState<PortfolioTab>("overview");
  const [broker, setBroker] = useState<string>("zerodha");
  const [kind, setKind] = useState<ImportKind>("holdings");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setResult({ error: `Choose a ${kind === "trades" ? "tradebook" : "holdings"} file first.` });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("broker", broker);
      fd.append("file", file);
      const endpoint = kind === "trades" ? "/api/portfolio/import-trades" : "/api/portfolio/import";
      const r = await fetch(endpoint, { method: "POST", body: fd, credentials: "include" });
      const data: ImportResult = await r.json();
      if (!r.ok) {
        setResult({ error: data.error ?? `Import failed (HTTP ${r.status})` });
      } else {
        setResult({ ...data, kind });
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch {
      setResult({ error: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  }

  const t = portfolio.totals;

  return (
    <>
      <header className="mb-4">
        <h1 className="font-display text-[26px] md:text-[30px] leading-[1.1] tracking-tight">
          Your portfolio
        </h1>
        <p className="muted-text text-[13px] mt-1">
          Holdings imported from your brokers, re-priced live and scored on Q/V/M.
          Current holdings only — values derived at read time, not tax-accurate.
        </p>
      </header>

      {/* Overview (holdings) vs Booked P&L (realized from the trade log). */}
      <div className="flex items-center gap-1 border-b hairline mb-5">
        {([
          { v: "overview", label: "Overview" },
          { v: "holdings", label: "Holdings" },
          { v: "performance", label: "Performance" },
          { v: "transactions", label: "Transactions" },
          { v: "booked", label: "Booked P&L" },
        ] as const)
          .filter((o) => owner || o.v !== "performance")
          .map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setTab(o.v)}
            className="relative px-3 py-2 text-[13px] font-medium transition-colors"
            style={{ color: tab === o.v ? "var(--color-accent-700)" : "var(--color-muted)" }}
          >
            {o.label}
            {o.v === "holdings" && portfolio.hasHoldings && (
              <span className="ml-1.5 text-[11px] tabular-nums muted-text">
                {portfolio.instruments.length}
              </span>
            )}
            {o.v === "booked" && realized.rows.length > 0 && (
              <span className="ml-1.5 text-[11px] tabular-nums" style={{ color: up(realized.totals.realized) ? GREEN : RED }}>
                {signed(realized.totals.realized)}
              </span>
            )}
            {tab === o.v && (
              <span className="absolute left-0 right-0 -bottom-px h-[2px]" style={{ background: "var(--color-accent-600)" }} />
            )}
          </button>
        ))}
      </div>

      {tab === "booked" ? (
        <BookedPnl realized={realized} />
      ) : tab === "holdings" ? (
        !portfolio.hasHoldings ? (
          <div className="card p-8 text-center mt-6">
            <h2 className="font-display text-[20px] mb-2">No holdings yet</h2>
            <p className="muted-text text-[13px] max-w-md mx-auto">
              Import a holdings export on the Transactions tab to see every position valued,
              scored and sortable here.
            </p>
          </div>
        ) : (
          <HoldingsSheets instruments={portfolio.instruments} totalValue={t.currentValue} />
        )
      ) : tab === "performance" && owner ? (
        !portfolio.hasHoldings && realized.rows.length === 0 ? (
          <div className="card p-8 text-center mt-6">
            <h2 className="font-display text-[20px] mb-2">Nothing to analyse yet</h2>
            <p className="muted-text text-[13px] max-w-md mx-auto">
              Import holdings or a tradebook on the Transactions tab — this view then decomposes
              where your P&amp;L came from and how your capital sits across score quality.
            </p>
          </div>
        ) : (
          <PerformanceTab portfolio={portfolio} realized={realized} perf={perf} timeline={timeline} />
        )
      ) : tab === "transactions" ? (
        <>
          <ImportPanel
            broker={broker}
            setBroker={setBroker}
            kind={kind}
            setKind={setKind}
            busy={busy}
            result={result}
            fileRef={fileRef}
            onUpload={onUpload}
            brokers={portfolio.brokers}
          />

          <ManualTradePanel onChanged={() => router.refresh()} />
        </>
      ) : (
        <>
          {!portfolio.hasHoldings ? (
            <div className="card p-8 text-center mt-6">
              <h2 className="font-display text-[20px] mb-2">No holdings yet</h2>
              <p className="muted-text text-[13px] max-w-md mx-auto">
                Head to the Transactions tab to import a broker holdings export or log a
                manual trade — your portfolio is then valued, allocated and scored here.
              </p>
            </div>
          ) : (
            <>
              <SummaryCards t={t} snapshot={portfolio.snapshotDate} />
              <EquityCurve curve={curve} />
              <div className="grid md:grid-cols-2 gap-4 mt-6">
                <Donut title="By broker" data={portfolio.brokerAlloc} total={t.currentValue} />
                <Donut title="By sector" data={portfolio.sectorAlloc} total={t.currentValue} />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

// ─────────────────────────── performance (analysis) ────────────────────────

// A descriptive analytics view over the *current* holdings + realized log.
// No advice, no forward projections — every number is a decomposition of what
// the book already is: where the P&L came from (attribution) and how the money
// is distributed across score quality. All client-side on props already loaded.

function PerformanceTab({ portfolio, realized, perf, timeline }: { portfolio: Portfolio; realized: RealizedPnl; perf?: PerformanceStats | null; timeline?: RealizedTimeline | null }) {
  const { instruments, totals } = portfolio;

  // Split once: scored equities carry Q/V/M; unmapped (ETFs/funds) are excluded
  // from every quality calc and surfaced only as an honest coverage caveat.
  const mapped = instruments.filter((i) => i.isMapped && i.composite != null);
  const mappedValue = mapped.reduce((s, i) => s + i.currentValue, 0);

  // ── Zone 0 headline numbers ──
  const unrealized = instruments.reduce((s, i) => s + i.pnl, 0);
  const realizedTotal = realized.totals.realized;
  const lifetimePnl = unrealized + realizedTotal;

  // Value-weighted composite over scored capital (0 when nothing scoreable).
  const bookQuality =
    mappedValue > 0
      ? mapped.reduce((s, i) => s + (i.composite ?? 0) * i.currentValue, 0) / mappedValue
      : null;
  const coverage = totals.currentValue > 0 ? (mappedValue / totals.currentValue) * 100 : 0;

  // Gain concentration: how much of the *positive* unrealized P&L sits in the top 5.
  const gainers = instruments.filter((i) => i.pnl > 0).sort((a, b) => b.pnl - a.pnl);
  const totalGain = gainers.reduce((s, i) => s + i.pnl, 0);
  const top5Gain = gainers.slice(0, 5).reduce((s, i) => s + i.pnl, 0);
  const concentration = totalGain > 0 ? (top5Gain / totalGain) * 100 : null;

  return (
    <div className="space-y-6">
      {/* Zone 0 — headline strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          label="Lifetime P&L"
          value={signed(lifetimePnl)}
          valueColor={up(lifetimePnl) ? GREEN : RED}
          sub={`${signed(unrealized)} open · ${signed(realizedTotal)} booked`}
          icon={<IconTrendUp size={15} />}
          accent={up(lifetimePnl) ? GREEN : RED}
        />
        <Card
          label="Book quality"
          value={bookQuality != null ? fmtScore(bookQuality) : "—"}
          sub="value-weighted composite"
          icon={<IconPulse size={15} />}
        />
        <Card
          label="Scored coverage"
          value={`${coverage.toFixed(0)}%`}
          sub={`${inr(mappedValue)} of ${inr(totals.currentValue)}`}
          icon={<IconPie size={15} />}
        />
        <Card
          label="Gain concentration"
          value={concentration != null ? `${concentration.toFixed(0)}%` : "—"}
          sub="top 5 share of gains"
          icon={<IconLayers size={15} />}
        />
      </div>

      {/* Time-weighted return model + benchmark (owner-only) */}
      {perf && <ReturnModel perf={perf} />}

      {/* Realized performance over time — the honest long-run trader view */}
      {timeline && <RealizedTimelinePanel timeline={timeline} />}

      {/* Discipline desk — rule triggers with plain calls to action (owner-only) */}
      <DisciplineDesk instruments={instruments} />

      {/* Zone A — attribution */}
      <WinnersLosers instruments={instruments} />
      <SectorContribution instruments={instruments} mappedValue={mappedValue} />
      {realized.rows.length > 0 && <RealizedLeaders realized={realized} />}

      {/* Zone B — quality */}
      <QualityDistribution mapped={mapped} mappedValue={mappedValue} totalValue={totals.currentValue} />
      <ConvictionCheck mapped={mapped} mappedValue={mappedValue} />
    </div>
  );
}

// Realized performance over time — booked P&L by month + trade-quality stats,
// derived purely from CLOSED trades (the trade log's one trustworthy signal).
// Deliberately NOT a portfolio value curve: the log's position history is
// incomplete, so we only analyse exits that matched a real cost basis.
function RealizedTimelinePanel({ timeline }: { timeline: RealizedTimeline }) {
  const { months, scatter, stats } = timeline;
  const s = stats;
  const statCards = [
    { label: "Win rate", value: s.winRate != null ? `${s.winRate.toFixed(0)}%` : "—", color: "var(--color-fg)" },
    { label: "Closed trades", value: `${s.closedTrades}`, sub: `${s.closedSymbols} symbols`, color: "var(--color-fg)" },
    { label: "Avg winner", value: s.avgWinPct != null ? pct(s.avgWinPct) : "—", color: GREEN },
    { label: "Avg loser", value: s.avgLossPct != null ? pct(s.avgLossPct) : "—", color: RED },
    { label: "Avg hold", value: s.avgHoldDays != null ? `${s.avgHoldDays}d` : "—", color: "var(--color-muted)" },
    {
      label: "Best / worst",
      value: `${s.bestTrade ? signed(s.bestTrade.realized) : "—"}`,
      sub: s.worstTrade ? signed(s.worstTrade.realized) : undefined,
      color: GREEN, subColor: RED, small: true,
    },
  ];
  return (
    <div className="card p-4 md:p-5">
      <SectionHead
        icon={<IconTrendUp size={15} />}
        title="Realized performance over time"
        right={
          <span className="text-[11px] muted-text">
            {s.firstSell} → {s.lastSell}
          </span>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3 mb-4">
        {statCards.map((c) => (
          <div key={c.label}>
            <div className="text-[10.5px] font-semibold muted-text uppercase tracking-wide leading-tight">{c.label}</div>
            <div className={`tabular-nums font-semibold mt-0.5 ${c.small ? "text-[14px]" : "text-[17px]"}`} style={{ color: c.color }}>
              {c.value}
            </div>
            {c.sub && (
              <div className="text-[11px] tabular-nums" style={{ color: c.subColor ?? "var(--color-muted)" }}>{c.sub}</div>
            )}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Monthly booked P&L */}
        <div>
          <div className="text-[11px] font-semibold muted-text uppercase tracking-wide mb-2">Booked P&amp;L by month</div>
          <div style={{ width: "100%", height: 210 }}>
            <ResponsiveContainer>
              <BarChart data={months} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" opacity={0.4} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} minTickGap={12} />
                <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={(v) => inr(Number(v))} />
                <Tooltip
                  formatter={(v) => [signed(Number(v)), "Booked"]}
                  labelFormatter={(l) => String(l)}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <ReferenceLine y={0} stroke="var(--color-border-default)" />
                <Bar dataKey="realized" radius={[2, 2, 0, 0]}>
                  {months.map((m) => (
                    <Cell key={m.month} fill={m.realized >= 0 ? GREEN : RED} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Hold-period vs return scatter */}
        <div>
          <div className="text-[11px] font-semibold muted-text uppercase tracking-wide mb-2">
            Hold period vs return {scatter.length > 0 && <span className="normal-case">({scatter.length} symbols)</span>}
          </div>
          {scatter.length === 0 ? (
            <p className="muted-text text-[12px]">No closed trades with a datable buy→sell span yet.</p>
          ) : (
            <div style={{ width: "100%", height: 210 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" opacity={0.4} />
                  <XAxis
                    type="number" dataKey="holdingDays" name="Hold (days)"
                    tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}d`}
                  />
                  <YAxis
                    type="number" dataKey="realizedPct" name="Return"
                    tick={{ fontSize: 10 }} width={40} tickFormatter={(v) => `${v}%`}
                  />
                  <ZAxis type="number" dataKey="realized" range={[24, 260]} name="P&L" />
                  <ReferenceLine y={0} stroke="var(--color-border-default)" />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v, n) => [n === "Return" ? `${Number(v).toFixed(1)}%` : n === "P&L" ? signed(Number(v)) : `${v}d`, String(n)]}
                    labelFormatter={() => ""}
                  />
                  <Scatter data={scatter}>
                    {scatter.map((p) => (
                      <Cell key={p.symbol} fill={p.realizedPct >= 0 ? GREEN : RED} fillOpacity={0.55} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <p className="muted-text text-[11px] mt-3 leading-snug">
        Closed trades only, average-cost matched — the same engine as Booked P&amp;L. This is NOT a
        portfolio value curve: your trade log&apos;s position history is incomplete (early buys pre-date
        it), so a reconstructed net-worth curve would be fabricated. Win rate is per sell event; average
        winner/loser and hold period are per symbol with a known cost basis.
      </p>
    </div>
  );
}

// Return model — time-weighted return (flow-neutralised) vs NIFTY 500 over the
// snapshot window, with the risk stats that make a return figure trustworthy:
// max drawdown, annualised vol, best/worst day. The window is forward-only from
// the first snapshot — stated plainly so the number is never mistaken for the
// full trade history.
function ReturnModel({ perf }: { perf: PerformanceStats }) {
  const twrUp = perf.twrPct >= 0;
  const alphaUp = (perf.alphaPct ?? 0) >= 0;
  const stats = [
    { label: "Time-weighted return", value: pct(perf.twrPct), color: twrUp ? GREEN : RED, big: true },
    { label: "NIFTY 500 (same window)", value: perf.niftyPct != null ? pct(perf.niftyPct) : "—", color: "var(--color-fg)" },
    {
      label: "Alpha vs NIFTY",
      value: perf.alphaPct != null ? pct(perf.alphaPct) : "—",
      color: perf.alphaPct == null ? "var(--color-fg)" : alphaUp ? GREEN : RED,
      big: true,
    },
    { label: "Max drawdown", value: `${perf.maxDrawdownPct.toFixed(1)}%`, color: RED },
    { label: "Volatility (ann.)", value: perf.volPct != null ? `${perf.volPct.toFixed(1)}%` : "—", color: "var(--color-muted)" },
    { label: "Best / worst day", value: `${pct(perf.bestDayPct)} / ${pct(perf.worstDayPct)}`, color: "var(--color-muted)", small: true },
  ];
  const hasNifty = perf.index.some((p) => p.niftyIdx != null);
  return (
    <div className="card p-4 md:p-5">
      <SectionHead
        icon={<IconChart size={15} />}
        title="Return model"
        right={
          <span className="text-[11px] muted-text">
            since {perf.startDate} · {perf.points} snapshots
          </span>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3 mb-4">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-[10.5px] font-semibold muted-text uppercase tracking-wide leading-tight">{s.label}</div>
            <div
              className={`tabular-nums font-semibold mt-0.5 ${s.big ? "text-[19px]" : s.small ? "text-[13px]" : "text-[16px]"}`}
              style={{ color: s.color }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={perf.index} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" opacity={0.4} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={30} />
            <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={40} />
            <Tooltip
              formatter={(v, name) => [Number(v).toFixed(2), String(name)]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Line type="monotone" dataKey="twrIdx" name="Your return (TWR)" stroke="#1E2761" strokeWidth={2} dot={false} />
            {hasNifty && (
              <Line type="monotone" dataKey="niftyIdx" name="NIFTY 500" stroke="#B45309" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="muted-text text-[11px] mt-3 leading-snug">
        Return is chained from each day&apos;s per-holding market move, so it excludes your trades
        (deposits/withdrawals) and any re-pricing of the book — it reflects price performance, not
        cash timing. Window is forward-only from your first daily snapshot — not your full trade
        history. Drawdown and volatility are measured on the return index, not raw value.
      </p>
    </div>
  );
}

// Discipline desk — fires *your* holding rules against the live book so the
// decisions surface themselves instead of you hunting for them. Owner-only, so
// these are stated as plain actions (book / review / cut), not hedged commentary.
//
// Rule triggers (all already derived on Instrument):
//   • target hit  — live price ≥ avgCost×1.25 (targetHit)
//   • over-hold    — held ≥ 4 months (overHoldLimit)
//   • drawdown     — open P&L ≤ DRAWDOWN_FLAG %
// A holding can trip more than one rule; it appears in each column it triggers.
const DRAWDOWN_FLAG = -15;

function DisciplineDesk({ instruments }: { instruments: Instrument[] }) {
  const booked = instruments
    .filter((i) => i.targetHit)
    .sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
  const overheld = instruments
    .filter((i) => i.overHoldLimit)
    .sort((a, b) => (b.monthsHeld ?? 0) - (a.monthsHeld ?? 0));
  const drawdown = instruments
    .filter((i) => (i.pnlPct ?? 0) <= DRAWDOWN_FLAG)
    .sort((a, b) => (a.pnlPct ?? 0) - (b.pnlPct ?? 0));

  const groups = [
    {
      key: "book", color: GREEN, title: "Target hit (+25%)",
      note: "Live price cleared your profit target — book or set a trailing exit.",
      rows: booked, metric: (i: Instrument) => pct(i.pnlPct),
    },
    {
      key: "hold", color: "#B45309", title: "Held 4+ months",
      note: "Past your hold window — re-check the thesis or let it compound deliberately.",
      rows: overheld, metric: (i: Instrument) => (i.monthsHeld != null ? `${i.monthsHeld}mo` : "—"),
    },
    {
      key: "cut", color: RED, title: `Down ${Math.abs(DRAWDOWN_FLAG)}%+`,
      note: "Deep drawdown — decide deliberately: average down, hold, or cut.",
      rows: drawdown, metric: (i: Instrument) => pct(i.pnlPct),
    },
  ] as const;

  const total = booked.length + overheld.length + drawdown.length;

  return (
    <div className="card p-5">
      <SectionHead
        icon={<IconHealth size={15} />}
        title="Discipline desk"
        right={
          <span className="text-[11px]" style={{ color: total > 0 ? "var(--color-accent-700)" : "var(--color-muted)" }}>
            {total > 0 ? `${total} flagged` : "all clear"}
          </span>
        }
      />
      <div className="grid md:grid-cols-3 gap-4">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: g.color }} />
              <h3 className="text-[12.5px] font-semibold">{g.title}</h3>
              <span className="text-[11px] tabular-nums muted-text">{g.rows.length}</span>
            </div>
            <p className="muted-text text-[11px] leading-snug mb-2">{g.note}</p>
            {g.rows.length === 0 ? (
              <p className="text-[11.5px] muted-text italic">Nothing flagged.</p>
            ) : (
              <div className="space-y-0.5">
                {g.rows.slice(0, 6).map((i) => (
                  <Link
                    key={i.key}
                    href={i.symbol ? `/stock/${i.symbol}` : "#"}
                    className="flex items-center justify-between gap-2 py-0.5 group"
                  >
                    <span className="text-[12px] font-medium truncate group-hover:text-[var(--color-accent-700)]">
                      {i.symbol ?? i.name}
                    </span>
                    <span className="text-[11.5px] tabular-nums shrink-0" style={{ color: g.color }}>
                      {g.metric(i)}
                    </span>
                  </Link>
                ))}
                {g.rows.length > 6 && (
                  <div className="text-[11px] muted-text pt-0.5">+{g.rows.length - 6} more</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// A1 — top movers as diverging bars, gainers up top, losers below, scaled to
// the single largest absolute P&L so the bars are comparable across both sides.
function WinnersLosers({ instruments }: { instruments: Instrument[] }) {
  const sorted = [...instruments].sort((a, b) => b.pnl - a.pnl);
  const winners = sorted.filter((i) => i.pnl > 0).slice(0, 5);
  const losers = sorted.filter((i) => i.pnl < 0).slice(-5).reverse();
  const rows = [...winners, ...losers];
  if (rows.length === 0) {
    return (
      <div className="card p-5">
        <SectionHead icon={<IconTrendUp size={15} />} title="Winners & losers" />
        <p className="muted-text text-[12.5px]">No open P&amp;L to attribute yet.</p>
      </div>
    );
  }
  const maxAbs = Math.max(...rows.map((i) => Math.abs(i.pnl)), 1);
  return (
    <div className="card p-5">
      <SectionHead icon={<IconTrendUp size={15} />} title="Winners & losers" right={<span className="muted-text text-[11px]">by open P&amp;L</span>} />
      <div className="space-y-1.5">
        {rows.map((i) => {
          const w = (Math.abs(i.pnl) / maxAbs) * 100;
          const pos = i.pnl >= 0;
          return (
            <Link
              key={i.key}
              href={i.symbol ? `/stock/${i.symbol}` : "#"}
              className="grid grid-cols-[minmax(90px,150px)_1fr_minmax(96px,auto)] items-center gap-3 group"
            >
              <div className="text-[12px] font-medium truncate group-hover:text-[var(--color-accent-700)]">
                {i.symbol ?? i.name}
              </div>
              <div className="relative h-[14px] flex items-center">
                {/* center baseline; bar grows right for gains, left for losses */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px" style={{ background: "var(--color-border-default)" }} />
                <div
                  className="absolute h-[9px] rounded-sm"
                  style={{
                    background: pos ? GREEN : RED,
                    width: `${w / 2}%`,
                    left: pos ? "50%" : `${50 - w / 2}%`,
                  }}
                />
              </div>
              <div className="text-[12px] tabular-nums text-right" style={{ color: pos ? GREEN : RED }}>
                {signed(i.pnl)}
                <span className="muted-text ml-1.5">{pct(i.pnlPct)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// A2 — where capital sits by sector vs what each sector contributed to open P&L.
// Weight is a share of scored value; P&L is the raw ₹ so a heavy-but-flat sector
// reads differently from a light-but-hot one.
function SectorContribution({ instruments, mappedValue }: { instruments: Instrument[]; mappedValue: number }) {
  const bySector = new Map<string, { value: number; pnl: number }>();
  for (const i of instruments) {
    if (!i.isMapped) continue;
    const key = i.sector ?? "Unclassified";
    const cur = bySector.get(key) ?? { value: 0, pnl: 0 };
    cur.value += i.currentValue;
    cur.pnl += i.pnl;
    bySector.set(key, cur);
  }
  const rows = [...bySector.entries()]
    .map(([sector, v]) => ({ sector, ...v, weight: mappedValue > 0 ? (v.value / mappedValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
  if (rows.length === 0) {
    return (
      <div className="card p-5">
        <SectionHead icon={<IconPie size={15} />} title="Sector attribution" />
        <p className="muted-text text-[12.5px]">No scored holdings to break down by sector.</p>
      </div>
    );
  }
  const maxWeight = Math.max(...rows.map((r) => r.weight), 1);
  return (
    <div className="card p-5">
      <SectionHead icon={<IconPie size={15} />} title="Sector attribution" right={<span className="muted-text text-[11px]">weight · open P&amp;L</span>} />
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.sector} className="grid grid-cols-[minmax(110px,180px)_1fr_minmax(96px,auto)] items-center gap-3">
            <div className="text-[12px] font-medium truncate" title={r.sector}>{r.sector}</div>
            <div className="relative h-[14px] flex items-center">
              <div
                className="h-[9px] rounded-sm"
                style={{ background: "var(--color-accent-600)", width: `${(r.weight / maxWeight) * 100}%`, opacity: 0.85 }}
              />
              <span className="ml-2 text-[10.5px] tabular-nums muted-text">{r.weight.toFixed(0)}%</span>
            </div>
            <div className="text-[12px] tabular-nums text-right" style={{ color: up(r.pnl) ? GREEN : RED }}>
              {signed(r.pnl)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// A3 — realized leaders from the trade log (symbol-level; sector rollup deferred).
function RealizedLeaders({ realized }: { realized: RealizedPnl }) {
  const rows = [...realized.rows].sort((a, b) => b.realized - a.realized);
  const top = rows.slice(0, 5);
  const bottom = rows.slice(-3).reverse().filter((r) => r.realized < 0 && !top.includes(r));
  const show = [...top, ...bottom];
  const maxAbs = Math.max(...show.map((r) => Math.abs(r.realized)), 1);
  return (
    <div className="card p-5">
      <SectionHead icon={<IconList size={15} />} title="Booked leaders" right={<span className="muted-text text-[11px]">realized exits</span>} />
      <div className="space-y-1.5">
        {show.map((r) => {
          const w = (Math.abs(r.realized) / maxAbs) * 100;
          const pos = r.realized >= 0;
          return (
            <Link
              key={r.symbol}
              href={`/stock/${r.symbol}`}
              className="grid grid-cols-[minmax(90px,150px)_1fr_minmax(96px,auto)] items-center gap-3 group"
            >
              <div className="text-[12px] font-medium truncate group-hover:text-[var(--color-accent-700)]">{r.symbol}</div>
              <div className="relative h-[14px] flex items-center">
                <div className="h-[9px] rounded-sm" style={{ background: pos ? GREEN : RED, width: `${w}%` }} />
              </div>
              <div className="text-[12px] tabular-nums text-right" style={{ color: pos ? GREEN : RED }}>
                {signed(r.realized)}
                <span className="muted-text ml-1.5">{pct(r.realizedPct)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// B1 — how scored capital distributes across composite quartiles, plus the
// value-weighted Q/V/M tilt of the book. Answers "is my money in good scores?"
const QUARTILES = [
  { label: "Strong (75–100)", min: 75, color: "#15803D" },
  { label: "Solid (50–75)", min: 50, color: "#65A30D" },
  { label: "Weak (25–50)", min: 25, color: "#B45309" },
  { label: "Poor (0–25)", min: 0, color: "#DC2626" },
] as const;

function QualityDistribution({
  mapped, mappedValue, totalValue,
}: { mapped: Instrument[]; mappedValue: number; totalValue: number }) {
  if (mapped.length === 0) {
    return (
      <div className="card p-5">
        <SectionHead icon={<IconPulse size={15} />} title="Capital by score quality" />
        <p className="muted-text text-[12.5px]">Nothing scoreable — all holdings are outside our coverage universe.</p>
      </div>
    );
  }
  const buckets = QUARTILES.map((q) => {
    const items = mapped.filter((i) => {
      const c = i.composite ?? 0;
      return c >= q.min && (q.min === 75 ? c <= 100 : c < q.min + 25);
    });
    const value = items.reduce((s, i) => s + i.currentValue, 0);
    return { ...q, value, share: mappedValue > 0 ? (value / mappedValue) * 100 : 0, count: items.length };
  });
  const wAvg = (sel: (i: Instrument) => number | null) =>
    mappedValue > 0
      ? mapped.reduce((s, i) => s + (sel(i) ?? 0) * i.currentValue, 0) / mappedValue
      : null;
  const wq = wAvg((i) => i.q), wv = wAvg((i) => i.v), wm = wAvg((i) => i.m);
  const unscored = totalValue - mappedValue;
  return (
    <div className="card p-5">
      <SectionHead
        icon={<IconPulse size={15} />}
        title="Capital by score quality"
        right={<span className="muted-text text-[11px]">Q {fmtScore(wq)} · V {fmtScore(wv)} · M {fmtScore(wm)}</span>}
      />
      {/* stacked share bar */}
      <div className="flex h-[22px] rounded-md overflow-hidden mb-3" style={{ background: "var(--color-paper)" }}>
        {buckets.map((b) => b.share > 0 && (
          <div key={b.label} style={{ width: `${b.share}%`, background: b.color }} title={`${b.label}: ${inr(b.value)}`} />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-start gap-2">
            <span className="w-2.5 h-2.5 rounded-sm mt-1 shrink-0" style={{ background: b.color }} />
            <div className="min-w-0">
              <div className="text-[11px] muted-text truncate">{b.label}</div>
              <div className="text-[13px] font-semibold tabular-nums">{b.share.toFixed(0)}%</div>
              <div className="text-[10.5px] muted-text tabular-nums">{inr(b.value)} · {b.count}</div>
            </div>
          </div>
        ))}
      </div>
      {unscored > 1 && (
        <p className="muted-text text-[11px] mt-3">
          {inr(unscored)} in unscored instruments (ETFs / funds) is excluded from this breakdown.
        </p>
      )}
    </div>
  );
}

// B2/B3 — conviction check: your biggest bets against their scores, flagging
// heavy positions sitting on weak composites. Descriptive only — no call to act.
function ConvictionCheck({ mapped, mappedValue }: { mapped: Instrument[]; mappedValue: number }) {
  if (mapped.length === 0) return null;
  const rows = [...mapped]
    .map((i) => ({ i, weight: mappedValue > 0 ? (i.currentValue / mappedValue) * 100 : 0 }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);
  const mismatches = rows.filter((r) => r.weight >= 8 && (r.i.composite ?? 0) < 50).length;
  return (
    <div className="card p-5">
      <SectionHead
        icon={<IconLayers size={15} />}
        title="Conviction check"
        right={
          <span className="text-[11px]" style={{ color: mismatches > 0 ? RED : "var(--color-muted)" }}>
            {mismatches > 0 ? `${mismatches} heavy · weak-score` : "no size/score mismatch"}
          </span>
        }
      />
      <div className="space-y-1">
        {rows.map(({ i, weight }) => {
          const c = i.composite ?? 0;
          const flag = weight >= 8 && c < 50;
          return (
            <Link
              key={i.key}
              href={i.symbol ? `/stock/${i.symbol}` : "#"}
              className="grid grid-cols-[minmax(90px,160px)_1fr_44px_44px] items-center gap-3 py-1 group"
            >
              <div className="text-[12px] font-medium truncate group-hover:text-[var(--color-accent-700)]">
                {i.symbol ?? i.name}
                {flag && <span className="ml-1.5 text-[10px]" style={{ color: RED }}>heavy · weak</span>}
              </div>
              <div className="relative h-[12px] flex items-center">
                <div className="h-[8px] rounded-sm" style={{ background: "var(--color-accent-600)", width: `${weight}%`, opacity: 0.85 }} />
              </div>
              <div className="text-[11.5px] tabular-nums text-right muted-text">{weight.toFixed(0)}%</div>
              <div className="text-[12px] tabular-nums text-right font-medium" style={{ color: c >= 50 ? GREEN : RED }}>
                {fmtScore(c)}
              </div>
            </Link>
          );
        })}
      </div>
      <p className="muted-text text-[11px] mt-3">
        Weight = share of scored value; score = composite. This is a lens on position sizing versus
        our read on quality — not a recommendation to trade.
      </p>
    </div>
  );
}

// ─────────────────────────── booked (realized) P&L ─────────────────────────

// Sortable columns for the Booked P&L table. Order MUST match the <thead>/<tbody>.
type RSortKey = "symbol" | "qtySold" | "costOfSold" | "proceeds" | "realized" | "realizedPct" | "lastSell";

const R_COLUMNS: {
  key: RSortKey; label: string; align: "left" | "right"; cls: string; numeric: boolean; hideSm?: boolean;
}[] = [
  { key: "symbol", label: "Instrument", align: "left", cls: "px-3", numeric: false },
  { key: "qtySold", label: "Qty sold", align: "right", cls: "px-2", numeric: true },
  { key: "costOfSold", label: "Cost basis", align: "right", cls: "px-2", numeric: true },
  { key: "proceeds", label: "Proceeds", align: "right", cls: "px-2", numeric: true },
  { key: "realized", label: "Booked P&L", align: "right", cls: "px-2", numeric: true },
  { key: "realizedPct", label: "Return", align: "right", cls: "px-2", numeric: true },
  { key: "lastSell", label: "Last sell", align: "right", cls: "px-3", numeric: false, hideSm: true },
];

function rSortVal(r: RealizedLot, key: RSortKey): number | string | null {
  switch (key) {
    case "symbol": return (r.symbol ?? r.name ?? "").toLowerCase();
    case "qtySold": return r.qtySold;
    case "costOfSold": return r.costOfSold;
    case "proceeds": return r.proceeds;
    case "realized": return r.realized;
    case "realizedPct": return r.realizedPct; // may be null → sorted last
    case "lastSell": return r.lastSell; // ISO date string sorts lexically → chronologically
  }
}

function rMakeCmp(key: RSortKey, dir: SortDir) {
  const s = dir === "asc" ? 1 : -1;
  return (a: RealizedLot, b: RealizedLot) => {
    const va = rSortVal(a, key);
    const vb = rSortVal(b, key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulls always last
    if (vb == null) return -1;
    if (typeof va === "string" || typeof vb === "string") {
      return String(va).localeCompare(String(vb)) * s;
    }
    return (va - vb) * s;
  };
}

function BookedPnl({ realized }: { realized: RealizedPnl }) {
  // Defaults to Booked P&L high→low (the server's original order).
  const [sort, setSort] = useState<{ key: RSortKey; dir: SortDir }>({ key: "realized", dir: "desc" });
  const onSort = (key: RSortKey) =>
    setSort((cur) => {
      if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
      const col = R_COLUMNS.find((c) => c.key === key)!;
      return { key, dir: col.numeric ? "desc" : "asc" }; // numbers → high-first, name → A→Z
    });

  if (realized.rows.length === 0) {
    return (
      <div className="card p-8 text-center mt-2">
        <h2 className="font-display text-[20px] mb-2">No booked P&amp;L yet</h2>
        <p className="muted-text text-[13px] max-w-md mx-auto">
          Once you record or import a <strong>sell</strong>, the realized profit or loss on that
          exit shows up here — computed average-cost from your trade log. Open positions and their
          unrealized gains stay on the Overview tab.
        </p>
      </div>
    );
  }
  const tt = realized.totals;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card
          label="Net booked P&L"
          value={signed(tt.realized)}
          valueColor={up(tt.realized) ? GREEN : RED}
          sub={pct(tt.realizedPct)}
          subColor={up(tt.realizedPct) ? GREEN : RED}
          icon={<IconTrendUp size={15} />}
          accent={up(tt.realized) ? GREEN : RED}
        />
        <Card label="Sale proceeds" value={inr(tt.proceeds)} sub="realized exits" icon={<IconWallet size={15} />} />
        <Card label="Cost of sold" value={inr(tt.costOfSold)} sub="avg-cost basis" icon={<IconDeposit size={15} />} />
        <Card
          label="Win / loss"
          value={`${tt.winners} / ${tt.losers}`}
          sub={`${realized.rows.length} stocks sold`}
          icon={<IconPulse size={15} />}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b hairline flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
          >
            <IconList size={15} />
          </span>
          <h2 className="text-[14px] font-semibold">Booked profit &amp; loss ({realized.rows.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wide muted-text border-b hairline">
                {R_COLUMNS.map((c) => {
                  const active = sort.key === c.key;
                  const alignCls = c.align === "left" ? "text-left" : "text-right";
                  return (
                    <th
                      key={c.key}
                      className={`${alignCls} font-semibold ${c.cls} py-2 cursor-pointer select-none hover:text-[var(--color-fg)]${c.hideSm ? " hidden sm:table-cell" : ""}`}
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                      onClick={() => onSort(c.key)}
                    >
                      <span className={`inline-flex items-center gap-0.5${c.align === "right" ? " flex-row-reverse" : ""}`}>
                        {c.label}
                        {active && <span aria-hidden className="text-[8px] leading-none">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {[...realized.rows].sort(rMakeCmp(sort.key, sort.dir)).map((r: RealizedLot) => (
                <tr key={r.symbol} className="border-b hairline hover:bg-[var(--color-paper)]">
                  <td className="px-3 py-2">
                    <Link href={`/stock/${r.symbol}`} className="font-medium hover:underline">
                      {r.symbol}
                    </Link>
                    <div className="text-[10.5px] muted-text truncate max-w-[220px]">{r.name ?? ""}</div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.qtySold}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{inr(r.costOfSold)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{inr(r.proceeds)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium" style={{ color: up(r.realized) ? GREEN : RED }}>
                    {signed(r.realized)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums" style={{ color: r.realizedPct == null ? undefined : up(r.realizedPct) ? GREEN : RED }}>
                    {pct(r.realizedPct)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums muted-text hidden sm:table-cell">{r.lastSell ?? "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 hairline font-semibold" style={{ background: "var(--color-paper)" }}>
                <td className="px-3 py-2">Total</td>
                <td className="px-2 py-2" />
                <td className="px-2 py-2 text-right tabular-nums">{inr(tt.costOfSold)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{inr(tt.proceeds)}</td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: up(tt.realized) ? GREEN : RED }}>
                  {signed(tt.realized)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: up(tt.realizedPct) ? GREEN : RED }}>
                  {pct(tt.realizedPct)}
                </td>
                <td className="px-3 py-2 hidden sm:table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted-text text-[11px] px-4 py-2.5 leading-snug border-t hairline">
          Average-cost method. A sale before any recorded buy (common in date-windowed exports) has
          no cost basis, so its proceeds book as pure gain — import the full history for accuracy.
          Not tax advice.
        </p>
      </div>
    </>
  );
}

// ─────────────────────────── import panel ──────────────────────────────────

function ImportPanel({
  broker, setBroker, kind, setKind, busy, result, fileRef, onUpload, brokers,
}: {
  broker: string;
  setBroker: (b: string) => void;
  kind: ImportKind;
  setKind: (k: ImportKind) => void;
  busy: boolean;
  result: ImportResult | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: () => void;
  brokers: string[];
}) {
  const isTrades = kind === "trades";
  return (
    <div className="card p-4 md:p-5">
      {/* Holdings (snapshot) vs Transactions (tradebook) */}
      <div className="mb-3">
        <div className="inline-flex rounded-md border overflow-hidden" style={{ borderColor: "var(--color-border-default)" }}>
          {([
            { v: "holdings", label: "Holdings snapshot" },
            { v: "trades", label: "Tradebook" },
          ] as const).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setKind(o.v)}
              className="px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={
                kind === o.v
                  ? { background: "var(--color-accent-600)", color: "white" }
                  : { background: "transparent", color: "var(--color-muted)" }
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Broker
          </label>
          <select
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
            className="rounded-md border px-3 py-2 text-[13px] bg-[var(--color-card)]"
            style={{ borderColor: "var(--color-border-default)" }}
          >
            {BROKERS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
                {brokers.includes(b.value) ? " ✓" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            {isTrades ? "Tradebook file (.csv, .xlsx or .xls)" : "Holdings file (.csv, .xlsx or .xls)"}
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="block w-full text-[13px] file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:bg-[var(--color-accent-600)] file:text-white"
          />
        </div>
        <button
          type="button"
          onClick={onUpload}
          disabled={busy}
          className="px-4 py-2 rounded-md font-medium text-[13px] transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
          style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
        >
          <IconUpload size={15} />
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      <p className="muted-text text-[11.5px] mt-2 leading-snug">
        {isTrades ? (
          <>
            A <strong>tradebook</strong> is your buy/sell history. Trades are <strong>added</strong> (re-uploading
            an overlapping window is de-duplicated, never doubled) and drive the B/S chart markers. For any stock
            you haven&apos;t given a holdings snapshot, we compute the position from these trades — but a real
            snapshot always <strong>wins</strong> for the current quantity.
          </>
        ) : (
          <>
            Re-importing a broker <strong>replaces</strong> that broker&apos;s holdings. Upload the
            broker&apos;s holdings export as-is — <code>.csv</code>, <code>.xlsx</code> and 5paisa&apos;s
            legacy <code>.xls</code> are all accepted.
          </>
        )}
      </p>

      {result && (
        <div
          className="mt-3 rounded-md px-3 py-2 text-[12.5px]"
          style={{
            background: result.error
              ? "color-mix(in srgb, var(--color-delta-down, #DC2626) 10%, transparent)"
              : "color-mix(in srgb, var(--color-delta-up, #15803D) 12%, transparent)",
          }}
        >
          {result.error ? (
            <span style={{ color: RED }}>{result.error}</span>
          ) : result.kind === "trades" ? (
            <span>
              <strong>{result.brokerLabel}</strong>: {result.imported} new trade
              {result.imported === 1 ? "" : "s"} imported
              {result.skipped ? `, ${result.skipped} already on record` : ""} across{" "}
              {result.mappedSymbols} stock{result.mappedSymbols === 1 ? "" : "s"}
              {result.dateRange ? ` (${result.dateRange.from} → ${result.dateRange.to})` : ""}
              {result.outsideCoverage && result.outsideCoverage.length > 0 && (
                <span className="muted-text">
                  {" "}
                  · {result.outsideCoverage.length} outside coverage (
                  {result.outsideCoverage.slice(0, 6).join(", ")}
                  {result.outsideCoverage.length > 6 ? "…" : ""})
                </span>
              )}
              .
            </span>
          ) : (
            <span>
              <strong>{result.brokerLabel}</strong>: {result.imported} holdings imported —{" "}
              {result.mapped} scored
              {result.unmapped ? (
                <>
                  , {result.unmapped} outside coverage
                  {result.unmappedSymbols && result.unmappedSymbols.length > 0 && (
                    <span className="muted-text"> ({result.unmappedSymbols.slice(0, 8).join(", ")}
                      {result.unmappedSymbols.length > 8 ? "…" : ""})</span>
                  )}
                </>
              ) : null}
              .
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── manual trade entry ────────────────────────────

type ManualTrade = {
  id: string;
  symbol: string;
  name: string | null;
  broker: string;
  brokerLabel: string;
  side: string;
  date: string;
  quantity: number;
  price: number;
};
type SearchHit = { symbol: string; company_name: string };

// Brokers a manual trade can be tagged with (metadata — the trade is still a
// hand entry). Mirrors MANUAL_BROKERS in the manual-trade route.
const MANUAL_BROKERS = [
  { value: "zerodha", label: "Zerodha" },
  { value: "upstox", label: "Upstox" },
  { value: "fyers", label: "Fyers" },
  { value: "fivepaisa", label: "5paisa" },
  { value: "groww", label: "Groww" },
  { value: "other", label: "Other" },
] as const;

function ManualTradePanel({ onChanged }: { onChanged: () => void }) {
  const [trades, setTrades] = useState<ManualTrade[]>([]);
  const [symbol, setSymbol] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [brokerSel, setBrokerSel] = useState<string>("zerodha");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ err?: string; ok?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/portfolio/manual-trade", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setTrades(d.trades ?? []);
      }
    } catch {
      /* ignore — panel is non-critical */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Debounced symbol autocomplete against the shared /api/search endpoint.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (r.ok) {
          const d = await r.json();
          setHits(d.hits ?? []);
        }
      } catch {
        /* aborted / offline */
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  function pick(h: SearchHit) {
    setSymbol(h.symbol);
    setQuery(h.symbol);
    setShowHits(false);
  }

  async function submit() {
    setMsg(null);
    if (!symbol) return setMsg({ err: "Pick a stock from the suggestions first." });
    const q = Number(qty);
    const p = Number(price);
    if (!(q > 0)) return setMsg({ err: "Quantity must be greater than 0." });
    if (!(p >= 0)) return setMsg({ err: "Price must be zero or more." });
    setBusy(true);
    try {
      const r = await fetch("/api/portfolio/manual-trade", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, side, broker: brokerSel, date, quantity: q, price: p }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ err: d.error ?? `Failed (HTTP ${r.status})` });
      } else {
        setMsg({ ok: `${side === "buy" ? "Bought" : "Sold"} ${q} ${symbol} @ ₹${p.toLocaleString("en-IN")}.` });
        setSymbol("");
        setQuery("");
        setQty("");
        setPrice("");
        await load();
        onChanged();
      }
    } catch {
      setMsg({ err: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      const r = await fetch(`/api/portfolio/manual-trade?id=${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok) {
        await load();
        onChanged();
      }
    } catch {
      /* ignore */
    }
  }

  const inputCls =
    "rounded-md border px-3 py-2 text-[13px] bg-[var(--color-card)] w-full";
  const inputStyle = { borderColor: "var(--color-border-default)" };

  return (
    <div className="card p-4 md:p-5 mt-4">
      <SectionHead icon={<IconEdit size={15} />} title="Add a manual trade" />
      <p className="muted-text text-[11.5px] -mt-1 mb-3 leading-snug">
        Log a buy or sell between broker imports — it updates your holdings, not just the chart.
        A real <strong>holdings snapshot</strong> for the same stock always wins for the current
        quantity; until then the position is computed from your trades.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        {/* symbol autocomplete */}
        <div className="relative min-w-[190px] flex-1">
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Stock
          </label>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSymbol("");
              setShowHits(true);
            }}
            onFocus={() => setShowHits(true)}
            onBlur={() => setTimeout(() => setShowHits(false), 150)}
            placeholder="Search symbol or name…"
            className={inputCls}
            style={inputStyle}
          />
          {showHits && hits.length > 0 && (
            <ul
              className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border shadow-lg text-[12.5px]"
              style={{ borderColor: "var(--color-border-default)", background: "var(--color-card)" }}
            >
              {hits.map((h) => (
                <li key={h.symbol}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(h)}
                    className="block w-full text-left px-3 py-1.5 hover:bg-[var(--color-paper)]"
                  >
                    <span className="font-medium">{h.symbol}</span>
                    <span className="muted-text"> — {h.company_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* broker */}
        <div>
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Broker
          </label>
          <select
            value={brokerSel}
            onChange={(e) => setBrokerSel(e.target.value)}
            className="rounded-md border px-3 py-2 text-[13px] bg-[var(--color-card)]"
            style={inputStyle}
          >
            {MANUAL_BROKERS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>

        {/* side toggle */}
        <div>
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Side
          </label>
          <div className="inline-flex rounded-md border overflow-hidden" style={inputStyle}>
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className="px-3 py-2 text-[12.5px] font-medium capitalize transition-colors"
                style={
                  side === s
                    ? { background: s === "buy" ? GREEN : RED, color: "white" }
                    : { background: "transparent", color: "var(--color-muted)" }
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="w-[140px]">
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
        </div>

        <div className="w-[100px]">
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Qty
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={`${inputCls} text-right`}
            style={inputStyle}
          />
        </div>

        <div className="w-[120px]">
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Price ₹
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={`${inputCls} text-right`}
            style={inputStyle}
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded-md font-medium text-[13px] transition-colors disabled:opacity-60"
          style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
        >
          {busy ? "Saving…" : "Add trade"}
        </button>
      </div>

      {msg && (
        <div
          className="mt-3 rounded-md px-3 py-2 text-[12.5px]"
          style={{
            background: msg.err
              ? "color-mix(in srgb, var(--color-delta-down, #DC2626) 10%, transparent)"
              : "color-mix(in srgb, var(--color-delta-up, #15803D) 12%, transparent)",
          }}
        >
          <span style={{ color: msg.err ? RED : GREEN }}>{msg.err ?? msg.ok}</span>
        </div>
      )}

      {trades.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Manual trades ({trades.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <tbody>
                {trades.map((tr) => (
                  <tr key={tr.id} className="border-b hairline">
                    <td className="py-1.5 pr-3">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase"
                        style={{
                          color: "white",
                          background: tr.side === "buy" ? GREEN : RED,
                        }}
                      >
                        {tr.side}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-medium">{tr.symbol}</td>
                    <td className="py-1.5 pr-3">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10.5px] font-medium whitespace-nowrap"
                        style={{ background: "var(--color-paper)", color: "var(--color-muted)" }}
                      >
                        {tr.brokerLabel}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 muted-text truncate max-w-[200px] hidden sm:table-cell">
                      {tr.name}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{tr.quantity}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">@ {inr(tr.price, 2)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums muted-text">{tr.date}</td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => remove(tr.id)}
                        className="text-[11px] px-2 py-1 rounded hover:bg-[var(--color-paper)]"
                        style={{ color: RED }}
                        aria-label={`Delete ${tr.side} ${tr.symbol}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── summary cards ─────────────────────────────────

function SummaryCards({ t, snapshot }: { t: Portfolio["totals"]; snapshot: string | null }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
      <Card label="Current value" value={inr(t.currentValue)} sub={`${t.holdingCount} instruments · ${t.mappedCount} scored`} icon={<IconWallet size={15} />} />
      <Card label="Invested" value={inr(t.invested)} sub={snapshot ? `scores @ ${snapshot}` : undefined} icon={<IconDeposit size={15} />} />
      <Card
        label="Total P&L"
        value={signed(t.pnl)}
        valueColor={up(t.pnl) ? GREEN : RED}
        sub={pct(t.pnlPct)}
        subColor={up(t.pnlPct) ? GREEN : RED}
        icon={<IconTrendUp size={15} />}
        accent={up(t.pnl) ? GREEN : RED}
      />
      <Card
        label="Day change"
        value={signed(t.dayChangeValue)}
        valueColor={up(t.dayChangeValue) ? GREEN : RED}
        sub={pct(t.dayChangePct)}
        subColor={up(t.dayChangePct) ? GREEN : RED}
        icon={<IconPulse size={15} />}
        accent={up(t.dayChangeValue) ? GREEN : RED}
      />
    </div>
  );
}

function Card({
  label, value, sub, valueColor, subColor, icon, accent,
}: {
  label: string; value: string; sub?: string; valueColor?: string; subColor?: string;
  icon?: React.ReactNode; accent?: string;
}) {
  const chipColor = accent ?? "var(--color-accent-700)";
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold muted-text uppercase tracking-wide">{label}</div>
        {icon && (
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
            style={{ background: `color-mix(in srgb, ${chipColor} 12%, transparent)`, color: chipColor }}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="text-[20px] md:text-[22px] font-semibold tabular-nums mt-1" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {sub && (
        <div className="text-[12px] tabular-nums mt-0.5" style={subColor ? { color: subColor } : { color: "var(--color-muted)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── equity curve ──────────────────────────────────

function EquityCurve({ curve }: { curve: CurvePoint[] }) {
  if (curve.length < 2) {
    return (
      <div className="card p-5 mt-6">
        <SectionHead icon={<IconChart size={15} />} title="Performance vs NIFTY 500" />
        <p className="muted-text text-[12.5px]">
          {curve.length === 0
            ? "Your equity curve starts accruing from your first daily snapshot. Check back tomorrow — a holdings export has no back-history, so the curve grows forward from onboarding."
            : `Accruing since ${curve[0].date}. One more daily snapshot and the curve vs NIFTF 500 appears here.`}
        </p>
      </div>
    );
  }
  return (
    <div className="card p-4 md:p-5 mt-6">
      <SectionHead
        icon={<IconChart size={15} />}
        title="Performance vs NIFTY 500"
        right={<span className="text-[11px] muted-text">rebased to 100 at {curve[0].date}</span>}
      />
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={curve} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" opacity={0.4} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={30} />
            <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={40} />
            <Tooltip
              formatter={(v, name) => [Number(v).toFixed(1), String(name)]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Line type="monotone" dataKey="portfolioIdx" name="Portfolio" stroke="#1E2761" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="niftyIdx" name="NIFTY 500" stroke="#B45309" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─────────────────────────── allocation donuts ─────────────────────────────

function Donut({ title, data, total }: { title: string; data: { label: string; value: number }[]; total: number }) {
  const top = data.slice(0, 9);
  const rest = data.slice(9);
  const restSum = rest.reduce((s, d) => s + d.value, 0);
  const slices = restSum > 0 ? [...top, { label: "Other", value: restSum }] : top;
  return (
    <div className="card p-4 md:p-5">
      <SectionHead
        icon={title.toLowerCase().includes("broker") ? <IconBank size={15} /> : <IconPie size={15} />}
        title={title}
      />
      <div className="flex items-center gap-4">
        <div style={{ width: 150, height: 150, flexShrink: 0 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="label" innerRadius={42} outerRadius={70} paddingAngle={1}>
                {slices.map((_, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => inr(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          {slices.map((d, i) => (
            <div key={d.label} className="flex items-center gap-2 text-[12px]">
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              <span className="truncate flex-1">{d.label}</span>
              <span className="tabular-nums muted-text">{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── holdings table ────────────────────────────────

type GroupMode = "sector" | "industry" | "flat";
const UNSCORED_GROUP = "ETFs & funds (unscored)";

type Group = {
  label: string;
  instruments: Instrument[];
  value: number;
  invested: number;
  pnl: number;
  dayChange: number;
};

function buildGroups(instruments: Instrument[], mode: GroupMode): Group[] {
  if (mode === "flat") {
    return [
      {
        label: "",
        instruments,
        value: instruments.reduce((s, i) => s + i.currentValue, 0),
        invested: instruments.reduce((s, i) => s + i.invested, 0),
        pnl: instruments.reduce((s, i) => s + i.pnl, 0),
        dayChange: instruments.reduce((s, i) => s + (i.dayChangeValue ?? 0), 0),
      },
    ];
  }
  const map = new Map<string, Instrument[]>();
  for (const ins of instruments) {
    const key = !ins.isMapped
      ? UNSCORED_GROUP
      : (mode === "sector" ? ins.sector : ins.industry) ?? "Uncategorised";
    (map.get(key) ?? map.set(key, []).get(key)!).push(ins);
  }
  const groups: Group[] = [...map.entries()].map(([label, list]) => ({
    label,
    instruments: [...list].sort((a, b) => b.currentValue - a.currentValue),
    value: list.reduce((s, i) => s + i.currentValue, 0),
    invested: list.reduce((s, i) => s + i.invested, 0),
    pnl: list.reduce((s, i) => s + i.pnl, 0),
    dayChange: list.reduce((s, i) => s + (i.dayChangeValue ?? 0), 0),
  }));
  // Value-desc, but always park the unscored bucket last.
  return groups.sort((a, b) => {
    if (a.label === UNSCORED_GROUP) return 1;
    if (b.label === UNSCORED_GROUP) return -1;
    return b.value - a.value;
  });
}

// Sortable columns for the Flat view. Order MUST match the <thead> and the
// cells FragmentRow renders (grouped-mode group rows also colSpan against it).
type SortKey =
  | "symbol" | "broker" | "qty" | "avg" | "price" | "target"
  | "value" | "day" | "pnl" | "pnlPct" | "qvm" | "rank" | "held" | "wt";
type SortDir = "asc" | "desc";

const COLUMNS: {
  key: SortKey; label: string; align: "left" | "center" | "right";
  cls: string; numeric: boolean; title?: string;
}[] = [
  { key: "symbol", label: "Instrument", align: "left", cls: "px-3", numeric: false },
  { key: "broker", label: "Broker", align: "left", cls: "px-2", numeric: false, title: "Broker(s) the position is held at" },
  { key: "qty", label: "Qty", align: "right", cls: "px-2", numeric: true },
  { key: "avg", label: "Avg", align: "right", cls: "px-2", numeric: true },
  { key: "price", label: "Price", align: "right", cls: "px-2", numeric: true },
  { key: "target", label: "Target", align: "right", cls: "px-2", numeric: true, title: "Profit target: avg cost +25%" },
  { key: "value", label: "Value", align: "right", cls: "px-2", numeric: true },
  { key: "day", label: "Day", align: "right", cls: "px-2", numeric: true },
  { key: "pnl", label: "P&L", align: "right", cls: "px-2", numeric: true },
  { key: "qvm", label: "Q/V/M", align: "center", cls: "px-2", numeric: true },
  { key: "rank", label: "Rank", align: "center", cls: "px-2", numeric: true },
  { key: "held", label: "Held", align: "right", cls: "px-2", numeric: true, title: "Time held (approx — measured from import date, not actual purchase date). Flags at 4 months." },
  { key: "wt", label: "Wt", align: "right", cls: "px-3", numeric: true },
];

// Broker cell text: the single broker's label, or "N brokers" when the position
// is split across several. Sorted by this same string in the Flat view.
function brokerText(ins: Instrument): string {
  if (!ins.brokers?.length) return "—";
  return ins.brokers.length === 1 ? ins.brokers[0].brokerLabel : `${ins.brokers.length} brokers`;
}

// Value under a sort key: number for numeric cols, lowercased string for the
// instrument name, or null (always sorted last, either direction).
function sortVal(ins: Instrument, key: SortKey): number | string | null {
  switch (key) {
    case "symbol": return (ins.symbol ?? ins.name ?? "").toLowerCase();
    case "broker": return brokerText(ins).toLowerCase();
    case "qty": return ins.quantity ?? null;
    case "avg": return ins.avgCost ?? null;
    case "price": return ins.price ?? null;
    case "target": return ins.targetPrice ?? null;
    case "value": case "wt": return ins.currentValue ?? null;
    case "day": return ins.dayChangePct ?? null;
    case "pnl": return ins.pnl ?? null;
    case "pnlPct": return ins.pnlPct ?? null;
    case "qvm": {
      const vals = [ins.q, ins.v, ins.m].filter((x): x is number => x != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    case "rank": return ins.peerRank ?? null;
    case "held": return ins.monthsHeld ?? null;
  }
}

function makeCmp(key: SortKey, dir: SortDir) {
  const s = dir === "asc" ? 1 : -1;
  return (a: Instrument, b: Instrument) => {
    const va = sortVal(a, key);
    const vb = sortVal(b, key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulls always last
    if (vb == null) return -1;
    if (typeof va === "string" || typeof vb === "string") {
      return String(va).localeCompare(String(vb)) * s;
    }
    return (va - vb) * s;
  };
}

/** Holdings tab body: splits positions into Stocks (mapped/scored NSE names)
 *  and Others (ETFs, funds, bonds — anything we don't score) under two
 *  sub-tabs. `isMapped` is the same signal the sector allocation uses to
 *  bucket "ETFs & funds (unscored)". */
function HoldingsSheets({ instruments, totalValue }: { instruments: Instrument[]; totalValue: number }) {
  const stocks = instruments.filter((i) => i.isMapped);
  const others = instruments.filter((i) => !i.isMapped);
  const [sub, setSub] = useState<"stocks" | "others">("stocks");
  const active = sub === "stocks" ? stocks : others;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-1 border-b hairline">
        {([
          { v: "stocks", label: "Stocks", n: stocks.length },
          { v: "others", label: "Others", n: others.length },
        ] as const).map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setSub(o.v)}
            className="relative px-3 py-2 text-[12.5px] font-medium transition-colors"
            style={{ color: sub === o.v ? "var(--color-accent-700)" : "var(--color-muted)" }}
          >
            {o.label}
            <span className="ml-1.5 text-[11px] tabular-nums muted-text">{o.n}</span>
            {sub === o.v && (
              <span className="absolute left-0 right-0 -bottom-px h-[2px]" style={{ background: "var(--color-accent-600)" }} />
            )}
          </button>
        ))}
      </div>

      {active.length === 0 ? (
        <div className="card p-6 mt-3 text-center muted-text text-[13px]">
          {sub === "others"
            ? "No ETFs, funds or other non-equity holdings."
            : "No mapped stock holdings."}
        </div>
      ) : (
        <div className="mt-3">
          <HoldingsTable instruments={active} totalValue={totalValue} flush />
        </div>
      )}
    </div>
  );
}

function HoldingsTable({
  instruments,
  totalValue,
  flush = false,
}: {
  instruments: Instrument[];
  totalValue: number;
  flush?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<GroupMode>("flat");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Flat-view column sort. Defaults to Instrument A→Z (the landing view).
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "symbol", dir: "asc" });
  const onSort = (key: SortKey) =>
    setSort((cur) => {
      if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
      // pnlPct has no COLUMNS entry (it shares the P&L header) — treat it as numeric.
      const col = COLUMNS.find((c) => c.key === key);
      return { key, dir: !col || col.numeric ? "desc" : "asc" }; // numbers → high-first, name → A→Z
    });

  const groups = buildGroups(instruments, mode);
  // Only the Flat view is sortable — grouped modes keep their value-desc order
  // (per-column sort would collide with the collapsible group rows).
  const displayGroups =
    mode === "flat" && groups[0]
      ? [{ ...groups[0], instruments: [...groups[0].instruments].sort(makeCmp(sort.key, sort.dir)) }]
      : groups;

  const toggleGroup = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <div className={`card overflow-hidden${flush ? "" : " mt-6"}`}>
      <div className="px-4 py-3 border-b hairline flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
          >
            <IconList size={15} />
          </span>
          <h2 className="text-[14px] font-semibold">Holdings ({instruments.length})</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] muted-text hidden sm:inline">group by</span>
          <div className="inline-flex rounded-md border overflow-hidden" style={{ borderColor: "var(--color-border-default)" }}>
            {(["sector", "industry", "flat"] as GroupMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors"
                style={
                  mode === m
                    ? { background: "var(--color-accent-600)", color: "white" }
                    : { background: "transparent", color: "var(--color-muted)" }
                }
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide muted-text border-b hairline">
              {COLUMNS.map((c) => {
                const sortable = mode === "flat";
                const active = sortable && sort.key === c.key;
                const alignCls = c.align === "left" ? "text-left" : c.align === "center" ? "text-center" : "text-right";
                const arrow = (
                  <span aria-hidden className="text-[8px] leading-none">{sort.dir === "asc" ? "▲" : "▼"}</span>
                );

                // P&L carries two measures — absolute rupees and return %.
                // Give each its own sort target so you can rank by either.
                if (c.key === "pnl") {
                  const pctActive = sortable && sort.key === "pnlPct";
                  return (
                    <th
                      key={c.key}
                      className={`${alignCls} font-semibold ${c.cls} py-2`}
                      title="Sort by absolute P&L (₹) or by return (%)"
                      aria-sort={active || pctActive ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      <span className="inline-flex items-center gap-0.5 flex-row-reverse">
                        <span
                          className={`inline-flex items-center gap-0.5${sortable ? " cursor-pointer select-none hover:text-[var(--color-fg)]" : ""}`}
                          onClick={sortable ? () => onSort("pnl") : undefined}
                        >
                          {active && arrow}
                          P&amp;L
                        </span>
                        <span className="muted-text font-normal">/</span>
                        <span
                          className={`inline-flex items-center gap-0.5${sortable ? " cursor-pointer select-none hover:text-[var(--color-fg)]" : ""}${pctActive ? "" : " muted-text"}`}
                          onClick={sortable ? () => onSort("pnlPct") : undefined}
                        >
                          {pctActive && arrow}
                          %
                        </span>
                      </span>
                    </th>
                  );
                }

                return (
                  <th
                    key={c.key}
                    className={`${alignCls} font-semibold ${c.cls} py-2${sortable ? " cursor-pointer select-none hover:text-[var(--color-fg)]" : ""}`}
                    title={c.title}
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    onClick={sortable ? () => onSort(c.key) : undefined}
                  >
                    <span className={`inline-flex items-center gap-0.5${c.align === "right" ? " flex-row-reverse" : ""}`}>
                      {c.label}
                      {active && arrow}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayGroups.map((g) => {
              const gWt = totalValue > 0 ? Math.round((g.value / totalValue) * 1000) / 10 : 0;
              const grouped = mode !== "flat";
              const isCollapsed = grouped && collapsed.has(g.label);
              return (
                <Fragment key={g.label || "all"}>
                  {grouped && (
                    <tr
                      className="border-b hairline cursor-pointer select-none hover:brightness-95"
                      style={{ background: "var(--color-paper)" }}
                      onClick={() => toggleGroup(g.label)}
                    >
                      <td className="px-3 py-1.5 font-semibold text-[12px]">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[9px] muted-text w-2 inline-block transition-transform" style={{ transform: isCollapsed ? "none" : "rotate(90deg)" }}>▸</span>
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded-md shrink-0"
                            style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
                          >
                            {groupIcon(g.label)}
                          </span>
                          {g.label}{" "}
                          <span className="muted-text font-normal">({g.instruments.length})</span>
                        </span>
                      </td>
                      <td colSpan={5} />
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{inr(g.value)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: up(g.dayChange) ? GREEN : RED }}>
                        {signed(g.dayChange)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold" style={{ color: up(g.pnl) ? GREEN : RED }}>
                        {signed(g.pnl)}
                      </td>
                      <td colSpan={3} />
                      <td className="px-3 py-1.5 text-right tabular-nums muted-text">{gWt}%</td>
                    </tr>
                  )}
                  {!isCollapsed && g.instruments.map((ins) => {
                    const isOpen = expanded === ins.key;
                    const wt = totalValue > 0 ? Math.round((ins.currentValue / totalValue) * 1000) / 10 : 0;
                    return (
                      <FragmentRow
                        key={ins.key}
                        ins={ins}
                        wt={wt}
                        isOpen={isOpen}
                        onToggle={() => setExpanded(isOpen ? null : ins.key)}
                      />
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({
  ins, wt, isOpen, onToggle,
}: { ins: Instrument; wt: number; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className="border-b hairline hover:bg-[var(--color-paper)] cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] muted-text w-2">{ins.brokers.length > 1 ? (isOpen ? "▾" : "▸") : ""}</span>
            <div className="min-w-0">
              <div className="font-medium truncate max-w-[220px]">
                {ins.symbol ? (
                  <Link href={`/stock/${ins.symbol}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                    {ins.symbol}
                  </Link>
                ) : (
                  ins.name
                )}
              </div>
              <div className="text-[10.5px] muted-text truncate max-w-[220px] flex items-center gap-1">
                {ins.derived && (
                  <span
                    className="inline-block px-1 py-[1px] rounded text-[9px] font-semibold uppercase tracking-wide shrink-0"
                    style={{ background: "color-mix(in srgb, var(--color-accent-600) 14%, transparent)", color: "var(--color-accent-700)" }}
                    title="Computed from your trades — no broker snapshot, so it may be incomplete (pre-window lots can be missing)."
                  >
                    from trades
                  </span>
                )}
                <span className="truncate">{ins.isMapped ? ins.name : "Outside coverage — unscored"}</span>
              </div>
            </div>
          </div>
        </td>
        <td className="px-2 py-2">
          {ins.brokers.length > 1 ? (
            <span className="muted-text">{ins.brokers.length} brokers</span>
          ) : (
            <span>{ins.brokers[0]?.brokerLabel ?? "—"}</span>
          )}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{ins.quantity}</td>
        <td className="px-2 py-2 text-right tabular-nums">{ins.avgCost != null ? ins.avgCost.toLocaleString("en-IN") : "—"}</td>
        <td className="px-2 py-2 text-right tabular-nums">{ins.price != null ? ins.price.toLocaleString("en-IN") : "—"}</td>
        <td
          className="px-2 py-2 text-right tabular-nums"
          style={{ color: ins.targetHit ? GREEN : undefined, fontWeight: ins.targetHit ? 600 : undefined }}
          title={ins.targetPrice != null ? `Profit target +25% off avg cost${ins.targetHit ? " — reached" : ""}` : undefined}
        >
          {ins.targetPrice != null ? (
            <span className="inline-flex items-center justify-end gap-1">
              {ins.targetHit && <span aria-hidden>✓</span>}
              {ins.targetPrice.toLocaleString("en-IN")}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-2 py-2 text-right tabular-nums font-medium">{inr(ins.currentValue)}</td>
        <td className="px-2 py-2 text-right tabular-nums" style={{ color: ins.dayChangePct == null ? undefined : up(ins.dayChangePct) ? GREEN : RED }}>
          {pct(ins.dayChangePct)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums" style={{ color: up(ins.pnl) ? GREEN : RED }}>
          <div>{signed(ins.pnl)}</div>
          <div className="text-[10.5px]">{pct(ins.pnlPct)}</div>
        </td>
        <td className="px-2 py-2 text-center tabular-nums">
          {ins.isMapped ? (
            <span className="text-[11px]">
              {fmtScore(ins.q)}/{fmtScore(ins.v)}/{fmtScore(ins.m)}
            </span>
          ) : (
            <span className="muted-text">—</span>
          )}
        </td>
        <td className="px-2 py-2 text-center tabular-nums">
          {ins.isMapped && ins.peerRank != null ? (
            <span className="muted-text">{ins.peerRank}/{ins.peerCount}</span>
          ) : (
            <span className="muted-text">—</span>
          )}
        </td>
        <td
          className="px-2 py-2 text-right tabular-nums"
          style={{ color: ins.overHoldLimit ? RED : "var(--color-muted)" }}
          title={
            ins.monthsHeld != null
              ? `~${ins.monthsHeld} months since first tracked (import date, not actual buy date)${ins.overHoldLimit ? " — past 4-month limit" : ""}`
              : "No import date on record"
          }
        >
          {ins.monthsHeld != null ? `${ins.monthsHeld}m` : "—"}
        </td>
        <td className="px-3 py-2 text-right tabular-nums muted-text">{wt}%</td>
      </tr>
      {isOpen && ins.brokers.length > 1 && (
        <tr className="border-b hairline" style={{ background: "var(--color-paper)" }}>
          <td colSpan={13} className="px-3 py-2">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11.5px] pl-6">
              {ins.brokers.map((b, i) => (
                <span key={i} className="tabular-nums">
                  <strong>{b.brokerLabel}</strong>: {b.quantity} @ {b.avgCost != null ? inr(b.avgCost, 2) : "—"}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function fmtScore(v: number | null): string {
  return v == null ? "—" : Math.round(v).toString();
}

// ─────────────────────────── icons (inline SVG) ────────────────────────────
// Lucide-style 1.6px stroke, sized 1em so they scale with surrounding text.

type IconProps = { className?: string; size?: number };
function svg(size: number | undefined, className: string | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size ?? 16} height={size ?? 16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden
    >
      {children}
    </svg>
  );
}
const IconWallet = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2" /><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3" /><path d="M20 9h-4a2 2 0 0 0 0 6h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1Z" /><circle cx="16.5" cy="12" r="0.6" fill="currentColor" /></>);
const IconDeposit = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>);
const IconTrendUp = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M3 17l6-6 4 4 7-7" /><path d="M17 8h4v4" /></>);
const IconPulse = ({ className, size }: IconProps) =>
  svg(size, className, <path d="M3 12h4l2-6 4 12 2-6h6" />);
const IconChart = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M4 4v15a1 1 0 0 0 1 1h15" /><path d="m7 14 3-4 3 3 4-6" /></>);
const IconBank = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="m3 9 9-5 9 5" /><path d="M4 9h16v2H4z" /><path d="M6 11v7M10 11v7M14 11v7M18 11v7" /><path d="M3 21h18" /></>);
const IconPie = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M12 3a9 9 0 1 0 9 9h-9Z" /><path d="M12 3v9" /></>);
const IconList = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>);
const IconUpload = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M12 15V4" /><path d="m8 8 4-4 4 4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>);
const IconEdit = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>);
// Sector/industry glyphs for the holdings group headers.
const IconFactory = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M3 21V10l6 4V10l6 4V7l6 4v10Z" /><path d="M3 21h18" /></>);
const IconChip = ({ className, size }: IconProps) =>
  svg(size, className, <><rect x="7" y="7" width="10" height="10" rx="1" /><path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2" /></>);
const IconHealth = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M12 4v16M4 12h16" /><rect x="3" y="3" width="18" height="18" rx="4" /></>);
const IconCart = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M3 4h2l2.4 12.4a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 8H6" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>);
const IconEnergy = ({ className, size }: IconProps) =>
  svg(size, className, <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />);
const IconCar = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M4 13l1.5-4.5A2 2 0 0 1 7.4 7h9.2a2 2 0 0 1 1.9 1.5L20 13" /><path d="M3 13h18v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /><circle cx="7" cy="16" r="0.6" fill="currentColor" /><circle cx="17" cy="16" r="0.6" fill="currentColor" /></>);
const IconBuilding = ({ className, size }: IconProps) =>
  svg(size, className, <><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" /><path d="M3 21h18" /></>);
const IconFlask = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M9 3h6M10 3v6l-5 9a1 1 0 0 0 .9 1.5h12.2A1 1 0 0 0 19 18l-5-9V3" /><path d="M7.5 14h9" /></>);
const IconLayers = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>);

/** Keyword-matched icon for a sector / industry group header. */
function groupIcon(label: string): React.ReactNode {
  const s = label.toLowerCase();
  const has = (...w: string[]) => w.some((x) => s.includes(x));
  if (has("etf", "fund", "unscored")) return <IconLayers size={13} />;
  if (has("bank", "financ", "nbfc", "insur", "capital market", "broking")) return <IconBank size={13} />;
  if (has("it ", "software", "tech", "semiconduct", "electronic", "hardware", "internet", "telecom")) return <IconChip size={13} />;
  if (has("pharma", "health", "hospital", "medic", "diagnost", "biotech")) return <IconHealth size={13} />;
  if (has("auto", "vehicle", "tyre", "oem")) return <IconCar size={13} />;
  if (has("energy", "oil", "gas", "power", "utilit", "coal", "petro")) return <IconEnergy size={13} />;
  if (has("chemical", "fertil", "paint", "agro")) return <IconFlask size={13} />;
  if (has("realty", "real estate", "cement", "construct", "infra", "housing")) return <IconBuilding size={13} />;
  if (has("consum", "fmcg", "retail", "food", "beverage", "apparel", "textile", "durable", "staple")) return <IconCart size={13} />;
  if (has("industrial", "manufactur", "metal", "steel", "machin", "capital good", "engineer", "product")) return <IconFactory size={13} />;
  return <IconList size={13} />;
}

/** Section heading with a tinted icon chip — the repeated visual motif. */
function SectionHead({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
          style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
        >
          {icon}
        </span>
        <h2 className="text-[14px] font-semibold">{title}</h2>
      </div>
      {right}
    </div>
  );
}
