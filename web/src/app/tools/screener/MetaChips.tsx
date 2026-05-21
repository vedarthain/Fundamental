"use client";

/** Sector filter — multi-select dropdown for the screener sidebar.
 *
 * Multi-select supports the "top compounders across 3 sectors" workflow.
 * Each stock's Industry Score stays peer-relative within its OWN cluster,
 * so combining sectors doesn't break score comparability — it just picks
 * which peer pools to draw the list from.
 *
 * When the user changes the sector selection, we PRUNE the industry filter
 * to only those industries whose sector is still selected. Industries left
 * orphaned (their sector got de-selected) would yield contradictory filter
 * combinations.
 *
 * Component name kept as MetaChips for git history continuity.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { paramsToQuery, parseParams } from "./types";
import { MultiFilterDropdown } from "./MultiFilterDropdown";
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

  // Hide meta-clusters with zero active clusters (catch-all bucket).
  const visible = metas.filter((m) => m.cluster_count > 0);

  const options = visible.map((m) => ({
    value: m.id,
    label: m.name,
    hint: `${m.cluster_count} ind.`,
  }));

  const onApply = (newSectors: string[]) => {
    // Prune industry filter to only those whose sector is still selected.
    // If no sectors selected, drop industries entirely.
    const allowedIndustryIds = newSectors.length === 0
      ? new Set<string>()
      : new Set(clusters.filter((c) => newSectors.includes(c.sector_id)).map((c) => c.id));
    const newClusters = initial.clusters.filter((id) => allowedIndustryIds.has(id));
    const q = paramsToQuery({
      ...initial,
      metas: newSectors,
      clusters: newClusters,
      page: 1,
    });
    startTransition(() => router.replace("/tools/screener" + q, { scroll: false }));
  };

  return (
    <MultiFilterDropdown
      values={initial.metas}
      options={options}
      onApply={onApply}
      placeholder="All sectors"
    />
  );
}
