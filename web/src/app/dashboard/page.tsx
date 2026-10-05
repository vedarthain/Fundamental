/**
 * /dashboard — signed-in home. Morning scan: attention + equity book.
 *
 * Not a paste of /portfolio or /watchlist. Those stay the workspaces.
 * `/` stays the public marketing page (ISR 24h). Do not branch it on auth.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SIGNED_IN_HOME } from "@/lib/homePath";
import { loadPortfolio, type Instrument, type Portfolio } from "@/lib/portfolio";
import { loadFiiDii, type FiiDay } from "@/lib/fiiDii";
import { AttentionStrip } from "@/components/AttentionStrip";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · EquityRoots" };

const HOLD_N = 8;
const FII_DAYS = 5;

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(SIGNED_IN_HOME)}`);
  }

  const [portfolio, fii] = await Promise.all([
    loadPortfolio(session.userId),
    loadFiiDii(FII_DAYS),
  ]);

  return (
    <div className="mx-auto max-w-[1300px] px-4 md:px-6 py-5 md:py-6">
      <h1 className="font-display text-[22px] md:text-[26px] leading-[1.1] tracking-tight mb-3">
        Home
      </h1>
      <AttentionStrip
        userId={session.userId}
        staleBrokers={portfolio.brokerSnapshots.map((b) => ({
          label: b.label,
          ageDays: b.ageDays,
        }))}
      />
      <FiiDiiCard days={fii} />
      {!portfolio.hasHoldings ? <EmptyHome /> : <DashboardBody portfolio={portfolio} />}
    </div>
  );
}

function FiiDiiCard({ days }: { days: FiiDay[] }) {
  if (days.length === 0) return null;
  const latest = days[0];
  const chrono = [...days].reverse();
  const fiiSum = sumNets(days.map((d) => d.fii_net));
  const diiSum = sumNets(days.map((d) => d.dii_net));
  const peak = Math.max(
    1,
    ...days.flatMap((d) => [Math.abs(d.fii_net ?? 0), Math.abs(d.dii_net ?? 0)]),
  );

  return (
    <section
      className="rounded-md border hairline p-3 mb-4"
      style={{ backgroundColor: "var(--color-card)" }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-[13px] font-semibold">FII / DII</h2>
        <span className="muted-text text-[11px] tabular-nums">
          Cash market · as of {fmtDay(latest.date)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Flow label="FII" net={latest.fii_net} />
        <Flow label="DII" net={latest.dii_net} />
      </div>
      <div className="flex gap-1.5 mb-2">
        {chrono.map((d) => (
          <div key={d.date} className="flex-1 min-w-0" title={fmtDay(d.date)}>
            <div className="flex items-end gap-px h-10">
              <Spark v={d.fii_net} peak={peak} kind="fii" />
              <Spark v={d.dii_net} peak={peak} kind="dii" />
            </div>
          </div>
        ))}
      </div>
      <p className="muted-text text-[11px]">
        Last {days.length} sessions{" "}
        <span className="tabular-nums">
          FII {cr(fiiSum)} · DII {cr(diiSum)}
        </span>
      </p>
    </section>
  );
}

function Flow({ label, net }: { label: string; net: number | null }) {
  const up = net != null && net >= 0;
  return (
    <div>
      <div className="text-[11px] muted-text">{label} net</div>
      <div
        className="font-mono text-[16px] font-semibold tabular-nums"
        style={{
          color:
            net == null
              ? undefined
              : up
                ? "var(--color-delta-up)"
                : "var(--color-delta-down)",
        }}
      >
        {net == null ? "—" : cr(net)}
      </div>
    </div>
  );
}

function Spark({
  v,
  peak,
  kind,
}: {
  v: number | null;
  peak: number;
  kind: "fii" | "dii";
}) {
  const n = v ?? 0;
  const h = Math.max(2, Math.round((Math.abs(n) / peak) * 40));
  const up = n >= 0;
  return (
    <div
      className="flex-1 rounded-sm"
      style={{
        height: h,
        backgroundColor: up ? "var(--color-delta-up)" : "var(--color-delta-down)",
        opacity: kind === "fii" ? 0.9 : 0.4,
      }}
    />
  );
}

function EmptyHome() {
  return (
    <div className="card p-8 text-center max-w-[520px] mx-auto mt-6">
      <h2 className="font-display text-[20px] mb-2">Nothing in the book yet</h2>
      <p className="muted-text text-[13px] mb-5">
        Import holdings. This page fills from the book — it does not invent a
        market view.
      </p>
      <div className="flex flex-wrap justify-center gap-2 text-[13px]">
        <Link
          href="/portfolio"
          className="px-4 py-2 rounded-md font-medium"
          style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
        >
          Import holdings
        </Link>
        <Link
          href="/tools/screener"
          className="px-4 py-2 rounded-md border font-medium"
          style={{ borderColor: "var(--color-border-default)" }}
        >
          Find names
        </Link>
      </div>
    </div>
  );
}

function DashboardBody({ portfolio }: { portfolio: Portfolio }) {
  // Equities only — same `isMapped` split as /portfolio's Stocks tab. ETFs
  // and funds stay on that page under Others; mixing them here made a
  // gold ETF outrank the book.
  const equities = portfolio.instruments.filter((i) => i.isMapped);
  let invested = 0;
  let currentValue = 0;
  let pnl = 0;
  let dayChangeValue = 0;
  let dayBase = 0;
  for (const i of equities) {
    invested += i.invested;
    currentValue += i.currentValue;
    pnl += i.pnl;
    if (i.dayChangeValue != null) {
      dayChangeValue += i.dayChangeValue;
      dayBase += i.currentValue - i.dayChangeValue;
    }
  }
  const t = {
    invested,
    currentValue,
    pnl,
    pnlPct: invested > 0 ? (pnl / invested) * 100 : null,
    dayChangeValue,
    dayChangePct: dayBase > 0 ? (dayChangeValue / dayBase) * 100 : null,
    holdingCount: equities.length,
  };
  const top = [...equities]
    .sort((a, b) => b.currentValue - a.currentValue)
    .slice(0, HOLD_N);
  const movers = [...equities]
    .filter((i) => i.dayChangePct != null)
    .sort((a, b) => Math.abs(b.dayChangePct ?? 0) - Math.abs(a.dayChangePct ?? 0))
    .slice(0, 5);

  return (
    <>
      {equities.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
          <Kpi label="Value" value={inr(t.currentValue)} sub={`${t.holdingCount} names`} />
          <Kpi label="Invested" value={inr(t.invested)} />
          <Kpi
            label="P&L"
            value={signed(t.pnl)}
            sub={t.pnlPct != null ? pct(t.pnlPct) : undefined}
            up={t.pnl >= 0}
          />
          <Kpi
            label="Day"
            value={signed(t.dayChangeValue)}
            sub={t.dayChangePct != null ? pct(t.dayChangePct) : undefined}
            up={(t.dayChangeValue ?? 0) >= 0}
          />
        </div>
      )}

      <Panel title="Holdings" href="/portfolio" count={equities.length || undefined}>
        {equities.length === 0 ? (
          <p className="muted-text text-[13px] py-3">
            No equity holdings — ETFs and funds stay on{" "}
            <Link href="/portfolio" className="underline" style={{ color: "var(--color-accent-700)" }}>
              Portfolio
            </Link>
            .
          </p>
        ) : (
          <>
            <MiniTable
              headers={["Name", "Value", "Day", "P&L"]}
              rows={top.map((i) => [
                <NameCell key={i.key} inst={i} />,
                inr(i.currentValue),
                <Delta key={`${i.key}-d`} v={i.dayChangePct} />,
                <Delta key={`${i.key}-p`} v={i.pnlPct} />,
              ])}
            />
            {movers.length > 0 && (
              <p className="muted-text text-[11px] mt-2">
                Today:{" "}
                {movers.map((i, n) => (
                  <span key={i.key}>
                    {n > 0 ? " · " : ""}
                    {i.symbol ?? i.name}{" "}
                    <Delta v={i.dayChangePct} />
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

function Panel({
  title,
  href,
  count,
  children,
}: {
  title: string;
  href: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-md border hairline p-3"
      style={{ backgroundColor: "var(--color-card)" }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-[13px] font-semibold">
          {title}
          {count != null && (
            <span className="muted-text font-normal tabular-nums"> {count}</span>
          )}
        </h2>
        <Link href={href} className="text-[11px]" style={{ color: "var(--color-accent-700)" }}>
          Open
        </Link>
      </div>
      {children}
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  up,
}: {
  label: string;
  value: string;
  sub?: string;
  up?: boolean;
}) {
  const color =
    up == null ? undefined : up ? "var(--color-delta-up)" : "var(--color-delta-down)";
  return (
    <div
      className="rounded-md border hairline px-3 py-2"
      style={{ backgroundColor: "var(--color-card)" }}
    >
      <div className="text-[11px] muted-text">{label}</div>
      <div className="font-mono text-[16px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] tabular-nums" style={{ color }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function MiniTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={h}
              className={`pb-1 font-normal muted-text text-[11px] ${i === 0 ? "text-left" : "text-right"}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="border-t hairline">
            {row.map((cell, ci) => (
              <td
                key={ci}
                className={`py-1 tabular-nums ${ci === 0 ? "text-left" : "text-right"}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NameCell({ inst }: { inst: Instrument }) {
  const label = inst.symbol ?? inst.name;
  if (inst.symbol) {
    return (
      <Link href={`/stock/${encodeURIComponent(inst.symbol)}`} className="font-mono font-medium">
        {label}
      </Link>
    );
  }
  return <span>{label}</span>;
}

function Delta({ v }: { v: number | null }) {
  if (v == null) return <span className="muted-text">—</span>;
  const up = v >= 0;
  return (
    <span style={{ color: up ? "var(--color-delta-up)" : "var(--color-delta-down)" }}>
      {pct(v)}
    </span>
  );
}

function inr(v: number): string {
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function signed(v: number): string {
  const body = Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return (v >= 0 ? "+₹" : "-₹") + body;
}
function pct(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}
function cr(v: number): string {
  const abs = Math.abs(Math.round(v)).toLocaleString("en-IN");
  return (v >= 0 ? "+" : "-") + "₹" + abs + " Cr";
}
function sumNets(xs: (number | null)[]): number {
  return xs.reduce<number>((s, n) => s + (n ?? 0), 0);
}
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
