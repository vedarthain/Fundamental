/**
 * /admin/validation — PRIVATE score-validation desk.
 *
 * Does the fundamental score predict forward returns? Shows Information
 * Coefficient (rank correlation of factor vs forward return) and top/bottom
 * decile spread, per weekly snapshot and forward horizon. See lib/validation.ts.
 *
 * Admin-gated (same flow as /admin/ideas): append ?token=<ADMIN_TOKEN> once to
 * set the cookie. Never linked from the public nav.
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import {
  getValidationReport, type FactorKey, type SnapshotResult,
} from "@/lib/validation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Score Validation — admin", robots: { index: false, follow: false } };

const FACTORS: { key: FactorKey; label: string }[] = [
  { key: "composite", label: "Composite" },
  { key: "quality", label: "Quality" },
  { key: "valuation", label: "Valuation" },
  { key: "momentum", label: "Momentum" },
];

/** IC colour: meaningful edge starts ~0.05; noise band is grey. */
function icColor(ic: number | null): string {
  if (ic == null) return "var(--color-muted)";
  if (ic >= 0.1) return "#15803d";
  if (ic >= 0.05) return "#65a30d";
  if (ic <= -0.05) return "#dc2626";
  return "var(--color-muted)"; // −0.05..0.05 = noise
}
function fmtIc(ic: number | null): string {
  return ic == null ? "—" : (ic >= 0 ? "+" : "") + ic.toFixed(3);
}
function pctColor(v: number | null): string {
  if (v == null) return "var(--color-muted)";
  return v > 0 ? "#15803d" : v < 0 ? "#dc2626" : "var(--color-muted)";
}
function fmtPct(v: number | null): string {
  return v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%";
}

export default async function ValidationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  if (sp.token) {
    redirect(`/api/admin/auth?token=${encodeURIComponent(sp.token)}&redirect=/admin/validation`);
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

  const report = await getValidationReport();

  return (
    <div className="mx-auto max-w-[1000px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-4">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-1">Private · not advice</div>
        <h1 className="font-display text-[26px] tracking-tight">Score validation</h1>
        <p className="muted-text text-[12.5px] mt-1">
          Does the fundamental score predict forward returns? Archive:{" "}
          <span className="ink-text">{report.archiveStart ?? "—"} → {report.archiveEnd ?? "—"}</span>{" "}
          · {report.totalSnapshots} snapshots · {report.universeLatest.toLocaleString("en-IN")} stocks scored latest.
        </p>
      </header>

      {/* Honesty banner — sample depth caveat */}
      <div
        className="rounded-md px-4 py-3 mb-6 text-[12.5px] leading-snug"
        style={{ background: "color-mix(in srgb, #d97706 9%, transparent)", color: "#92400e" }}
      >
        <strong>Read this first.</strong> The score archive is point-in-time only from{" "}
        {report.archiveStart ?? "—"} — a short, single-regime window. Treat these as a{" "}
        <em>readout, not a verdict</em>. IC near 0 (±0.05) is noise; the harness gains
        statistical power automatically as the archive grows each week.
      </div>

      {report.totalSnapshots === 0 ? (
        <div className="card p-10 text-center muted-text text-[13.5px]">
          No scored snapshots found in app.scores.
        </div>
      ) : (
        <>
          {/* Summary: avg IC per factor at each horizon */}
          <section className="card overflow-hidden mb-6">
            <div className="px-4 py-2.5 border-b hairline">
              <div className="font-display text-[14px]">Average Information Coefficient</div>
              <div className="muted-text text-[11px] mt-0.5">
                Mean Spearman IC across snapshots with ≥ horizon forward data. Higher = the factor rank predicts forward-return rank.
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left muted-text text-[10.5px] uppercase tracking-wide" style={{ background: "var(--color-paper)" }}>
                    <th className="px-4 py-2.5">Horizon</th>
                    {FACTORS.map((f) => <th key={f.key} className="px-4 py-2.5 text-right">{f.label}</th>)}
                    <th className="px-4 py-2.5 text-right">Decile spread</th>
                    <th className="px-4 py-2.5 text-right">Snaps</th>
                  </tr>
                </thead>
                <tbody>
                  {report.horizons.map((h) => (
                    <tr key={h.horizon} className="border-t hairline">
                      <td className="px-4 py-2.5 font-medium">{h.horizon} TD</td>
                      {FACTORS.map((f) => (
                        <td key={f.key} className="px-4 py-2.5 text-right tabular-nums font-semibold" style={{ color: icColor(h.avgIc[f.key]) }}>
                          {fmtIc(h.avgIc[f.key])}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold" style={{ color: pctColor(h.avgSpread) }}>
                        {fmtPct(h.avgSpread)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums muted-text">{h.nSnapshots}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Per-snapshot detail, one table per horizon */}
          {report.horizons.map((h) => (
            <section key={h.horizon} className="card overflow-hidden mb-6">
              <div className="px-4 py-2.5 border-b hairline flex items-baseline justify-between">
                <div className="font-display text-[14px]">Per-snapshot · {h.horizon} trading-day horizon</div>
                <div className="muted-text text-[11px]">
                  top/bot = mean fwd return of top/bottom composite decile
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left muted-text text-[10px] uppercase tracking-wide" style={{ background: "var(--color-paper)" }}>
                      <th className="px-4 py-2">Snapshot</th>
                      <th className="px-4 py-2 text-right">n</th>
                      {FACTORS.map((f) => <th key={f.key} className="px-4 py-2 text-right">{f.label}</th>)}
                      <th className="px-4 py-2 text-right">Top</th>
                      <th className="px-4 py-2 text-right">Bot</th>
                      <th className="px-4 py-2 text-right">Spread</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.snapshots.map((s: SnapshotResult) => {
                      const insufficient = s.n < 30;
                      return (
                        <tr key={s.snapshot} className="border-t hairline" style={insufficient ? { opacity: 0.45 } : undefined}>
                          <td className="px-4 py-2 tabular-nums">{s.snapshot}</td>
                          <td className="px-4 py-2 text-right tabular-nums muted-text">{s.n || "—"}</td>
                          {insufficient ? (
                            <td className="px-4 py-2 muted-text text-[11px]" colSpan={FACTORS.length + 3}>
                              insufficient forward data
                            </td>
                          ) : (
                            <>
                              {FACTORS.map((f) => (
                                <td key={f.key} className="px-4 py-2 text-right tabular-nums" style={{ color: icColor(s.ic[f.key]) }}>
                                  {fmtIc(s.ic[f.key])}
                                </td>
                              ))}
                              <td className="px-4 py-2 text-right tabular-nums" style={{ color: pctColor(s.topDecileRet) }}>{fmtPct(s.topDecileRet)}</td>
                              <td className="px-4 py-2 text-right tabular-nums" style={{ color: pctColor(s.botDecileRet) }}>{fmtPct(s.botDecileRet)}</td>
                              <td className="px-4 py-2 text-right tabular-nums font-semibold" style={{ color: pctColor(s.spread) }}>{fmtPct(s.spread)}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <p className="muted-text text-[11px]">
            Generated {new Date(report.generatedAt).toLocaleString("en-IN")}. Cached 6h.
            IC = Spearman rank correlation (factor vs forward return). TD = trading days.
          </p>
        </>
      )}
    </div>
  );
}
