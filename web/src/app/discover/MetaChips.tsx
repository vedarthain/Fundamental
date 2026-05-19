"use client";

/** Sector filter — meta-cluster chips above the results table.
 * Single-select: each sector has its own peer pool, so combining sectors
 * yields apples-to-oranges results. URL-syncs via the `metas` query param.
 * Picking a sector also clears any industry selection (clusters), since
 * industries belong to a single sector.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { paramsToQuery, parseParams } from "./types";
import type { ClusterRow } from "./SubClusterChips";

export type MetaOption = {
  id: string;
  name: string;
  cluster_count: number;
};

export function MetaChips({
  metas, clusters,
}: { metas: MetaOption[]; clusters: ClusterRow[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const [, startTransition] = useTransition();

  const selected = new Set(initial.metas);
  // Don't show the "diversified_meta" if it has very few clusters (it's the catch-all)
  const visible = metas.filter((m) => m.cluster_count > 0);

  // Single-select: clicking a sector replaces the selection. Clicking the
  // currently-selected one clears it. Picking a new sector ALSO auto-selects
  // its first industry (alphabetical, matches loadClusters ORDER BY name) —
  // landing on "All industries" as the default conveys nothing the "All
  // sectors" pill doesn't already say, and the user's most likely next step
  // is to drill into a specific industry anyway.
  const pick = (id: string) => {
    if (selected.has(id)) {
      // Clicking the active sector clears both filters.
      const q = paramsToQuery({ ...initial, metas: [], clusters: [], page: 1 });
      startTransition(() => router.replace("/discover" + q, { scroll: false }));
      return;
    }
    const firstIndustry = clusters.find((c) => c.sector_id === id);
    const next = firstIndustry ? [firstIndustry.id] : [];
    const q = paramsToQuery({ ...initial, metas: [id], clusters: next, page: 1 });
    startTransition(() => router.replace("/discover" + q, { scroll: false }));
  };

  const clearAll = () => {
    const q = paramsToQuery({ ...initial, metas: [], clusters: [], page: 1 });
    startTransition(() => router.replace("/discover" + q, { scroll: false }));
  };

  const allActive = selected.size === 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={clearAll}
        className={`inline-flex items-center px-3 py-1.5 rounded-full text-[12px] border transition-colors cursor-pointer select-none ${
          allActive
            ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
            : "bg-[var(--color-card)] hairline hover:bg-[var(--color-paper)]"
        }`}
      >
        All sectors
      </button>
      {visible.map((m) => {
        const active = selected.has(m.id);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => pick(m.id)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-[12px] border transition-colors cursor-pointer select-none ${
              active
                ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
                : "bg-[var(--color-card)] hairline hover:bg-[var(--color-paper)]"
            }`}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}
