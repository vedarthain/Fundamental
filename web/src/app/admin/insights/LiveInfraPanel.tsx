"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface LiveTelemetry {
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
}

function fmtBytes(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b)) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function Sparkline({ values, color = "#10b981", height = 28 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) {
    return <div className="h-[28px] flex items-center text-[10px] font-mono text-slate-400">sampling…</div>;
  }
  const w = 120;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = height - 3 - ((v - min) / span) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

export function LiveInfraPanel({ showApp, showDb }: { showApp: boolean; showDb: boolean }) {
  const [data, setData] = useState<LiveTelemetry | null>(null);
  const [history, setHistory] = useState<LiveTelemetry[]>([]);
  const [pollMs, setPollMs] = useState<number>(5000);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/insights/live", { cache: "no-store" });
      if (!res.ok) return;
      const json: LiveTelemetry = await res.json();
      setData(json);
      setHistory((prev) => [...prev.slice(-23), json]);
    } catch {
      // ignore transient network error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLive();
  }, [fetchLive]);

  useEffect(() => {
    if (pollMs <= 0) return;
    const id = setInterval(fetchLive, pollMs);
    return () => clearInterval(id);
  }, [pollMs, fetchLive]);

  const cpuSeries = history.map((h) => h.app.loadPct);
  const lagSeries = history.map((h) => h.app.eventLoopLagMs);
  const heapSeries = history.map((h) => Math.round(h.app.heapUsedBytes / (1024 * 1024)));
  const pingSeries = history.map((h) => h.db.pingMs ?? 0);
  const activeConnSeries = history.map((h) => h.db.connections.active);

  return (
    <div className="space-y-4">
      {/* Live Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border hairline bg-slate-50/80 dark:bg-slate-900/70 px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${
              pollMs > 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
            }`}
          />
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            Live SRE Telemetry
          </span>
          {data && (
            <span className="font-mono text-[11px] text-slate-500">
              · {history.length} samples · updated {new Date(data.ts).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Poll:</span>
          {[
            { label: "5s", ms: 5000 },
            { label: "10s", ms: 10000 },
            { label: "Off", ms: 0 },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => setPollMs(opt.ms)}
              className={`px-2 py-0.5 rounded font-mono border transition-colors ${
                pollMs === opt.ms
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-transparent"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={fetchLive}
            className="px-2.5 py-0.5 rounded font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            {loading && !data ? "Loading..." : "Sample Now"}
          </button>
        </div>
      </div>

      {/* Live App Server SRE Cards + Cron Freshness */}
      {showApp && data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Event Loop Lag</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    data.app.eventLoopLagMs > 50
                      ? "bg-rose-50 text-rose-700 border border-rose-200"
                      : data.app.eventLoopLagMs > 15
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}
                >
                  {data.app.eventLoopLagMs > 50 ? "Slow" : "Healthy"}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                  {data.app.eventLoopLagMs.toFixed(1)} ms
                </div>
                <Sparkline values={lagSeries} color="#6366f1" />
              </div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Live CPU Load</span>
                <span className="font-mono text-[10px] text-slate-400">{data.app.cpuCount} vCPU</span>
              </div>
              <div className="flex items-end justify-between">
                <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                  {data.app.loadPct.toFixed(0)}%
                </div>
                <Sparkline values={cpuSeries} color={data.app.loadPct > 80 ? "#f43f5e" : "#10b981"} />
              </div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Live V8 Heap</span>
                <span className="font-mono text-[10px] text-slate-400">RSS {fmtBytes(data.app.nodeRssBytes)}</span>
              </div>
              <div className="flex items-end justify-between">
                <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                  {fmtBytes(data.app.heapUsedBytes)}
                </div>
                <Sparkline values={heapSeries} color="#8b5cf6" />
              </div>
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
                      data.app.disk.usedPct > 85
                        ? "bg-rose-500"
                        : data.app.disk.usedPct > 70
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, data.app.disk.usedPct)}%` }}
                  />
                </div>
              )}
            </div>
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
                <div
                  key={c.id}
                  className="rounded-lg border hairline p-2.5 bg-slate-50/70 dark:bg-slate-800/40 space-y-1 text-xs"
                >
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

      {/* Live DB Deep Diagnostics */}
      {showDb && data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Live DB Ping</span>
                <span className="font-mono text-[10px] text-slate-400">SELECT 1</span>
              </div>
              <div className="flex items-end justify-between">
                <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                  {data.db.pingMs != null ? `${data.db.pingMs} ms` : "—"}
                </div>
                <Sparkline values={pingSeries} color="#3b82f6" />
              </div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Active / Waiting</span>
                <span className="font-mono text-[10px] text-slate-400">
                  {data.db.connections.idleInTx} idle-in-tx
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                  {data.db.connections.active}{" "}
                  <span className="text-xs font-normal text-slate-500">
                    / {data.db.connections.waiting} wait
                  </span>
                </div>
                <Sparkline values={activeConnSeries} color="#0ea5e9" />
              </div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Buffer Hit Ratio</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    data.db.cacheHitPct >= 98
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200"
                  }`}
                >
                  {data.db.cacheHitPct >= 98 ? "Optimal" : "Tune"}
                </span>
              </div>
              <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                {data.db.cacheHitPct.toFixed(2)}%
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                {data.db.deadlocks} deadlocks · {data.db.rollbacks.toLocaleString("en-IN")} rollbacks
              </div>
            </div>

            <div className="rounded-xl border hairline bg-white dark:bg-slate-900 p-3.5 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Temp Disk Spill</span>
                <span className="font-mono text-[10px] text-slate-400">{data.db.tempFiles} files</span>
              </div>
              <div className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                {fmtBytes(data.db.tempBytes)}
              </div>
              <div className="text-[11px] text-slate-500">Sort/hash spills to disk</div>
            </div>
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
                <p className="text-xs text-slate-500">Live non-idle backends from pg_stat_activity</p>
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
                <div className="py-3 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  ✓ No active or lock-waiting queries right now
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
    </div>
  );
}
