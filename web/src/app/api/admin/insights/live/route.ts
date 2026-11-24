import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";
import os from "node:os";
import fs from "node:fs";

export const dynamic = "force-dynamic";

const CRON_LOG_SPECS = [
  { id: "ltp", label: "Bhavcopy & LTP", schedule: "Mon–Fri 7:25 PM", path: "/var/log/fundamental-refresh-ltp.log", staleHours: 36 },
  { id: "scanner", label: "Momentum Scanners", schedule: "Mon–Fri 8:30 PM", path: "/var/log/fundamental-momentum-scanner.log", staleHours: 36 },
  { id: "drift", label: "Nightly Drift", schedule: "Daily 11:00 PM", path: "/var/log/fundamental-daily-drift.log", staleHours: 30 },
  { id: "backup", label: "DB Backup", schedule: "Daily 7:30 AM", path: "/var/log/fundamental-db-backup.log", staleHours: 30 },
  { id: "compute", label: "Saturday Compute", schedule: "Sat 8:30 AM", path: "/var/log/fundamental-weekly-compute.log", staleHours: 192 },
  { id: "sunday", label: "Sunday Calls", schedule: "Sun 2:00 PM", path: "/var/log/fundamental-sunday-calls.log", staleHours: 192 },
];

function measureEventLoopLagMs(): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => {
      const elapsed = performance.now() - start;
      resolve(Math.max(0, Math.round((elapsed - 10) * 100) / 100));
    }, 10);
  });
}

function getDiskStats(): { totalBytes: number; freeBytes: number; usedPct: number } | null {
  try {
    const stat = fs.statfsSync("/");
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPct = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
    return { totalBytes, freeBytes, usedPct };
  } catch {
    return null;
  }
}

