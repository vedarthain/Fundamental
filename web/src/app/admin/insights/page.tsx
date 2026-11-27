import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import os from "node:os";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import InsightsTabs, { type InsightsSection } from "./InsightsTabs";
import { LiveInfraPanel } from "./LiveInfraPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Site Insights & Server Performance — Admin",
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

function fmtBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtUptime(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}

function vitalTone(metric: "ttfb" | "fcp" | "lcp" | "inp" | "cls", v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:border-slate-700";
  const thresholds: Record<typeof metric, [number, number]> = {
    ttfb: [800, 1800],
    fcp: [1800, 3000],
    lcp: [2500, 4000],
    inp: [200, 500],
    cls: [0.1, 0.25],
  };
  const [good, poor] = thresholds[metric];
  if (v <= good) return "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";
  if (v <= poor) return "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800";
  return "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800";
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
  searchParams: Promise<{ range?: string; section?: string }>;
}) {
  if (!(await isAdminRequest())) redirect("/");

  const sp = await searchParams;
  const range = parseRange(sp.range);
  const section: InsightsSection = (sp.section as InsightsSection) || "all";

  // ── Database Ping Latency ──
  const t0 = performance.now();
  await sql`SELECT 1`.catch(() => []);
  const dbPingMs = Math.round(performance.now() - t0);

  // ── Concurrent Telemetry Queries ──
  const [
    summaryRows,
    routeRows,
    dailyRows,
    referrerRows,
    dbStatRows,
    connStatRows,
    maxConnRows,
    topTablesRows,
    pgVerRows,
    snapshotMetaRows,
  ] = await Promise.all([
    sql<{
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
    `.catch(() => []),

    sql<{
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
    `.catch(() => []),

    sql<{
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
    `.catch(() => []),

    sql<{
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
    `.catch(() => []),

    // DB Size, Cache Hits & Activity
    sql<{
      db_size: string;
      db_size_bytes: string;
      xact_commit: string;
      xact_rollback: string;
      blks_read: string;
      blks_hit: string;
      deadlocks: string;
    }[]>`
      SELECT
        pg_size_pretty(pg_database_size(current_database())) AS db_size,
        pg_database_size(current_database())::bigint::text AS db_size_bytes,
        xact_commit::bigint::text AS xact_commit,
        xact_rollback::bigint::text AS xact_rollback,
        blks_read::bigint::text AS blks_read,
        blks_hit::bigint::text AS blks_hit,
        deadlocks::bigint::text AS deadlocks
      FROM pg_stat_database
      WHERE datname = current_database();
    `.catch(() => []),

    // Connection Pool stats
    sql<{
      total: number;
      active: number;
      idle: number;
      idle_in_tx: number;
    }[]>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE state = 'active')::int AS active,
        count(*) FILTER (WHERE state = 'idle')::int AS idle,
        count(*) FILTER (WHERE state LIKE 'idle in transaction%')::int AS idle_in_tx
      FROM pg_stat_activity
      WHERE datname = current_database();
    `.catch(() => []),

    // Max connections setting
    sql<{ max_connections: number }[]>`
      SELECT setting::int AS max_connections FROM pg_settings WHERE name = 'max_connections';
    `.catch(() => [{ max_connections: 100 }]),

    // Top database tables by total disk size
    sql<{
      table_name: string;
      total_size: string;
      size_bytes: number;
      estimated_rows: number;
    }[]>`
      SELECT
        schemaname || '.' || relname AS table_name,
        pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
        pg_total_relation_size(relid)::bigint::int AS size_bytes,
        n_live_tup::bigint::int AS estimated_rows
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 6;
    `.catch(() => []),

    // PostgreSQL Version
    sql<{ version: string }[]>`
      SELECT version();
    `.catch(() => [{ version: "PostgreSQL" }]),

    // Snapshot, Coverage & Clusters (moved from top ribbon)
    sql<{ latest: Date | string | null; coverage: number; clusters: number }[]>`
      WITH latest AS (SELECT MAX(snapshot_date) AS d FROM app.scores)
      SELECT
        (SELECT d FROM latest) AS latest,
        (SELECT COUNT(*)::int FROM app.scores WHERE snapshot_date = (SELECT d FROM latest)) AS coverage,
        (SELECT COUNT(*)::int FROM app.cluster_composite_cache WHERE snapshot_date = (SELECT d FROM latest)) AS clusters
    `.catch(() => []),
  ]);

  // ── Process & Host System Metrics ──
  const memUsage = process.memoryUsage();
  const cpus = os.cpus() || [];
  const cpuCount = cpus.length || 1;
  const cpuModel = cpus[0]?.model || "vCPU";
  const loadAvg = os.loadavg();
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const usedRam = totalRam - freeRam;
  const usedRamPct = totalRam > 0 ? (usedRam / totalRam) * 100 : 0;
  const osUptime = os.uptime();
  const procUptime = process.uptime();
  const nodeVer = process.version;
  const platform = os.platform();
  const arch = os.arch();

  // ── Compute DB Indicators ──
  const dbStat = dbStatRows[0];
  const connStat = connStatRows[0] ?? { total: 0, active: 0, idle: 0, idle_in_tx: 0 };
  const maxConn = maxConnRows[0]?.max_connections ?? 100;
  const rawPgVer = pgVerRows[0]?.version ?? "PostgreSQL";
  const pgShortVer = rawPgVer.split(" on ")[0] || rawPgVer;

  const blksHit = Number(dbStat?.blks_hit ?? 0);
  const blksRead = Number(dbStat?.blks_read ?? 0);
  const totalBlks = blksHit + blksRead;
  const cacheHitPct = totalBlks > 0 ? (blksHit / totalBlks) * 100 : 99.5;
  const commits = Number(dbStat?.xact_commit ?? 0);
  const rollbacks = Number(dbStat?.xact_rollback ?? 0);
  const deadlocks = Number(dbStat?.deadlocks ?? 0);
  const maxTableBytes = Math.max(1, ...topTablesRows.map((t) => Number(t.size_bytes || 0)));

  // Status badges
  const pingTone = dbPingMs < 50 ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800" : dbPingMs < 150 ? "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800" : "text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800";
  const cacheTone = cacheHitPct >= 95 ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800" : cacheHitPct >= 85 ? "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800" : "text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800";
  const loadRatio = loadAvg[0] / cpuCount;
  const loadTone = loadRatio < 0.7 ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800" : loadRatio < 1.0 ? "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800" : "text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800";

  // Web Insights summary
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
  const maxDaily = Math.max(1, ...dailyRows.map((d) => Math.max(d.views, d.sessions)));

  const slowestRoutes = [...routeRows]
    .filter((r) => r.lcp_p75 != null || r.ttfb_med != null)
    .sort((a, b) => (b.lcp_p75 ?? b.ttfb_med ?? 0) - (a.lcp_p75 ?? a.ttfb_med ?? 0))
    .slice(0, 10);

  const showAll = section === "all";
  const showWeb = showAll || section === "web";
  const showApp = showAll || section === "app";
  const showDb = showAll || section === "db";

  return (
    <main className="mx-auto max-w-[1400px] px-3 sm:px-5 py-4 space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          eyebrow="Admin · Cockpit Telemetry & Performance"
          title="Site Insights & Server Performance"
          subtitle={`Segregated monitoring across Application Server, Database Server, and Overall Real-User Web Vitals (${range.label}).`}
        />
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border hairline text-xs">
          {(["24h", "7d", "30d"] as const).map((k) => (
            <Link
              key={k}
              href={`/admin/insights?range=${k}&section=${section}`}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                range.key === k
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              {k.toUpperCase()}
            </Link>
          ))}
        </div>
      </div>

      {/* Domain Segregation Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b hairline pb-3">
        <InsightsTabs activeSection={section} range={range.key} />
        <div className="text-xs text-slate-500 font-mono">
          Host: {platform} · Node {nodeVer} · {pgShortVer}
        </div>
      </div>

      {/* Snapshot, Coverage & Clusters (moved from top ribbon) */}
      {(() => {
        const snap = snapshotMetaRows[0];
        const snapDateStr = snap?.latest
          ? new Date(snap.latest).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "—";
        return (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 px-4 py-3 shadow-2xs flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Latest Snapshot</span>
              <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">{snapDateStr}</span>
            </div>
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 px-4 py-3 shadow-2xs flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Scored Coverage</span>
              <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                {Number(snap?.coverage ?? 0).toLocaleString("en-IN")} stocks
              </span>
            </div>
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 px-4 py-3 shadow-2xs flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Active Clusters</span>
              <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                {Number(snap?.clusters ?? 0)}
              </span>
            </div>
          </div>
        );
      })()}

      {(showApp || showDb) && <LiveInfraPanel showApp={showApp} showDb={showDb} />}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 1. OVERALL WEBSITE METRICS & TRAFFIC                          */}
      {/* ───────────────────────────────────────────────────────────── */}
      {showWeb && (
        <section className="space-y-4 pt-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-base">📊</span>
              <div>
                <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-900 dark:text-white">
                  Overall Website & Real-User Traffic
                </h2>
                <p className="text-xs text-slate-500">Live user sessions, device distribution, and Core Web Vitals ({range.label})</p>
              </div>
            </div>
            <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              {s.pageviews.toLocaleString("en-IN")} views · {s.sessions.toLocaleString("en-IN")} sessions
            </span>
          </div>

          {/* Traffic Hero Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Pageviews</div>
              <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white mt-1">{s.pageviews.toLocaleString("en-IN")}</div>
              <div className="text-xs text-slate-500 mt-0.5">{s.sessions.toLocaleString("en-IN")} unique sessions</div>
            </div>
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Human Engagement</div>
              <div className="text-2xl font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-1">{engagedPct.toFixed(1)}%</div>
              <div className="text-xs text-slate-500 mt-0.5">{s.engaged.toLocaleString("en-IN")} engaged views</div>
            </div>
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Device Split</div>
              <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white mt-1">
                {(100 - mobilePct).toFixed(0)}% <span className="text-sm font-normal text-slate-500">Desk</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {mobilePct.toFixed(0)}% Mobile ({s.mobile_views} / {s.desktop_views})
              </div>
            </div>
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Speed Summary (p75 LCP)</div>
              <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white mt-1">{fmtMs(s.lcp_p75)}</div>
              <div className="text-xs text-slate-500 mt-0.5">TTFB p75: {fmtMs(s.ttfb_p75)}</div>
            </div>
          </div>

          {/* Interactive Dual-Bar Trend Chart (Views & Sessions) */}
          {dailyRows.length > 0 && (
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Daily Traffic & Visitor Trend</h3>
                  <p className="text-xs text-slate-500">Daily pageviews and unique sessions breakdown</p>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" /> Pageviews
                  </span>
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Sessions
                  </span>
                </div>
              </div>

              <div className="flex items-end gap-2 h-36 pt-4 border-b border-slate-100 dark:border-slate-800">
                {dailyRows.map((d) => (
                  <div key={d.day} className="group relative flex-1 flex flex-col items-center h-full justify-end min-w-[20px]">
                    <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-slate-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-20 shadow-md">
                      <div className="font-semibold">{d.day}</div>
                      <div>{d.views} views · {d.sessions} sessions</div>
                      <div>LCP p75: {fmtMs(d.lcp_p75)}</div>
                    </div>
                    <div className="flex items-end gap-1 w-full justify-center h-full">
                      <div
                        className="w-1/2 max-w-[18px] rounded-t bg-indigo-500 group-hover:bg-indigo-600 transition-colors"
                        style={{ height: `${Math.max(6, (d.views / maxDaily) * 100)}%` }}
                      />
                      <div
                        className="w-1/2 max-w-[18px] rounded-t bg-emerald-500 group-hover:bg-emerald-600 transition-colors"
                        style={{ height: `${Math.max(6, (d.sessions / maxDaily) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[9.5px] font-mono text-slate-400 mt-1 truncate w-full text-center">
                      {d.day.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Core Web Vitals Spectrum Gauges */}
          <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Core Web Vitals Threshold Spectrum</h3>
              <p className="text-xs text-slate-500">Google standard performance targets: 🟢 Good · 🟡 Needs Work · 🔴 Poor</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {(
                [
                  { key: "ttfb", label: "TTFB", sub: "Time to First Byte", val: s.ttfb_p75, fmt: fmtMs(s.ttfb_p75), max: 3000, g1: 800, g2: 1800 },
                  { key: "fcp", label: "FCP", sub: "First Contentful Paint", val: s.fcp_p75, fmt: fmtMs(s.fcp_p75), max: 5000, g1: 1800, g2: 3000 },
                  { key: "lcp", label: "LCP", sub: "Largest Contentful Paint", val: s.lcp_p75, fmt: fmtMs(s.lcp_p75), max: 6000, g1: 2500, g2: 4000 },
                  { key: "inp", label: "INP", sub: "Interaction to Next Paint", val: s.inp_p75, fmt: fmtMs(s.inp_p75), max: 800, g1: 200, g2: 500 },
                  { key: "cls", label: "CLS", sub: "Cumulative Layout Shift", val: s.cls_p75, fmt: s.cls_p75 != null ? s.cls_p75.toFixed(3) : "—", max: 0.5, g1: 0.1, g2: 0.25 },
                ] as const
              ).map((m) => {
                const ratio = m.val != null ? Math.min(100, Math.max(3, (m.val / m.max) * 100)) : null;
                return (
                  <div key={m.key} className={`rounded-xl border p-3.5 space-y-2 ${vitalTone(m.key, m.val)}`}>
                    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide">
                      <span>{m.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/70 dark:bg-black/40 border border-current">
                        {vitalLabel(m.key, m.val)}
                      </span>
                    </div>
                    <div className="text-xl font-mono font-bold">{m.fmt}</div>
                    <div className="text-[11px] opacity-75">{m.sub}</div>

                    {/* Visual Target Spectrum Meter */}
                    <div className="pt-1 space-y-1">
                      <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex">
                        <div className="bg-emerald-500 h-full" style={{ width: `${(m.g1 / m.max) * 100}%` }} />
                        <div className="bg-amber-400 h-full" style={{ width: `${((m.g2 - m.g1) / m.max) * 100}%` }} />
                        <div className="bg-rose-500 h-full flex-1" />
                      </div>
                      <div className="relative h-2">
                        {ratio != null && (
                          <div
                            className="absolute -top-1 w-2.5 h-2.5 rounded-full bg-slate-900 dark:bg-white border-2 border-white dark:border-slate-900 shadow -translate-x-1/2"
                            style={{ left: `${ratio}%` }}
                            title={`Current p75: ${m.fmt}`}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Route Performance Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs overflow-x-auto">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Top Visited Routes</h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b hairline text-slate-500">
                    <th className="py-2 pr-2">Route</th>
                    <th className="py-2 px-2 text-right">Views</th>
                    <th className="py-2 px-2 text-right">Sessions</th>
                    <th className="py-2 px-2 text-right">Engaged</th>
                    <th className="py-2 pl-2 text-right">TTFB / LCP</th>
                  </tr>
                </thead>
                <tbody className="divide-y hairline">
                  {routeRows.map((r) => (
                    <tr key={r.path} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-1.5 pr-2 font-mono text-indigo-600 dark:text-indigo-400 truncate max-w-[200px]">{r.path}</td>
                      <td className="py-1.5 px-2 text-right font-mono font-semibold">{r.views}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-slate-600 dark:text-slate-400">{r.sessions}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {r.views > 0 ? `${Math.min(100, Math.round((r.engaged / r.views) * 100))}%` : "—"}
                      </td>
                      <td className="py-1.5 pl-2 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
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
              <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs overflow-x-auto">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Slowest Routes (by p75 LCP)</h3>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b hairline text-slate-500">
                      <th className="py-2 pr-2">Route</th>
                      <th className="py-2 px-2 text-right">TTFB med</th>
                      <th className="py-2 px-2 text-right">LCP p75</th>
                      <th className="py-2 pl-2 text-right">INP p75</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y hairline">
                    {slowestRoutes.map((r) => (
                      <tr key={r.path} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-1.5 pr-2 font-mono text-slate-800 dark:text-slate-200 truncate max-w-[200px]">{r.path}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{fmtMs(r.ttfb_med)}</td>
                        <td className="py-1.5 px-2 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">{fmtMs(r.lcp_p75)}</td>
                        <td className="py-1.5 pl-2 text-right font-mono text-slate-600 dark:text-slate-400">{fmtMs(r.inp_p75)}</td>
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

              <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Top Referrers</h3>
                <div className="divide-y hairline text-xs">
                  {referrerRows.map((rf) => (
                    <div key={rf.referrer} className="py-1.5 flex items-center justify-between">
                      <span className="font-mono text-slate-700 dark:text-slate-300">{rf.referrer}</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">{rf.views}</span>
                    </div>
                  ))}
                  {referrerRows.length === 0 && (
                    <div className="py-4 text-center text-slate-400">No referrer data yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 2. APP SERVER METRICS & HOST TELEMETRY                        */}
      {/* ───────────────────────────────────────────────────────────── */}
      {showApp && (
        <section className={`space-y-4 ${showAll ? "pt-6 border-t hairline" : ""}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-base">🖥️</span>
              <div>
                <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-900 dark:text-white">
                  App Server & Host Metrics
                </h2>
                <p className="text-xs text-slate-500">Node.js process health, V8 heap memory distribution, and host CPU load</p>
              </div>
            </div>
            <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              Node {nodeVer} · {cpuCount} {cpuCount === 1 ? "Core" : "Cores"}
            </span>
          </div>

          {/* 4 App Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Node RSS Memory</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Healthy
                </span>
              </div>
              <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white mt-1">{fmtBytes(memUsage.rss)}</div>
              <div className="text-xs text-slate-500 mt-0.5">Resident Set Size on host</div>
            </div>

            <div className={`rounded-xl border p-4 shadow-2xs bg-white dark:bg-slate-900 ${loadTone}`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">CPU Load (1m / 5m)</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-current">
                  {cpuCount} vCPUs
                </span>
              </div>
              <div className="text-2xl font-mono font-bold mt-1">
                {loadAvg[0].toFixed(2)} <span className="text-xs font-normal text-slate-500">/ {loadAvg[1].toFixed(2)}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{Math.round(loadRatio * 100)}% total capacity</div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Node Process Uptime</div>
              <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white mt-1">{fmtUptime(procUptime)}</div>
              <div className="text-xs text-slate-500 mt-0.5">Host uptime: {fmtUptime(osUptime)}</div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">V8 Heap Used</div>
              <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white mt-1">{fmtBytes(memUsage.heapUsed)}</div>
              <div className="text-xs text-slate-500 mt-0.5">Heap Total: {fmtBytes(memUsage.heapTotal)}</div>
            </div>
          </div>

          {/* Visual Graphs for App Server: CPU Load Graph + Memory Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* CPU Load Comparison Visual Bar Graph */}
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">CPU Load Average vs Core Capacity</h3>
                  <p className="text-xs text-slate-500">Comparison across 1m, 5m, and 15m intervals vs {cpuCount} cores</p>
                </div>
                <span className="text-xs font-mono text-slate-500">{cpuModel}</span>
              </div>

              <div className="space-y-3 pt-2">
                {[
                  { label: "1 min average", val: loadAvg[0] },
                  { label: "5 min average", val: loadAvg[1] },
                  { label: "15 min average", val: loadAvg[2] },
                ].map((item) => {
                  const pct = Math.min(100, Math.max(3, (item.val / cpuCount) * 100));
                  const barColor = pct > 100 ? "bg-rose-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500";
                  return (
                    <div key={item.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{item.label}</span>
                        <span className="font-mono text-slate-900 dark:text-white font-semibold">
                          {item.val.toFixed(2)} ({Math.round(pct)}%)
                        </span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className={`h-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
                <span>0%</span>
                <span>Normal (&lt;70%)</span>
                <span>High (&gt;100%)</span>
              </div>
            </div>

            {/* Memory Distribution Visual Graph */}
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Memory Allocation Breakdown</h3>
                <p className="text-xs text-slate-500">Physical host RAM and V8 JavaScript heap distribution</p>
              </div>

              {/* Host RAM Meter */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Host Physical RAM</span>
                  <span className="font-mono text-slate-900 dark:text-white font-semibold">
                    {fmtBytes(usedRam)} / {fmtBytes(totalRam)} ({usedRamPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                  <div
                    className={`h-full ${usedRamPct > 90 ? "bg-rose-500" : usedRamPct > 75 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(100, Math.max(3, usedRamPct))}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                  <span>Used: {fmtBytes(usedRam)}</span>
                  <span>Available Free: {fmtBytes(freeRam)}</span>
                </div>
              </div>

              {/* V8 Process Heap Meter */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">V8 Heap Memory Stack</span>
                  <span className="font-mono text-slate-900 dark:text-white font-semibold">
                    {fmtBytes(memUsage.heapUsed)} / {fmtBytes(memUsage.heapTotal)}
                  </span>
                </div>
                <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                  <div
                    className="h-full bg-indigo-500"
                    style={{
                      width: `${memUsage.heapTotal > 0 ? (memUsage.heapUsed / memUsage.heapTotal) * 100 : 0}%`,
                    }}
                  />
                  <div className="h-full bg-indigo-200 dark:bg-indigo-950 flex-1" />
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                  <span>Heap Used: {fmtBytes(memUsage.heapUsed)}</span>
                  <span>Heap Reserved: {fmtBytes(memUsage.heapTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 3. DB SERVER METRICS & POSTGRESQL TELEMETRY                   */}
      {/* ───────────────────────────────────────────────────────────── */}
      {showDb && (
        <section className={`space-y-4 ${showAll ? "pt-6 border-t hairline" : ""}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-base">🗄️</span>
              <div>
                <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-900 dark:text-white">
                  Database Server Metrics & Telemetry
                </h2>
                <p className="text-xs text-slate-500">PostgreSQL ping latency, connection pools, buffer hit ratio, and table storage footprints</p>
              </div>
            </div>
            <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              {pgShortVer} · {dbStat?.db_size ?? "—"}
            </span>
          </div>

          {/* 4 DB Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className={`rounded-xl border p-4 shadow-2xs bg-white dark:bg-slate-900 ${pingTone}`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Ping Latency</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-current">
                  {dbPingMs < 50 ? "Fast" : "Normal"}
                </span>
              </div>
              <div className="text-2xl font-mono font-bold mt-1">{dbPingMs} ms</div>
              <div className="text-xs text-slate-500 mt-0.5">Roundtrip query time</div>
            </div>

            <div className={`rounded-xl border p-4 shadow-2xs bg-white dark:bg-slate-900 ${cacheTone}`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Buffer Cache Hit</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-current">
                  {cacheHitPct >= 95 ? "Optimal" : "Check"}
                </span>
              </div>
              <div className="text-2xl font-mono font-bold mt-1">{cacheHitPct.toFixed(1)}%</div>
              <div className="text-xs text-slate-500 mt-0.5">RAM hit vs disk read</div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Connection Pool</div>
              <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white mt-1">
                {connStat.active} <span className="text-sm font-normal text-slate-500">/ {connStat.total}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {connStat.idle} idle · Max: {maxConn}
              </div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Transactions</div>
              <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white mt-1">
                {commits.toLocaleString("en-IN")}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {rollbacks.toLocaleString("en-IN")} rollbacks · {deadlocks} deadlocks
              </div>
            </div>
          </div>

          {/* Visual Graphs for DB: Top Tables Footprint Chart + Cache Health */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Tables Proportional Bar Chart */}
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Top Tables by Disk Footprint</h3>
                  <p className="text-xs text-slate-500">Relative storage size breakdown across PostgreSQL tables</p>
                </div>
                <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                  Total DB: {dbStat?.db_size ?? "—"}
                </span>
              </div>

              <div className="space-y-3 pt-2">
                {topTablesRows.map((t) => {
                  const widthPct = Math.min(100, Math.max(5, (Number(t.size_bytes || 0) / maxTableBytes) * 100));
                  return (
                    <div key={t.table_name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-indigo-600 dark:text-indigo-400 font-medium truncate max-w-[220px]">
                          {t.table_name}
                        </span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-slate-400 text-[11px]">
                            {t.estimated_rows != null ? `${Number(t.estimated_rows).toLocaleString("en-IN")} rows` : ""}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white">{t.total_size}</span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500 hover:bg-blue-600 transition-all duration-500"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {topTablesRows.length === 0 && (
                  <div className="py-6 text-center text-slate-400 text-xs">Querying database table sizes…</div>
                )}
              </div>
            </div>

            {/* Cache Health & Pool Utilization Graph */}
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Cache & Connection Efficiency</h3>
                <p className="text-xs text-slate-500">PostgreSQL memory buffer efficiency and connection pool health</p>
              </div>

              {/* Cache Hit Gauge */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Buffer Cache Hit Ratio</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{cacheHitPct.toFixed(2)}%</span>
                </div>
                <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                  <div className="bg-emerald-500 h-full" style={{ width: `${cacheHitPct}%` }} />
                  <div className="bg-rose-400 h-full flex-1" />
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                  <span>RAM Hit: {blksHit.toLocaleString("en-IN")} blocks</span>
                  <span>Disk Read: {blksRead.toLocaleString("en-IN")} blocks</span>
                </div>
              </div>

              {/* Connection Pool Utilization */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Connection Pool Utilization</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {connStat.total} / {maxConn} ({Math.round((connStat.total / maxConn) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                  <div
                    className="bg-indigo-500 h-full"
                    style={{ width: `${(connStat.active / maxConn) * 100}%` }}
                    title="Active connections"
                  />
                  <div
                    className="bg-indigo-300 dark:bg-indigo-800 h-full"
                    style={{ width: `${(connStat.idle / maxConn) * 100}%` }}
                    title="Idle connections"
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                  <span>Active: {connStat.active}</span>
                  <span>Idle in Pool: {connStat.idle}</span>
                  <span>Capacity: {maxConn}</span>
                </div>
              </div>

              {/* Transactions Strip */}
              <div className="grid grid-cols-3 gap-2 text-xs text-center p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border hairline">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-medium">Commits</div>
                  <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5">{commits.toLocaleString("en-IN")}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-medium">Rollbacks</div>
                  <div className="font-mono font-bold text-slate-700 dark:text-slate-300 mt-0.5">{rollbacks.toLocaleString("en-IN")}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-medium">Deadlocks</div>
                  <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{deadlocks}</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
