"use client";

/** Industry / sub-cluster chips — appear when a Sector is selected.
 * Multi-select; URL-syncs via the `clusters` query param.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import { paramsToQuery, parseParams } from "./types";

export type ClusterRow = {
  id: string;
  name: string;
  meta_cluster_id: string;
};

export function SubClusterChips({ clusters }: { clusters: ClusterRow[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const [, startTransition] = useTransition();

  const selectedClusters = new Set(initial.clusters);
  const selectedMetas = new Set(initial.metas);

  // Show only clusters within the currently-selected sectors. If no sector
  // is selected, hint the user to pick one first.
  const visible = useMemo(() => {
    if (selectedMetas.size === 0) return [];
    return clusters.filter((c) => selectedMetas.has(c.meta_cluster_id));
  }, [clusters, selectedMetas]);

  if (selectedMetas.size === 0) {
    return (
      <div className="text-[12px] muted-text italic">
        Pick a sector above to drill into its industries.
      </div>
    );
  }

  const toggle = (id: string) => {
    const next = selectedClusters.has(id)
      ? initial.clusters.filter((x) => x !== id)
      : [...initial.clusters, id];
    const q = paramsToQuery({ ...initial, clusters: next, page: 1 });
    startTransition(() => router.replace("/discover" + q, { scroll: false }));
  };

  const clearAll = () => {
    if (selectedClusters.size === 0) return;
    const q = paramsToQuery({ ...initial, clusters: [], page: 1 });
    startTransition(() => router.replace("/discover" + q, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={clearAll}
        className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] border transition-colors cursor-pointer select-none ${
          selectedClusters.size === 0
            ? "bg-[var(--color-paper)] hairline muted-text"
            : "bg-[var(--color-card)] hairline hover:bg-[var(--color-paper)]"
        }`}
      >
        All industries
      </button>
      {visible.map((c) => {
        const active = selectedClusters.has(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => toggle(c.id)}
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] border transition-colors cursor-pointer select-none ${
              active
                ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
                : "bg-[var(--color-card)] hairline hover:bg-[var(--color-paper)]"
            }`}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
