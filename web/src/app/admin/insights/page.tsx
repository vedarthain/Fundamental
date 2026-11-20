import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Site Insights & Speed — Admin",
  robots: { index: false, follow: false },
};

type RangeKey = "24h" | "7d" | "30d";

function parseRange(raw?: string): { key: RangeKey; intervalSql: string; label: string } {
  if (raw === "24h") return { key: "24h", intervalSql: "24 hours", label: "Last 24 hours" };
  if (raw === "30d") return { key: "30d", intervalSql: "30 days", label: "Last 30 days" };
  return { key: "7d", intervalSql: "7 days", label: "Last 7 days" };
}

function fmtMs(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`;
  return `${Math.round(v)}ms`;
}

function vitalTone(metric: "ttfb" | "fcp" | "lcp" | "inp" | "cls", v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "bg-slate-100 text-slate-500 border-slate-200";
  const thresholds: Record<typeof metric, [number, number]> = {
    ttfb: [800, 1800],
    fcp: [1800, 3000],
    lcp: [2500, 4000],
    inp: [200, 500],
    cls: [0.1, 0.25],
  };
  const [good, poor] = thresholds[metric];
  if (v <= good) return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (v <= poor) return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-rose-50 text-rose-800 border-rose-200";
}

function vitalLabel(metric: "ttfb" | "fcp" | "lcp" | "inp" | "cls", v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "No data";
  const thresholds: Record<typeof metric, [number, number]> = {
    ttfb: [800, 1800],
    fcp: [1800, 3000],
    lcp: [2500, 4000],
    inp: [200, 500],
    cls: [0.1, 0.25],
  };
  const [good, poor] = thresholds[metric];
  if (v <= good) return "Good";
  if (v <= poor) return "Needs work";
  return "Poor";
}

export default async function AdminInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  if (!(await isAdminRequest())) redirect("/");

  const sp = await searchParams;
  const range = parseRange(sp.range);

  // Fail soft if table hasn't received its first event yet
  const summaryRows = await sql<{
    pageviews: number;
    sessions: number;
    engaged: number;
    mobile_views: number;
    desktop_views: number;
    ttfb_p75: number | null;
    fcp_p75: number | null;
    lcp_p75: number | null;
    inp_p75: number | null;
    cls_p75: number | null;
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS pageviews,
      COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'pageview')::int AS sessions,
      COUNT(*) FILTER (WHERE event_type = 'engaged')::int AS engaged,
      COUNT(*) FILTER (WHERE event_type = 'pageview' AND device = 'mobile')::int AS mobile_views,
      COUNT(*) FILTER (WHERE event_type = 'pageview' AND device = 'desktop')::int AS desktop_views,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ttfb_ms) FILTER (WHERE ttfb_ms IS NOT NULL)::float AS ttfb_p75,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY fcp_ms) FILTER (WHERE fcp_ms IS NOT NULL)::float AS fcp_p75,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY lcp_ms) FILTER (WHERE lcp_ms IS NOT NULL)::float AS lcp_p75,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY inp_ms) FILTER (WHERE inp_ms IS NOT NULL)::float AS inp_p75,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cls) FILTER (WHERE cls IS NOT NULL)::float AS cls_p75
    FROM app.web_insight_event
    WHERE created_at >= NOW() - (${range.intervalSql})::interval
  `.catch(() => []);

  const routeRows = await sql<{
    path: string;
    views: number;
    sessions: number;
    engaged: number;
    ttfb_med: number | null;
    lcp_p75: number | null;
    inp_p75: number | null;
  }[]>`
    SELECT
      path,
      COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS views,
      COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'pageview')::int AS sessions,
      COUNT(*) FILTER (WHERE event_type = 'engaged')::int AS engaged,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ttfb_ms) FILTER (WHERE ttfb_ms IS NOT NULL)::float AS ttfb_med,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY lcp_ms) FILTER (WHERE lcp_ms IS NOT NULL)::float AS lcp_p75,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY inp_ms) FILTER (WHERE inp_ms IS NOT NULL)::float AS inp_p75
    FROM app.web_insight_event
    WHERE created_at >= NOW() - (${range.intervalSql})::interval
    GROUP BY path
    ORDER BY views DESC, lcp_p75 DESC NULLS LAST
    LIMIT 30
  `.catch(() => []);

  const dailyRows = await sql<{
    day: string;
    views: number;
    sessions: number;
    lcp_p75: number | null;
  }[]>`
    SELECT
      to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
      COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS views,
      COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'pageview')::int AS sessions,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY lcp_ms) FILTER (WHERE lcp_ms IS NOT NULL)::float AS lcp_p75
    FROM app.web_insight_event
    WHERE created_at >= NOW() - (${range.intervalSql})::interval
    GROUP BY 1
    ORDER BY 1 ASC
  `.catch(() => []);

  const referrerRows = await sql<{
    referrer: string;
    views: number;
  }[]>`
    SELECT
      COALESCE(NULLIF(referrer, ''), 'Direct / Internal') AS referrer,
      COUNT(*)::int AS views
    FROM app.web_insight_event
    WHERE event_type = 'pageview'
      AND created_at >= NOW() - (${range.intervalSql})::interval
    GROUP BY 1
    ORDER BY views DESC
    LIMIT 10
  `.catch(() => []);

  const s = summaryRows[0] ?? {
    pageviews: 0,
    sessions: 0,
    engaged: 0,
    mobile_views: 0,
    desktop_views: 0,
    ttfb_p75: null,
    fcp_p75: null,
    lcp_p75: null,
    inp_p75: null,
    cls_p75: null,
  };

  const engagedPct = s.pageviews > 0 ? Math.min(100, (s.engaged / s.pageviews) * 100) : 0;
  const mobilePct = s.pageviews > 0 ? (s.mobile_views / s.pageviews) * 100 : 0;
  const maxDaily = Math.max(1, ...dailyRows.map((d) => d.views));

  const slowestRoutes = [...routeRows]
    .filter((r) => r.lcp_p75 != null || r.ttfb_med != null)
    .sort((a, b) => (b.lcp_p75 ?? b.ttfb_med ?? 0) - (a.lcp_p75 ?? a.ttfb_med ?? 0))
    .slice(0, 10);

  return (
    <main className="mx-auto max-w-[1400px] px-3 sm:px-5 py-4 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          eyebrow="Admin · Self-Hosted DigitalOcean Telemetry"
          title="Site Insights & Speed Vitals"
          subtitle={`Real user pageviews, human engagement, and Core Web Vitals (${range.label}) — stored in your Postgres DB.`}
        />
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border hairline text-xs">
          {(["24h", "7d", "30d"] as const).map((k) => (
            <Link
              key={k}
              href={`/admin/insights?range=${k}`}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                range.key === k ? "bg-slate-900 text-white shadow-2xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {k.toUpperCase()}
            </Link>
          ))}
        </div>
      </div>

      {/* Traffic Hero Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border hairline bg-white p-4 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Pageviews</div>
          <div className="text-2xl font-mono font-bold text-slate-900 mt-1">{s.pageviews.toLocaleString("en-IN")}</div>
          <div className="text-xs text-slate-500 mt-0.5">{s.sessions.toLocaleString("en-IN")} unique sessions</div>
        </div>
        <div className="rounded-xl border hairline bg-white p-4 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Human Engagement</div>
          <div className="text-2xl font-mono font-bold text-emerald-700 mt-1">{engagedPct.toFixed(1)}%</div>
          <div className="text-xs text-slate-500 mt-0.5">{s.engaged.toLocaleString("en-IN")} engaged views</div>
        </div>
        <div className="rounded-xl border hairline bg-white p-4 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Device Split</div>
          <div className="text-2xl font-mono font-bold text-slate-900 mt-1">
            {(100 - mobilePct).toFixed(0)}% <span className="text-sm font-normal text-slate-500">Desk</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {mobilePct.toFixed(0)}% Mobile ({s.mobile_views} / {s.desktop_views})
          </div>
        </div>
        <div className="rounded-xl border hairline bg-white p-4 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Speed Summary (p75 LCP)</div>
          <div className="text-2xl font-mono font-bold text-slate-900 mt-1">{fmtMs(s.lcp_p75)}</div>
          <div className="text-xs text-slate-500 mt-0.5">TTFB p75: {fmtMs(s.ttfb_p75)}</div>
        </div>
      </div>

      {/* Core Web Vitals Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(
          [
            { key: "ttfb", label: "TTFB (p75)", sub: "Server response", val: s.ttfb_p75, fmt: fmtMs(s.ttfb_p75) },
            { key: "fcp", label: "FCP (p75)", sub: "First paint", val: s.fcp_p75, fmt: fmtMs(s.fcp_p75) },
            { key: "lcp", label: "LCP (p75)", sub: "Main content load", val: s.lcp_p75, fmt: fmtMs(s.lcp_p75) },
            { key: "inp", label: "INP (p75)", sub: "Interaction delay", val: s.inp_p75, fmt: fmtMs(s.inp_p75) },
            { key: "cls", label: "CLS (p75)", sub: "Layout shift", val: s.cls_p75, fmt: s.cls_p75 != null ? s.cls_p75.toFixed(3) : "—" },
          ] as const
        ).map((m) => (
          <div key={m.key} className={`rounded-xl border p-3.5 ${vitalTone(m.key, m.val)}`}>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide">
              <span>{m.label}</span>
              <span className="text-[10px] opacity-80">{vitalLabel(m.key, m.val)}</span>
            </div>
            <div className="text-xl font-mono font-bold mt-1">{m.fmt}</div>
            <div className="text-[11px] opacity-75 mt-0.5">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Daily Trend */}
      {dailyRows.length > 0 && (
        <div className="rounded-xl border hairline bg-white p-4 shadow-2xs">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Daily Pageviews Trend</h2>
          <div className="flex items-end gap-1.5 h-32 pt-4 border-b border-slate-100">
            {dailyRows.map((d) => (
              <div key={d.day} className="group relative flex-1 flex flex-col items-center h-full justify-end min-w-[14px]">
                <div className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-slate-900 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                  {d.day}: {d.views} views · LCP {fmtMs(d.lcp_p75)}
                </div>
                <div
                  className="w-full max-w-[36px] rounded-t bg-indigo-500/80 group-hover:bg-indigo-600 transition-colors"
                  style={{ height: `${Math.max(6, (d.views / maxDaily) * 100)}%` }}
                />
                <span className="text-[9.5px] font-mono text-slate-400 mt-1 truncate w-full text-center">
                  {d.day.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tables: Top Pages + Slowest Routes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border hairline bg-white p-4 shadow-2xs overflow-x-auto">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Top Pages</h2>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-2">Route</th>
                <th className="py-2 px-2 text-right">Views</th>
                <th className="py-2 px-2 text-right">Sessions</th>
                <th className="py-2 px-2 text-right">Engaged</th>
                <th className="py-2 pl-2 text-right">TTFB / LCP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {routeRows.map((r) => (
                <tr key={r.path} className="hover:bg-slate-50">
                  <td className="py-1.5 pr-2 font-mono text-indigo-700 truncate max-w-[220px]">{r.path}</td>
                  <td className="py-1.5 px-2 text-right font-mono font-semibold">{r.views}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-600">{r.sessions}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-emerald-700">
                    {r.views > 0 ? `${Math.min(100, Math.round((r.engaged / r.views) * 100))}%` : "—"}
                  </td>
                  <td className="py-1.5 pl-2 text-right font-mono text-slate-700 whitespace-nowrap">
                    {fmtMs(r.ttfb_med)} / {fmtMs(r.lcp_p75)}
                  </td>
                </tr>
              ))}
              {routeRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    No insights collected yet — browse a few pages and refresh!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border hairline bg-white p-4 shadow-2xs overflow-x-auto">
            <h2 className="text-sm font-semibold text-slate-900 mb-2">Slowest Routes (by p75 LCP)</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-2">Route</th>
                  <th className="py-2 px-2 text-right">TTFB med</th>
                  <th className="py-2 px-2 text-right">LCP p75</th>
                  <th className="py-2 pl-2 text-right">INP p75</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {slowestRoutes.map((r) => (
                  <tr key={r.path} className="hover:bg-slate-50">
                    <td className="py-1.5 pr-2 font-mono text-slate-800 truncate max-w-[220px]">{r.path}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmtMs(r.ttfb_med)}</td>
                    <td className="py-1.5 px-2 text-right font-mono font-semibold text-amber-700">{fmtMs(r.lcp_p75)}</td>
                    <td className="py-1.5 pl-2 text-right font-mono text-slate-600">{fmtMs(r.inp_p75)}</td>
                  </tr>
                ))}
                {slowestRoutes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      Waiting for first Web Vitals samples…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border hairline bg-white p-4 shadow-2xs">
            <h2 className="text-sm font-semibold text-slate-900 mb-2">Top Referrers</h2>
            <div className="divide-y divide-slate-100 text-xs">
              {referrerRows.map((rf) => (
                <div key={rf.referrer} className="py-1.5 flex items-center justify-between">
                  <span className="font-mono text-slate-700">{rf.referrer}</span>
                  <span className="font-mono font-semibold text-slate-900">{rf.views}</span>
                </div>
              ))}
              {referrerRows.length === 0 && (
                <div className="py-4 text-center text-slate-400">No referrer data yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
