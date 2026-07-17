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
import { Fragment, useRef, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import type { Portfolio, Instrument, CurvePoint } from "@/lib/portfolio";

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

type ImportResult = {
  ok?: boolean;
  brokerLabel?: string;
  imported?: number;
  mapped?: number;
  unmapped?: number;
  unmappedSymbols?: string[];
  error?: string;
};

export function PortfolioClient({ portfolio, curve }: { portfolio: Portfolio; curve: CurvePoint[] }) {
  const router = useRouter();
  const [broker, setBroker] = useState<string>("zerodha");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setResult({ error: "Choose a holdings file first." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("broker", broker);
      fd.append("file", file);
      const r = await fetch("/api/portfolio/import", { method: "POST", body: fd, credentials: "include" });
      const data: ImportResult = await r.json();
      if (!r.ok) {
        setResult({ error: data.error ?? `Import failed (HTTP ${r.status})` });
      } else {
        setResult(data);
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
      <header className="mb-6">
        <h1 className="font-display text-[26px] md:text-[30px] leading-[1.1] tracking-tight">
          Your portfolio
        </h1>
        <p className="muted-text text-[13px] mt-1">
          Holdings imported from your brokers, re-priced live and scored on Q/V/M.
          Current holdings only — values derived at read time, not tax-accurate.
        </p>
      </header>

      <ImportPanel
        broker={broker}
        setBroker={setBroker}
        busy={busy}
        result={result}
        fileRef={fileRef}
        onUpload={onUpload}
        brokers={portfolio.brokers}
      />

      {!portfolio.hasHoldings ? (
        <div className="card p-8 text-center mt-6">
          <h2 className="font-display text-[20px] mb-2">No holdings yet</h2>
          <p className="muted-text text-[13px] max-w-md mx-auto">
            Import a holdings export from any of the five brokers above to see your
            portfolio valued, allocated and scored. Re-importing a broker replaces
            just that broker&apos;s rows.
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
          <HoldingsTable instruments={portfolio.instruments} totalValue={t.currentValue} />
        </>
      )}
    </>
  );
}

// ─────────────────────────── import panel ──────────────────────────────────

function ImportPanel({
  broker, setBroker, busy, result, fileRef, onUpload, brokers,
}: {
  broker: string;
  setBroker: (b: string) => void;
  busy: boolean;
  result: ImportResult | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: () => void;
  brokers: string[];
}) {
  return (
    <div className="card p-4 md:p-5">
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
            Holdings file (.csv, .xlsx or .xls)
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
        Re-importing a broker <strong>replaces</strong> that broker&apos;s holdings. Upload the
        broker&apos;s holdings export as-is — <code>.csv</code>, <code>.xlsx</code> and 5paisa&apos;s
        legacy <code>.xls</code> are all accepted.
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

function HoldingsTable({ instruments, totalValue }: { instruments: Instrument[]; totalValue: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<GroupMode>("sector");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = buildGroups(instruments, mode);

  const toggleGroup = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <div className="card mt-6 overflow-hidden">
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
              <th className="text-left font-semibold px-3 py-2">Instrument</th>
              <th className="text-right font-semibold px-2 py-2">Qty</th>
              <th className="text-right font-semibold px-2 py-2">Avg</th>
              <th className="text-right font-semibold px-2 py-2">Price</th>
              <th className="text-right font-semibold px-2 py-2">Value</th>
              <th className="text-right font-semibold px-2 py-2">Day</th>
              <th className="text-right font-semibold px-2 py-2">P&L</th>
              <th className="text-center font-semibold px-2 py-2">Q/V/M</th>
              <th className="text-center font-semibold px-2 py-2">Rank</th>
              <th className="text-right font-semibold px-3 py-2">Wt</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
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
                      <td colSpan={3} />
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{inr(g.value)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: up(g.dayChange) ? GREEN : RED }}>
                        {signed(g.dayChange)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold" style={{ color: up(g.pnl) ? GREEN : RED }}>
                        {signed(g.pnl)}
                      </td>
                      <td colSpan={2} />
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
              <div className="text-[10.5px] muted-text truncate max-w-[220px]">
                {ins.isMapped ? ins.name : "Outside coverage — unscored"}
                {ins.brokers.length > 1 && <span> · {ins.brokers.length} brokers</span>}
              </div>
            </div>
          </div>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{ins.quantity}</td>
        <td className="px-2 py-2 text-right tabular-nums">{ins.avgCost != null ? ins.avgCost.toLocaleString("en-IN") : "—"}</td>
        <td className="px-2 py-2 text-right tabular-nums">{ins.price != null ? ins.price.toLocaleString("en-IN") : "—"}</td>
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
        <td className="px-3 py-2 text-right tabular-nums muted-text">{wt}%</td>
      </tr>
      {isOpen && ins.brokers.length > 1 && (
        <tr className="border-b hairline" style={{ background: "var(--color-paper)" }}>
          <td colSpan={10} className="px-3 py-2">
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
