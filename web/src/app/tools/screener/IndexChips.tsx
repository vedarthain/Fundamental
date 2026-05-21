"use client";

/** Index membership filter — single-select dropdown for the screener
 * sidebar. Nifty 50 ⊂ 200 ⊂ 500, so we never combine; picking one
 * replaces the previous selection. "All" clears the filter.
 *
 * Index membership is orthogonal to sector — e.g. /tools/screener?metas=
 * financials&index=nifty50 narrows to large-cap financials.
 */

import { useSearchParams } from "next/navigation";
import {
  paramsToQuery, parseParams,
  INDEX_KEYS, INDEX_LABELS,
} from "./types";
import { FilterDropdown } from "./FilterDropdown";

export function IndexChips() {
  const sp = useSearchParams();
  const initial = parseParams(sp);

  const options = INDEX_KEYS.map((k) => ({
    value: k,
    label: INDEX_LABELS[k],
  }));

  const hrefFor = (opt: { value: string }) =>
    "/tools/screener" + paramsToQuery({
      ...initial,
      index: opt.value as typeof initial.index,
      page: 1,
    });

  return (
    <FilterDropdown
      value={initial.index}
      options={options}
      hrefFor={hrefFor}
      placeholder="All"
    />
  );
}