function getCronFreshness() {
  const now = Date.now();
  return CRON_LOG_SPECS.map((spec) => {
    try {
      const st = fs.statSync(spec.path);
      const ageHours = (now - st.mtimeMs) / 3_600_000;
      return {
        id: spec.id,
        label: spec.label,
        schedule: spec.schedule,
        exists: true,
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
        ageHours: Math.round(ageHours * 10) / 10,
        status: ageHours > spec.staleHours ? "stale" : "ok",
      };
    } catch {
      return {
        id: spec.id,
        label: spec.label,
        schedule: spec.schedule,
        exists: false,
        sizeBytes: 0,
        modifiedAt: null,
        ageHours: null,
        status: "missing",
      };
    }
  });
}

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = performance.now();
  const [eventLoopLagMs, pingRes, dbStatsRes, connRes, activeQueriesRes, tableHealthRes, slowQueriesRes] =
    await Promise.all([
      measureEventLoopLagMs(),
      sql`SELECT 1 AS ok`.catch(() => null),
      sql<any[]>`
        SELECT
          xact_commit::bigint AS commits,
          xact_rollback::bigint AS rollbacks,
          blks_read::bigint AS blks_read,
          blks_hit::bigint AS blks_hit,
          deadlocks::bigint AS deadlocks,
          temp_files::bigint AS temp_files,
          temp_bytes::bigint AS temp_bytes,
          pg_database_size(current_database())::bigint AS db_bytes
        FROM pg_stat_database
        WHERE datname = current_database()
      `.catch(() => []),
      sql<any[]>`
        SELECT
          COUNT(*) FILTER (WHERE state = 'active')::int AS active,
          COUNT(*) FILTER (WHERE state = 'idle')::int AS idle,
          COUNT(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_tx,
          COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL AND state = 'active')::int AS waiting,
          COUNT(*)::int AS total,
          (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
        FROM pg_stat_activity
        WHERE datname = current_database()
      `.catch(() => []),
      sql<any[]>`
        SELECT
          pid,
          usename,
          state,
          wait_event_type,
          wait_event,
          ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - query_start)) * 1000)::int AS duration_ms,
          LEFT(REGEXP_REPLACE(query, '\s+', ' ', 'g'), 140) AS query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state IS NOT NULL
          AND state <> 'idle'
        ORDER BY duration_ms DESC NULLS LAST
        LIMIT 8
      `.catch(() => []),
      sql<any[]>`
        SELECT
          schemaname || '.' || relname AS table_name,
          n_live_tup::bigint AS live_tup,
          n_dead_tup::bigint AS dead_tup,
          seq_scan::bigint AS seq_scan,
          idx_scan::bigint AS idx_scan,
          last_autovacuum::text AS last_autovacuum
        FROM pg_stat_user_tables
        WHERE schemaname IN ('app', 'golden', 'public')
        ORDER BY (n_dead_tup + seq_scan) DESC NULLS LAST
        LIMIT 8
      `.catch(() => []),
      sql<any[]>`
        SELECT
          calls::bigint AS calls,
          ROUND(mean_exec_time::numeric, 1)::float AS mean_ms,
          ROUND(max_exec_time::numeric, 1)::float AS max_ms,
          ROUND(total_exec_time::numeric, 0)::float AS total_ms,
          rows::bigint AS rows,
          LEFT(REGEXP_REPLACE(query, '\s+', ' ', 'g'), 140) AS query
        FROM pg_stat_statements
        WHERE calls > 0
        ORDER BY total_exec_time DESC
        LIMIT 8
      `.then((rows) => ({ available: true, rows })).catch(() => ({ available: false, rows: [] })),
    ]);

  const dbPingMs = pingRes ? Math.round((performance.now() - t0) * 10) / 10 : null;
  const mem = process.memoryUsage();
  const load = os.loadavg();
  const cpus = os.cpus().length || 1;
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const usedRam = totalRam - freeRam;

  const dbRow = dbStatsRes?.[0] || null;
  const blksHit = Number(dbRow?.blks_hit ?? 0);
  const blksRead = Number(dbRow?.blks_read ?? 0);
  const cacheHitPct = blksHit + blksRead > 0 ? Math.round((blksHit / (blksHit + blksRead)) * 10000) / 100 : 100;

  const conn = connRes?.[0] || { active: 0, idle: 0, idle_in_tx: 0, waiting: 0, total: 0, max_conn: 100 };

  return NextResponse.json({
    ts: new Date().toISOString(),
    app: {
      cpuCount: cpus,
      load1m: Math.round(load[0] * 100) / 100,
      load5m: Math.round(load[1] * 100) / 100,
      load15m: Math.round(load[2] * 100) / 100,
      loadPct: Math.round((load[0] / cpus) * 1000) / 10,
      ramUsedBytes: usedRam,
      ramTotalBytes: totalRam,
      ramUsedPct: Math.round((usedRam / totalRam) * 1000) / 10,
      nodeRssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      eventLoopLagMs,
      procUptimeSec: Math.round(process.uptime()),
      hostUptimeSec: Math.round(os.uptime()),
      disk: getDiskStats(),
      crons: getCronFreshness(),
    },
    db: {
      pingMs: dbPingMs,
      cacheHitPct,
      dbBytes: Number(dbRow?.db_bytes ?? 0),
      commits: Number(dbRow?.commits ?? 0),
      rollbacks: Number(dbRow?.rollbacks ?? 0),
      deadlocks: Number(dbRow?.deadlocks ?? 0),
      tempFiles: Number(dbRow?.temp_files ?? 0),
      tempBytes: Number(dbRow?.temp_bytes ?? 0),
      connections: {
        active: Number(conn.active ?? 0),
        idle: Number(conn.idle ?? 0),
        idleInTx: Number(conn.idle_in_tx ?? 0),
        waiting: Number(conn.waiting ?? 0),
        total: Number(conn.total ?? 0),
        max: Number(conn.max_conn ?? 100),
      },
      activeQueries: activeQueriesRes.map((q) => ({
        pid: q.pid,
        user: q.usename,
        state: q.state,
        waitEvent: q.wait_event_type ? `${q.wait_event_type}:${q.wait_event}` : null,
        durationMs: Number(q.duration_ms ?? 0),
        query: q.query,
      })),
      tableHealth: tableHealthRes.map((t) => {
        const live = Number(t.live_tup ?? 0);
        const dead = Number(t.dead_tup ?? 0);
        const seq = Number(t.seq_scan ?? 0);
        const idx = Number(t.idx_scan ?? 0);
        return {
          tableName: t.table_name,
          liveTup: live,
          deadTup: dead,
          deadPct: live + dead > 0 ? Math.round((dead / (live + dead)) * 1000) / 10 : 0,
          seqScan: seq,
          idxScan: idx,
          idxPct: seq + idx > 0 ? Math.round((idx / (seq + idx)) * 1000) / 10 : 100,
          lastAutovacuum: t.last_autovacuum,
        };
      }),
      slowQueries: slowQueriesRes,
    },
  });
}
