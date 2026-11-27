"use client";

import { useEffect, useState } from "react";

function formatSnapshotDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function SnapshotStatsCells({
  initialLatest,
  initialCoverage,
  initialClusters,
}: {
  initialLatest: string | null;
  initialCoverage: number;
  initialClusters: number;
}) {
  const [stats, setStats] = useState({
    latest: initialLatest,
    coverage: initialCoverage,
    clusters: initialClusters,
  });

  useEffect(() => {
    if (stats.latest && stats.coverage > 0) return;
    let cancelled = false;
    fetch("/api/snapshot-summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && data.coverage > 0) {
          setStats({
            latest: data.latest ?? null,
            coverage: Number(data.coverage ?? 0),
            clusters: Number(data.clusters ?? 0),
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stats.latest, stats.coverage]);

  return (
    <>
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span className="kbd-label" style={{ color: "var(--color-strip-fg)" }}>
          SNAPSHOT
        </span>
        <span className="num num-sm" style={{ color: "var(--color-strip-fg)", fontWeight: 700 }}>
          {formatSnapshotDate(stats.latest)}
        </span>
      </span>
      <span aria-hidden className="h-3 w-px shrink-0" style={{ backgroundColor: "var(--color-strip-rule)" }} />
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span className="kbd-label" style={{ color: "var(--color-strip-muted)" }}>
          COVERAGE
        </span>
        <span className="num num-sm" style={{ color: "var(--color-strip-fg)" }}>
          {stats.coverage.toLocaleString("en-IN")}
        </span>
      </span>
      <span aria-hidden className="h-3 w-px shrink-0" style={{ backgroundColor: "var(--color-strip-rule)" }} />
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span className="kbd-label" style={{ color: "var(--color-strip-muted)" }}>
          CLUSTERS
        </span>
        <span className="num num-sm" style={{ color: "var(--color-strip-fg)" }}>
          {stats.clusters}
        </span>
      </span>
    </>
  );
}
