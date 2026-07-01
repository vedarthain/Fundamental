/**
 * /admin/recommendations — PRIVATE paper-trading desk.
 *
 * Locked weekly cohorts of the composite score's top-N picks, each with a fixed
 * entry / stop / target / horizon, settled at read time against golden OHLC.
 * This is a PAPER track record — no orders are placed — built to find out
 * whether the score's picks actually work. The signal is not yet validated
 * (see /admin/validation), so treat the win-rate as evidence-in-progress.
 *
 * Admin-gated (same flow as /admin/ideas): append ?token=<ADMIN_TOKEN> once to
 * set the cookie. Never linked from the public nav.
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import {
  getRecommendationReport, type SettledPick, type RecoStatus,
} from "@/lib/recommendations";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recommendation desk — admin", robots: { index: false, follow: false } };

function pctColor(v: number | null): string {
  if (v == null) return "var(--color-muted)";
  return v > 0 ? "#15803d" : v < 0 ? "#dc2626" : "var(--color-muted)";
}
function fmtPct(v: number | null): string {
  return v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
}
function fmtRs(v: number | null): string {
  return v == null ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

const STATUS_STYLE: Record<RecoStatus, { label: string; bg: string; fg: string }> = {
  TARGET:  { label: "TARGET",  bg: "color-mix(in srgb, #15803d 14%, transparent)", fg: "#15803d" },
  STOPPED: { label: "STOPPED", bg: "color-mix(in srgb, #dc2626 14%, transparent)", fg: "#dc2626" },
  EXPIRED: { label: "EXPIRED", bg: "color-mix(in srgb, #64748b 16%, transparent)", fg: "#475569" },
  OPEN:    { label: "OPEN",    bg: "color-mix(in srgb, #d97706 16%, transparent)", fg: "#92400e" },
  NO_DATA: { label: "NO DATA", bg: "color-mix(in srgb, #94a3b8 16%, transparent)", fg: "#64748b" },
};

function StatusBadge({ status }: { status: RecoStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
      style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-wide muted-text mb-1">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  if (sp.token) {
    redirect(`/api/admin/auth?token=${encodeURIComponent(sp.token)}&redirect=/admin/recommendations`);
  }
  if (!(await isAdminRequest())) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-[18px] font-display mb-2">Admin only</h1>
        <p className="muted-text text-[13px]">
          Append <code>?token=YOUR_TOKEN</code> to the URL.
        </p>
      </div>
    );
  }

  const report = await getRecommendationReport();
  const k = report.knobs;

  return (
    <div className="mx-auto max-w-[1100px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-4">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-1">Private · paper only · not advice</div>
        <h1 className="font-display text-[26px] tracking-tight">Recommendation desk</h1>
        <p className="muted-text text-[12.5px] mt-1">
          Locked weekly cohorts — top {k.topN} by composite score, entry at first close,
          stop −{(k.stopPct * 100).toFixed(0)}% / target +{(k.targetPct * 100).toFixed(0)}%,
          {" "}{k.horizonTd} trading-day horizon. Outcomes settle from OHLC on every view.
        </p>
      </header>

      {/* Honesty banner */}
      <div
        className="rounded-md px-4 py-3 mb-6 text-[12.5px] leading-snug"
        style={{ background: "color-mix(in srgb, #d97706 9%, transparent)", color: "#92400e" }}
      >
        <strong>Paper track record — not a trade sheet.</strong> These are the score&apos;s
        own picks, tracked honestly to test whether they work. The signal is{" "}
        <em>not yet validated</em> (see the validation desk — composite IC is still in the
        noise band). No orders are placed. Judge it by the win-rate below as it accrues,
        not by any single pick.
      </div>

      {report.totalPicks === 0 ? (
        <div className="card p-10 text-center muted-text text-[13.5px]">
          No cohorts generated yet. Hit{" "}
          <code>/api/admin/recommendations/generate?mode=backfill</code> once to seed history,
          then <code>?mode=latest</code> weekly.
        </div>
      ) : (
        <>
          {/* Aggregate scorecard */}
          <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
            <Stat label="Total picks" value={String(report.totalPicks)} />
            <Stat label="Closed" value={String(report.nClosed)} />
            <Stat label="Open" value={String(report.nOpen)} />
            <Stat label="Win rate (closed)"
              value={report.winRate == null ? "—" : (report.winRate * 100).toFixed(0) + "%"}
              color={report.winRate == null ? undefined : report.winRate >= 0.5 ? "#15803d" : "#dc2626"} />
            <Stat label="Avg return (closed)" value={fmtPct(report.avgRetClosed)} color={pctColor(report.avgRetClosed)} />
            <Stat label="Open unreal." value={fmtPct(report.avgRetOpenUnreal)} color={pctColor(report.avgRetOpenUnreal)} />
          </section>

          {report.nClosed > 0 && (
            <p className="muted-text text-[11.5px] mb-6 -mt-2">
              Closed best {fmtPct(report.bestClosed)} · worst {fmtPct(report.worstClosed)}.
              Win rate is the share of closed picks that ended positive.
            </p>
          )}

          {/* Per-cohort tables */}
          {report.cohorts.map((c) => (
            <section key={c.cohortDate} className="card overflow-hidden mb-6">
              <div className="px-4 py-2.5 border-b hairline flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-display text-[14px]">
                  Cohort {c.cohortDate}
                  <span className="muted-text text-[11px] font-normal"> · entry {c.entryDate ?? "—"}</span>
                </div>
                <div className="muted-text text-[11px] tabular-nums">
                  {c.nClosed}/{c.nPicks} closed · win {c.winRate == null ? "—" : (c.winRate * 100).toFixed(0) + "%"}
                  {" · "}
                  <span style={{ color: pctColor(c.avgRetClosed) }}>avg {fmtPct(c.avgRetClosed)}</span>
                  {c.nOpen > 0 && <> · <span style={{ color: pctColor(c.avgRetOpenUnreal) }}>open {fmtPct(c.avgRetOpenUnreal)}</span></>}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left muted-text text-[10px] uppercase tracking-wide" style={{ background: "var(--color-paper)" }}>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Symbol</th>
                      <th className="px-3 py-2 text-right">Comp</th>
                      <th className="px-3 py-2 text-right">Entry</th>
                      <th className="px-3 py-2 text-right">Stop</th>
                      <th className="px-3 py-2 text-right">Target</th>
                      <th className="px-3 py-2 text-right">Now / Exit</th>
                      <th className="px-3 py-2 text-right">Return</th>
                      <th className="px-3 py-2 text-right">Days</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.picks.map((p: SettledPick) => (
                      <tr key={p.id} className="border-t hairline">
                        <td className="px-3 py-2 tabular-nums muted-text">{p.rank}</td>
                        <td className="px-3 py-2 font-medium">{p.symbol}</td>
                        <td className="px-3 py-2 text-right tabular-nums muted-text">{p.compositePct ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtRs(p.entryPrice)}</td>
                        <td className="px-3 py-2 text-right tabular-nums muted-text">{fmtRs(p.stopPrice)}</td>
                        <td className="px-3 py-2 text-right tabular-nums muted-text">{fmtRs(p.targetPrice)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtRs(p.markPrice)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: pctColor(p.retPct) }}>{fmtPct(p.retPct)}</td>
                        <td className="px-3 py-2 text-right tabular-nums muted-text">{p.daysHeldTd ?? "—"}</td>
                        <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <p className="muted-text text-[11px]">
            Generated {new Date(report.generatedAt).toLocaleString("en-IN")}. Cached 1h.
            Stop/target hits detected from daily high/low; if both trip same day we assume the
            stop filled first (conservative). Entry/stop/target are immutable once stamped.
          </p>
        </>
      )}
    </div>
  );
}
