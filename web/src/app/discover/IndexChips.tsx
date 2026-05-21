"use client";

/** Index membership filter — Nifty 50 / 200 / 500 / All.
 *
 * Single-select (an active stock is in at most one "current scope" at a time —
 * Nifty 50 ⊂ 200 ⊂ 500, so picking the broader one already includes the
 * narrower). URL-syncs via the `index` query param. "All" = empty / no filter.
 *
 * Placed next to Sector + Industry rows on /discover, with the same compact
 * pill style. Index membership is orthogonal to sector — you can combine
 * "Nifty 50" + "Financials" to see only large-cap financials, for example.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  paramsToQuery, parseParams,
  INDEX_KEYS, INDEX_LABELS, type IndexKey,
} from "./types";

export function IndexChips() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const [, startTransition] = useTransition();

  const pick = (k: IndexKey) => {
    // Clicking the active index clears it (=== "All").
    const next = initial.index === k ? "" : k;
    const q = paramsToQuery({ ...initial, index: next, page: 1 });
    startTransition(() => router.replace("/discover" + q, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {INDEX_KEYS.map((k) => {
        const active = initial.index === k;
        return (
          <button
            key={k || "all"}
            type="button"
            onClick={() => pick(k)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-[12px] border transition-colors cursor-pointer select-none ${
              active
                ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
                : "bg-[var(--color-card)] hairline hover:bg-[var(--color-paper)]"
            }`}
          >
            {INDEX_LABELS[k]}
          </button>
        );
      })}
    </div>
  );
}
