"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type SarRange = "1d" | "5d" | "30d";

interface SarBucket {
  ts: string;
  samples: number;
  cpuAvg: number;
  cpuMax: number;
  ramAvg: number;
  heapAvg: number;
  lagAvg: number;
  diskMax: number | null;
  pingAvg: number | null;
  connMax: number;
  cacheMin: number | null;
}

interface SarSummary {
  total_samples: number;
  cpu_avg: number | null;
  cpu_max: number | null;
  ram_avg: number | null;
  ram_max: number | null;
  heap_avg: number | null;
  heap_max: number | null;
  lag_avg: number | null;
  lag_max: number | null;
  disk_max: number | null;
  ping_avg: number | null;
  ping_max: number | null;
  cache_min: number | null;
  conn_max: number | null;
}

interface InfraTelemetry {
  ts: string;
  app: {
    cpuCount: number;
    load1m: number;
    load5m: number;
    load15m: number;
    loadPct: number;
    ramUsedBytes: number;
    ramTotalBytes: number;
    ramUsedPct: number;
    nodeRssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    eventLoopLagMs: number;
    procUptimeSec: number;
    hostUptimeSec: number;
    disk: { totalBytes: number; freeBytes: number; usedPct: number } | null;
    crons: {
      id: string;
      label: string;
      schedule: string;
      exists: boolean;
      sizeBytes: number;
      modifiedAt: string | null;
      ageHours: number | null;
      status: "ok" | "stale" | "missing";
    }[];
  };
  db: {
    pingMs: number | null;
    cacheHitPct: number;
    dbBytes: number;
    commits: number;
    rollbacks: number;
    deadlocks: number;
    tempFiles: number;
    tempBytes: number;
    connections: {
      active: number;
      idle: number;
      idleInTx: number;
      waiting: number;
      total: number;
      max: number;
    };
    activeQueries: {
      pid: number;
      user: string;
      state: string;
      waitEvent: string | null;
      durationMs: number;
      query: string;
    }[];
    tableHealth: {
      tableName: string;
      liveTup: number;
      deadTup: number;
      deadPct: number;
      seqScan: number;
      idxScan: number;
      idxPct: number;
      lastAutovacuum: string | null;
    }[];
    slowQueries: {
      available: boolean;
      rows: {
        calls: number;
        mean_ms: number;
        max_ms: number;
        total_ms: number;
        rows: number;
        query: string;
      }[];
    };
  };
  sar: {
    range: SarRange;
    summary: SarSummary | null;
    buckets: SarBucket[];
  };
}

