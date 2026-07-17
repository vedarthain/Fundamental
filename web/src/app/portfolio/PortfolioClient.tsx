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
import { useRef, useState } from "react";
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
            Holdings file (.csv or .xlsx)
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx"
            className="block w-full text-[13px] file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:bg-[var(--color-accent-600)] file:text-white"
          />
        </div>
        <button
          type="button"
          onClick={onUpload}
          disabled={busy}
          className="px-4 py-2 rounded-md font-medium text-[13px] transition-colors disabled:opacity-60"
          style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      <p className="muted-text text-[11.5px] mt-2 leading-snug">
        Re-importing a broker <strong>replaces</strong> that broker&apos;s holdings. 5paisa
        exports a legacy <code>.xls</code> — open it and re-save as <code>.csv</code> or{" "}
        <code>.xlsx</code> first.
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
      <Card label="Current value" value={inr(t.currentValue)} sub={`${t.holdingCount} instruments · ${t.mappedCount} scored`} />
      <Card label="Invested" value={inr(t.invested)} sub={snapshot ? `scores @ ${snapshot}` : undefined} />
      <Card
        label="Total P&L"
        value={signed(t.pnl)}
        valueColor={up(t.pnl) ? GREEN : RED}
        sub={pct(t.pnlPct)}
        subColor={up(t.pnlPct) ? GREEN : RED}
      />
      <Card
        label="Day change"
        value={signed(t.dayChangeValue)}
        valueColor={up(t.dayChangeValue) ? GREEN : RED}
        sub={pct(t.dayChangePct)}
        subColor={up(t.dayChangePct) ? GREEN : RED}
      />
    </div>
  );
}

function Card({
  label, value, sub, valueColor, subColor,
}: {
  label: string; value: string; sub?: string; valueColor?: string; subColor?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold muted-text uppercase tracking-wide">{label}</div>
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
        <h2 className="text-[14px] font-semibold mb-1">Performance vs NIFTY 500</h2>
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
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[14px] font-semibold">Performance vs NIFTY 500</h2>
        <span className="text-[11px] muted-text">rebased to 100 at {curve[0].date}</span>
      </div>
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
      <h2 className="text-[14px] font-semibold mb-2">{title}</h2>
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

function HoldingsTable({ instruments, totalValue }: { instruments: Instrument[]; totalValue: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="card mt-6 overflow-hidden">
      <div className="px-4 py-3 border-b hairline flex items-baseline justify-between">
        <h2 className="text-[14px] font-semibold">Holdings ({instruments.length})</h2>
        <span className="text-[11px] muted-text">clubbed per instrument · tap a row for per-broker split</span>
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
            {instruments.map((ins) => {
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
