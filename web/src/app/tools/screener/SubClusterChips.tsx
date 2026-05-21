"use client";

/** Industry / sub-cluster filter — multi-select dropdown for the screener
 * sidebar. Options are scoped to the currently-selected sector(s).
 *
 * Empty/disabled when no sector is picked — an industry filter with no
 * parent sector is ambiguous (which sector's industries?). Shown as a
 * disabled dropdown with a hint placeholder.
 */

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { paramsToQuery, parseParams } from "./types";
import { MultiFilterDropdown } from "./MultiFilterDropdown";

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

  // Only show industries whose sector is currently selected. When zero
  // sectors are picked, show nothing (the disabled state below handles it).
  const visible = useMemo(() => {
    if (initial.metas.length === 0) return [];
    const selectedSet = new Set(initial.metas);
    return clusters.filter((c) => selectedSet.has(c.sector_id));
  }, [clusters, initial.metas]);

  if (initial.metas.length === 0) {
    return (
      <MultiFilterDropdown
        values={[]}
        options={[]}
        onApply={() => {}}
        placeholder="Pick a sector first"
        disabled
      />
    );
  }

  const options = visible.map((c) => ({ value: c.id, label: c.name }));

  const onApply = (newIndustries: string[]) => {
    const q = paramsToQuery({
      ...initial,
      clusters: newIndustries,
      page: 1,
    });
    startTransition(() => router.replace("/tools/screener" + q, { scroll: false }));
  };

  return (
    <MultiFilterDropdown
      values={initial.clusters}
      options={options}
      onApply={onApply}
      placeholder="All industries"
    />
  );
}
