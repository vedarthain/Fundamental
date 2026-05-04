"use client";

/** Sector filter — 8 meta-cluster chips above the results table.
 * Multi-select, glance-able. URL-syncs via the `metas` query param.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { paramsToQuery, parseParams } from "./types";

export type MetaOption = {
  id: string;
  name: string;
  cluster_count: number;
};

export function MetaChips({ metas }: { metas: MetaOption[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const [, startTransition] = useTransition();

  const selected = new Set(initial.metas);
  // Don't show the "diversified_meta" if it has very few clusters (it's the catch-all)
  const visible = metas.filter((m) => m.cluster_count > 0);

  const toggle = (id: string) => {
    const next = selected.has(id)
      ? initial.metas.filter((x) => x !== id)
      : [...initial.metas, id];
    const q = paramsToQuery({ ...initial, metas: next, page: 1 });
    startTransition(() => router.replace("/screener" + q, { scroll: false }));
  };

  const clearAll = () => {
    const q = paramsToQuery({ ...initial, metas: [], page: 1 });
    startTransition(() => router.replace("/screener" + q, { scroll: false }));
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
            onClick={() => toggle(m.id)}
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
