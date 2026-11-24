import "server-only";
import os from "node:os";
import fs from "node:fs";
import { sql } from "@/lib/db";

export type SarRange = "1d" | "5d" | "30d";

let tableEnsured = false;

export async function ensureInfraTable(): Promise<void> {
  if (tableEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS app.infra_metric_sample (
      id BIGSERIAL PRIMARY KEY,
      sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cpu_load_1m DOUBLE PRECISION NOT NULL DEFAULT 0,
      cpu_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
      ram_used_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
      node_rss_mb DOUBLE PRECISION NOT NULL DEFAULT 0,
      heap_used_mb DOUBLE PRECISION NOT NULL DEFAULT 0,
      event_loop_lag_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
      disk_used_pct DOUBLE PRECISION,
      db_ping_ms DOUBLE PRECISION,
      db_cache_hit_pct DOUBLE PRECISION,
      db_active_conn INT NOT NULL DEFAULT 0,
      db_idle_conn INT NOT NULL DEFAULT 0,
      db_idle_in_tx INT NOT NULL DEFAULT 0,
      db_waiting INT NOT NULL DEFAULT 0,
      db_deadlocks BIGINT NOT NULL DEFAULT 0
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_infra_metric_sample_ts
    ON app.infra_metric_sample (sampled_at DESC)
  `;
  tableEnsured = true;
}

export function measureEventLoopLagMs(): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => {
      const elapsed = performance.now() - start;
      resolve(Math.max(0, Math.round((elapsed - 10) * 100) / 100));
    }, 10);
  });
}

export function getDiskStats(): { totalBytes: number; freeBytes: number; usedPct: number } | null {
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

export async function collectAndStoreInfraSample(): Promise<void> {
  await ensureInfraTable();

  const t0 = performance.now();
  const [lagMs, pingRes, dbStatsRes, connRes] = await Promise.all([
    measureEventLoopLagMs(),
    sql`SELECT 1 AS ok`.catch(() => null),
    sql<any[]>`
      SELECT blks_read::bigint AS blks_read, blks_hit::bigint AS blks_hit, deadlocks::bigint AS deadlocks
      FROM pg_stat_database WHERE datname = current_database()
    `.catch(() => []),
    sql<any[]>`
      SELECT
        COUNT(*) FILTER (WHERE state = 'active')::int AS active,
        COUNT(*) FILTER (WHERE state = 'idle')::int AS idle,
        COUNT(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_tx,
        COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL AND state = 'active')::int AS waiting
      FROM pg_stat_activity WHERE datname = current_database()
    `.catch(() => []),
  ]);

  const dbPingMs = pingRes ? Math.round((performance.now() - t0) * 10) / 10 : null;
  const load = os.loadavg();
  const cpus = os.cpus().length || 1;
  const cpuPct = Math.round((load[0] / cpus) * 1000) / 10;
  const totalRam = os.totalmem();
  const ramUsedPct = totalRam > 0 ? Math.round(((totalRam - os.freemem()) / totalRam) * 1000) / 10 : 0;
  const mem = process.memoryUsage();
  const nodeRssMb = Math.round((mem.rss / (1024 * 1024)) * 10) / 10;
  const heapUsedMb = Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10;
  const disk = getDiskStats();

  const dbRow = dbStatsRes?.[0];
  const blksHit = Number(dbRow?.blks_hit ?? 0);
  const blksRead = Number(dbRow?.blks_read ?? 0);
  const cacheHitPct = blksHit + blksRead > 0 ? Math.round((blksHit / (blksHit + blksRead)) * 10000) / 100 : 100;
  const conn = connRes?.[0] || { active: 0, idle: 0, idle_in_tx: 0, waiting: 0 };

  await sql`
    INSERT INTO app.infra_metric_sample (
      cpu_load_1m, cpu_pct, ram_used_pct, node_rss_mb, heap_used_mb,
      event_loop_lag_ms, disk_used_pct, db_ping_ms, db_cache_hit_pct,
      db_active_conn, db_idle_conn, db_idle_in_tx, db_waiting, db_deadlocks
    ) VALUES (
      ${Math.round(load[0] * 100) / 100}, ${cpuPct}, ${ramUsedPct}, ${nodeRssMb}, ${heapUsedMb},
      ${lagMs}, ${disk?.usedPct ?? null}, ${dbPingMs}, ${cacheHitPct},
      ${Number(conn.active ?? 0)}, ${Number(conn.idle ?? 0)}, ${Number(conn.idle_in_tx ?? 0)},
      ${Number(conn.waiting ?? 0)}, ${Number(dbRow?.deadlocks ?? 0)}
    )
  `;

  // Prune samples older than 45 days occasionally (~2% of writes)
  if (Math.random() < 0.02) {
    await sql`DELETE FROM app.infra_metric_sample WHERE sampled_at < NOW() - INTERVAL '45 days'`.catch(() => {});
  }
}

export async function getSarReport(range: SarRange) {
  await ensureInfraTable();

  const intervalStr = range === "30d" ? "30 days" : range === "5d" ? "5 days" : "24 hours";
  // Bucket granularity like `sar`: 15m for 1d, 2h for 5d, 1d for 30d
  const bucketSec = range === "30d" ? 86400 : range === "5d" ? 7200 : 900;

  const [summaryRows, bucketRows] = await Promise.all([
    sql<any[]>`
      SELECT
        COUNT(*)::int AS total_samples,
        ROUND(AVG(cpu_pct)::numeric, 1)::float AS cpu_avg,
        ROUND(MAX(cpu_pct)::numeric, 1)::float AS cpu_max,
        ROUND(AVG(ram_used_pct)::numeric, 1)::float AS ram_avg,
        ROUND(MAX(ram_used_pct)::numeric, 1)::float AS ram_max,
        ROUND(AVG(heap_used_mb)::numeric, 1)::float AS heap_avg,
        ROUND(MAX(heap_used_mb)::numeric, 1)::float AS heap_max,
        ROUND(AVG(event_loop_lag_ms)::numeric, 2)::float AS lag_avg,
        ROUND(MAX(event_loop_lag_ms)::numeric, 2)::float AS lag_max,
        ROUND(MAX(disk_used_pct)::numeric, 1)::float AS disk_max,
        ROUND(AVG(db_ping_ms)::numeric, 1)::float AS ping_avg,
        ROUND(MAX(db_ping_ms)::numeric, 1)::float AS ping_max,
        ROUND(MIN(db_cache_hit_pct)::numeric, 2)::float AS cache_min,
        MAX(db_active_conn)::int AS conn_max
      FROM app.infra_metric_sample
      WHERE sampled_at >= NOW() - ${intervalStr}::interval
    `,
    sql<any[]>`
      SELECT
        to_timestamp(floor(extract(epoch from sampled_at) / ${bucketSec}) * ${bucketSec}) AS bucket_ts,
        COUNT(*)::int AS samples,
        ROUND(AVG(cpu_pct)::numeric, 1)::float AS cpu_avg,
        ROUND(MAX(cpu_pct)::numeric, 1)::float AS cpu_max,
        ROUND(AVG(ram_used_pct)::numeric, 1)::float AS ram_avg,
        ROUND(AVG(heap_used_mb)::numeric, 1)::float AS heap_avg,
        ROUND(AVG(event_loop_lag_ms)::numeric, 2)::float AS lag_avg,
        ROUND(MAX(disk_used_pct)::numeric, 1)::float AS disk_max,
        ROUND(AVG(db_ping_ms)::numeric, 1)::float AS ping_avg,
        MAX(db_active_conn)::int AS conn_max,
        ROUND(MIN(db_cache_hit_pct)::numeric, 2)::float AS cache_min
      FROM app.infra_metric_sample
      WHERE sampled_at >= NOW() - ${intervalStr}::interval
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 96
    `,
  ]);

  return {
    range,
    summary: summaryRows[0] || null,
    buckets: bucketRows.map((b) => ({
      ts: b.bucket_ts instanceof Date ? b.bucket_ts.toISOString() : String(b.bucket_ts),
      samples: Number(b.samples),
      cpuAvg: Number(b.cpu_avg ?? 0),
      cpuMax: Number(b.cpu_max ?? 0),
      ramAvg: Number(b.ram_avg ?? 0),
      heapAvg: Number(b.heap_avg ?? 0),
      lagAvg: Number(b.lag_avg ?? 0),
      diskMax: b.disk_max != null ? Number(b.disk_max) : null,
      pingAvg: b.ping_avg != null ? Number(b.ping_avg) : null,
      connMax: Number(b.conn_max ?? 0),
      cacheMin: b.cache_min != null ? Number(b.cache_min) : null,
    })),
  };
}
