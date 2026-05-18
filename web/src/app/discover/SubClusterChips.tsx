"use client";

/** Industry / sub-cluster chips — appear when a Sector is selected.
 * Single-select: each industry has its own peer pool, so combining industries
 * yields apples-to-oranges results. URL-syncs via the `clusters` query param.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import { paramsToQuery, parseParams } from "./types";

export type ClusterRow = {
  id: string;
  name: string;
  sector_id: string;
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
    return clusters.filter((c) => selectedMetas.has(c.sector_id));
  }, [clusters, selectedMetas]);

  // Single-select: clicking an industry replaces the selection. Clicking the
  // currently-selected one clears it.
  const pick = (id: string) => {
    const next = selectedClusters.has(id) ? [] : [id];
    const q = paramsToQuery({ ...initial, clusters: next, page: 1 });
    startTransition(() => router.replace("/discover" + q, { scroll: false }));
  };

  const clearAll = () => {
    if (selectedClusters.size === 0) return;
    const q = paramsToQuery({ ...initial, clusters: [], page: 1 });
    startTransition(() => router.replace("/discover" + q, { scroll: false }));
  };

  const allIndActive = selectedClusters.size === 0;
  const hint = selectedMetas.size === 0;

  // When no sector is selected, "All industries" is redundant with the
  // "All sectors" pill above — the result set is identical. Skip the pill
  // and just show the hint inline.
  if (hint) {
    return (
      <div className="text-[12px] muted-text italic">
        Pick a sector above to drill into specific industries.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={clearAll}
        className={`inline-flex items-center px-3 py-1.5 rounded-full text-[12px] border transition-colors cursor-pointer select-none ${
          allIndActive
            ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
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
            onClick={() => pick(c.id)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-[12px] border transition-colors cursor-pointer select-none ${
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