function fmtBytes(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b)) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtBucketTime(iso: string, range: SarRange): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (range === "30d") {
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  }
  if (range === "5d") {
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function StaticTrendChart({
  title,
  unit,
  points,
  color,
}: {
  title: string;
  unit: string;
  points: { label: string; value: number }[];
  color: string;
}) {
  if (points.length === 0) {
    return (
      <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{title}</div>
        <div className="h-20 flex items-center justify-center text-[11px] text-slate-400">
          Waiting for more SAR samples in this window
        </div>
      </div>
    );
  }

  const ordered = [...points].reverse(); // oldest -> newest left-to-right
  const vals = ordered.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const span = max - min || 1;
  const w = 320;
  const h = 64;

  const coords = ordered.map((p, i) => {
    const x = ordered.length === 1 ? w / 2 : (i / (ordered.length - 1)) * w;
    const y = h - 6 - ((p.value - min) / span) * (h - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-800 dark:text-slate-200">{title}</span>
        <span className="font-mono text-[11px] text-slate-500">
          avg {avg.toFixed(1)}{unit} · max <strong className="text-slate-900 dark:text-white">{max.toFixed(1)}{unit}</strong>
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16 overflow-visible">
        <line x1="0" y1={h - 6} x2={w} y2={h - 6} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="1" />
        {ordered.length > 1 ? (
          <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={coords.join(" ")} />
        ) : (
          <circle cx={w / 2} cy={h / 2} r="3.5" fill={color} />
        )}
      </svg>
      <div className="flex justify-between text-[10px] font-mono text-slate-400">
        <span>{ordered[0]?.label}</span>
        <span>{ordered[ordered.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export function LiveInfraPanel({ showApp, showDb }: { showApp: boolean; showDb: boolean }) {
  const [sarRange, setSarRange] = useState<SarRange>("1d");
  const [data, setData] = useState<InfraTelemetry | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [recording, setRecording] = useState<boolean>(false);

  const fetchSar = useCallback(async (range: SarRange, recordSample: boolean = false) => {
    if (recordSample) setRecording(true);
    else setLoading(true);
    try {
      const qs = new URLSearchParams({ range });
      if (recordSample) qs.set("record", "1");
      const res = await fetch(`/api/admin/insights/live?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const json: InfraTelemetry = await res.json();
      setData(json);
    } catch {
      // ignore transient error
    } finally {
      setLoading(false);
      setRecording(false);
    }
  }, []);

  useEffect(() => {
    fetchSar(sarRange, false);
  }, [sarRange, fetchSar]);

  const sar = data?.sar;
  const buckets = sar?.buckets ?? [];
  const sum = sar?.summary;

  return (
    <div className="space-y-4">
      {/* Static SAR Control Strip (no auto-polling / no moving graphs) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border hairline bg-slate-50/80 dark:bg-slate-900/70 px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-mono font-bold text-[10px] uppercase">
            SAR
          </span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            System Activity & DB Historical Report
          </span>
          {sum && (
            <span className="font-mono text-[11px] text-slate-500">
              · {sum.total_samples} sample{sum.total_samples === 1 ? "" : "s"} in window
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-0.5 rounded-lg border hairline">
            {(
              [
                { id: "1d", label: "1 Day" },
                { id: "5d", label: "5 Days" },
                { id: "30d", label: "1 Month" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSarRange(opt.id)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  sarRange === opt.id
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => fetchSar(sarRange, true)}
            disabled={recording || loading}
            className="px-2.5 py-1 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors"
          >
            {recording ? "Recording..." : "Record Sample & Refresh"}
          </button>
        </div>
      </div>

      {/* App Server Historical SAR + Cron Freshness */}
      {showApp && data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">CPU Load % (Avg / Peak)</div>
              <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                {sum?.cpu_avg ?? data.app.loadPct}%{" "}
                <span className="text-xs font-normal text-slate-500">/ {sum?.cpu_max ?? data.app.loadPct}%</span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono">Now: {data.app.loadPct}% ({data.app.cpuCount} vCPU)</div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Host RAM % (Avg / Peak)</div>
              <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                {sum?.ram_avg ?? data.app.ramUsedPct}%{" "}
                <span className="text-xs font-normal text-slate-500">/ {sum?.ram_max ?? data.app.ramUsedPct}%</span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono">Now: {fmtBytes(data.app.ramUsedBytes)} / {fmtBytes(data.app.ramTotalBytes)}</div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Event Loop Lag (Avg / Peak)</div>
              <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                {sum?.lag_avg ?? data.app.eventLoopLagMs} ms{" "}
                <span className="text-xs font-normal text-slate-500">/ {sum?.lag_max ?? data.app.eventLoopLagMs} ms</span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono">Heap peak: {sum?.heap_max ?? Math.round(data.app.heapUsedBytes / 1048576)} MB</div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Host Disk (/)</span>
                <span className="font-mono text-[10px] text-slate-400">
                  {data.app.disk ? `${fmtBytes(data.app.disk.freeBytes)} free` : "N/A"}
                </span>
              </div>
              <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                {data.app.disk ? `${data.app.disk.usedPct.toFixed(1)}%` : "—"}
              </div>
              {data.app.disk && (
                <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full ${
                      data.app.disk.usedPct > 85 ? "bg-rose-500" : data.app.disk.usedPct > 70 ? "bg-amber-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, data.app.disk.usedPct)}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Static SAR Trend Charts for App Server */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <StaticTrendChart
              title={`CPU Utilization % (${sarRange.toUpperCase()})`}
              unit="%"
              color="#10b981"
              points={buckets.map((b) => ({ label: fmtBucketTime(b.ts, sarRange), value: b.cpuAvg }))}
            />
            <StaticTrendChart
              title={`Memory Utilization % (${sarRange.toUpperCase()})`}
              unit="%"
              color="#6366f1"
              points={buckets.map((b) => ({ label: fmtBucketTime(b.ts, sarRange), value: b.ramAvg }))}
            />
          </div>

          {/* Cron Pipeline Health Matrix */}
          <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Cron & Data Pipeline Freshness</h3>
                <p className="text-xs text-slate-500">Log file mtime & freshness thresholds for scheduled OCI jobs</p>
              </div>
              <Link href="/admin/logs" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                Open Logs & Triggers →
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {data.app.crons.map((c) => (
                <div key={c.id} className="rounded-lg border hairline p-2.5 bg-slate-50/70 dark:bg-slate-800/40 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{c.label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${
                        c.status === "ok"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800"
                          : c.status === "stale"
                            ? "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800"
                            : "bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                      }`}
                    >
                      {c.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">{c.schedule}</div>
                  <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    {c.ageHours != null ? `${c.ageHours}h ago · ${fmtBytes(c.sizeBytes)}` : "No log yet"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DB Server Historical SAR + Deep Diagnostics */}
      {showDb && data && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <StaticTrendChart
              title={`DB Ping Latency (${sarRange.toUpperCase()})`}
              unit="ms"
              color="#3b82f6"
              points={buckets
                .filter((b) => b.pingAvg != null)
                .map((b) => ({ label: fmtBucketTime(b.ts, sarRange), value: b.pingAvg as number }))}
            />
            <StaticTrendChart
              title={`Peak Active DB Connections (${sarRange.toUpperCase()})`}
              unit=""
              color="#0ea5e9"
              points={buckets.map((b) => ({ label: fmtBucketTime(b.ts, sarRange), value: b.connMax }))}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Table Index vs Seq Scan & Autovacuum Health */}
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-2.5 overflow-x-auto">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Table Scan & Vacuum Health</h3>
                <p className="text-xs text-slate-500">Index scan ratio vs sequential scans and dead-tuple bloat (pg_stat_user_tables)</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500 border-b hairline">
                    <th className="pb-1.5 font-medium">Table</th>
                    <th className="pb-1.5 font-medium text-right">Live</th>
                    <th className="pb-1.5 font-medium text-right">Dead %</th>
                    <th className="pb-1.5 font-medium text-right">Idx %</th>
                    <th className="pb-1.5 font-medium text-right">Seq Scans</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                  {data.db.tableHealth.map((t) => (
                    <tr key={t.tableName}>
                      <td className="py-1.5 text-indigo-600 dark:text-indigo-400 truncate max-w-[180px]">{t.tableName}</td>
                      <td className="py-1.5 text-right">{t.liveTup.toLocaleString("en-IN")}</td>
                      <td className={`py-1.5 text-right ${t.deadPct > 15 ? "text-rose-600 font-semibold" : "text-slate-600 dark:text-slate-300"}`}>
                        {t.deadPct.toFixed(1)}%
                      </td>
                      <td className={`py-1.5 text-right ${t.idxPct < 60 ? "text-amber-600 font-semibold" : "text-emerald-600"}`}>
                        {t.idxPct.toFixed(0)}%
                      </td>
                      <td className="py-1.5 text-right text-slate-500">{t.seqScan.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                  {data.db.tableHealth.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-slate-400 font-sans">No table stats returned</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Active Queries & Slow Statements */}
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-3 overflow-x-auto">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Active Queries & Lock Monitor ({data.db.activeQueries.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Snapshot of non-idle backends · Temp spill: {fmtBytes(data.db.tempBytes)} ({data.db.tempFiles} files)
                </p>
              </div>
              {data.db.activeQueries.length > 0 ? (
                <div className="space-y-1.5">
                  {data.db.activeQueries.map((q) => (
                    <div key={q.pid} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border hairline text-[11px] font-mono space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700 dark:text-slate-200 font-semibold">
                          PID {q.pid} · {q.state} {q.waitEvent ? `(${q.waitEvent})` : ""}
                        </span>
                        <span className={q.durationMs > 1000 ? "text-rose-600 font-bold" : "text-slate-500"}>
                          {q.durationMs} ms
                        </span>
                      </div>
                      <div className="text-slate-500 truncate">{q.query}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  ✓ No active or lock-waiting queries at sample time
                </div>
              )}

              <div className="pt-2 border-t hairline space-y-1.5">
                <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Top Queries by Total Time (pg_stat_statements)
                </h4>
                {data.db.slowQueries.available ? (
                  <div className="space-y-1">
                    {data.db.slowQueries.rows.slice(0, 5).map((sq, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 text-[11px] font-mono py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                        <span className="truncate text-slate-600 dark:text-slate-300 max-w-[320px]">{sq.query}</span>
                        <span className="shrink-0 text-slate-500">
                          {sq.calls}x · avg <strong className="text-slate-900 dark:text-white">{sq.mean_ms}ms</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    pg_stat_statements extension not enabled on this database.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Classic SAR Tabular Activity Log */}
      <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-2.5 overflow-x-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              SAR Historical Activity Table ({sarRange === "1d" ? "15m buckets · 24h" : sarRange === "5d" ? "2h buckets · 5d" : "1d buckets · 30d"})
            </h3>
            <p className="text-xs text-slate-500">
              Recorded automatically every ~5m by keep-warm and manual samples
            </p>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-slate-500 border-b hairline">
              <th className="pb-1.5 font-medium">Time</th>
              <th className="pb-1.5 font-medium text-right">Samples</th>
              <th className="pb-1.5 font-medium text-right">CPU % (avg/max)</th>
              <th className="pb-1.5 font-medium text-right">RAM %</th>
              <th className="pb-1.5 font-medium text-right">Heap MB</th>
              <th className="pb-1.5 font-medium text-right">Lag ms</th>
              <th className="pb-1.5 font-medium text-right">Disk %</th>
              <th className="pb-1.5 font-medium text-right">DB Ping</th>
              <th className="pb-1.5 font-medium text-right">Max Conn</th>
              <th className="pb-1.5 font-medium text-right">Cache Hit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
            {buckets.slice(0, 32).map((b) => (
              <tr key={b.ts} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="py-1.5 text-slate-700 dark:text-slate-300">{fmtBucketTime(b.ts, sarRange)}</td>
                <td className="py-1.5 text-right text-slate-400">{b.samples}</td>
                <td className={`py-1.5 text-right ${b.cpuMax > 85 ? "text-rose-600 font-semibold" : "text-slate-800 dark:text-slate-200"}`}>
                  {b.cpuAvg.toFixed(1)}% / {b.cpuMax.toFixed(1)}%
                </td>
                <td className="py-1.5 text-right">{b.ramAvg.toFixed(1)}%</td>
                <td className="py-1.5 text-right">{b.heapAvg.toFixed(0)}</td>
                <td className={`py-1.5 text-right ${b.lagAvg > 50 ? "text-rose-600" : "text-slate-600 dark:text-slate-300"}`}>
                  {b.lagAvg.toFixed(1)}
                </td>
                <td className="py-1.5 text-right">{b.diskMax != null ? `${b.diskMax.toFixed(1)}%` : "—"}</td>
                <td className="py-1.5 text-right">{b.pingAvg != null ? `${b.pingAvg.toFixed(1)}ms` : "—"}</td>
                <td className="py-1.5 text-right">{b.connMax}</td>
                <td className="py-1.5 text-right text-emerald-600 dark:text-emerald-400">
                  {b.cacheMin != null ? `${b.cacheMin.toFixed(2)}%` : "—"}
                </td>
              </tr>
            ))}
            {buckets.length === 0 && (
              <tr>
                <td colSpan={10} className="py-6 text-center text-slate-400 font-sans">
                  {loading ? "Loading SAR history..." : "No SAR samples recorded in this window yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
