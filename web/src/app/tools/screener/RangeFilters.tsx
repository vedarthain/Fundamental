"use client";

/**
 * Range-filter controls — min/max number inputs for the raw fundamental
 * metrics that appear in the screener table (P/E, ROE, Div Yield, Op
 * Margin, Market Cap, 12M Return).
 *
 * UX:
 *   - Empty input = no filter on that bound.
 *   - Pressing Enter or blurring the field commits the value to the URL.
 *   - One <details> wrapper per metric so the panel stays compact when
 *     most filters are inactive.
 *
 * The state model is local: each input tracks its own draft value, and
 * only writes to the URL on commit.  Cleaner than a debounced
 * "type and the URL changes" loop, and avoids surprising back-button
 * behaviour where every keystroke creates a new history entry.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { parseParams, paramsToQuery, type ScreenerParams } from "./types";

type RangeKey = "peMax" | "pbMax" | "roeMin" | "divYldMin" | "opmMin"
              | "ret12mMin" | "mcapMin" | "mcapMax";

/** Definitions — label, placeholder, unit suffix, and the params key. */
const RANGES: { key: RangeKey; label: string; unit: string; placeholder: string }[] = [
  { key: "peMax",     label: "Max P/E",          unit: "x",   placeholder: "e.g. 30"   },
  { key: "pbMax",     label: "Max P/B",          unit: "x",   placeholder: "e.g. 5"    },
  { key: "roeMin",    label: "Min ROE",          unit: "%",   placeholder: "e.g. 15"   },
  { key: "opmMin",    label: "Min Op Margin",    unit: "%",   placeholder: "e.g. 12"   },
  { key: "divYldMin", label: "Min Div Yield",    unit: "%",   placeholder: "e.g. 2"    },
  { key: "ret12mMin", label: "Min 12M Return",   unit: "%",   placeholder: "e.g. 10"   },
  { key: "mcapMin",   label: "Min Market Cap",   unit: "Cr",  placeholder: "e.g. 5000" },
  { key: "mcapMax",   label: "Max Market Cap",   unit: "Cr",  placeholder: "e.g. 100000" },
];

export function RangeFilters() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const [, startTransition] = useTransition();

  const push = useCallback((override: Partial<ScreenerParams>) => {
    const current = parseParams(sp);
    const q = paramsToQuery({ ...current, ...override, page: 1 });
    startTransition(() => router.replace("/tools/screener" + q, { scroll: false }));
  }, [router, sp]);

  // Count of active range filters so the collapsed header can show how many
  // are set without expanding the panel.
  const activeCount = RANGES.filter(r => initial[r.key] != null).length;

  return (
    <details className="group" open={activeCount > 0}>
      <summary className="flex items-center justify-between cursor-pointer text-[12.5px] font-medium select-none py-1.5 list-none">
        <span className="flex items-center gap-2">
          <span className="inline-block transition-transform group-open:rotate-90 muted-text">›</span>
          Metric ranges
        </span>
        {activeCount > 0 && (
          <span
            className="text-[10.5px] tabular-nums px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "var(--color-accent-50)",
              color: "var(--color-accent-700)",
            }}
          >
            {activeCount} active
          </span>
        )}
      </summary>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {RANGES.map(r => (
          <RangeInput
            key={r.key}
            label={r.label}
            unit={r.unit}
            placeholder={r.placeholder}
            value={initial[r.key]}
            onCommit={(v) => push({ [r.key]: v } as Partial<ScreenerParams>)}
          />
        ))}
      </div>
      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => push({
            peMax: null, pbMax: null, roeMin: null, divYldMin: null,
            opmMin: null, ret12mMin: null, mcapMin: null, mcapMax: null,
          })}
          className="mt-2 text-[11px] muted-text hover:text-[var(--color-ink)] transition-colors"
        >
          Clear all ranges
        </button>
      )}
    </details>
  );
}

function RangeInput({
  label, unit, placeholder, value, onCommit,
}: {
  label: string;
  unit: string;
  placeholder: string;
  value: number | null;
  onCommit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") { onCommit(null); return; }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) { setDraft(value == null ? "" : String(value)); return; }
    if (n === value) return;
    onCommit(n);
  };

  return (
    <label className="flex flex-col gap-0.5 text-[11px]">
      <span className="muted-text">{label}</span>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
          className="w-full px-2 py-1 pr-7 rounded border text-[12px] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-300)]"
          style={{
            borderColor: "var(--color-border-default)",
            backgroundColor: "var(--color-card)",
          }}
        />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 muted-text text-[10.5px] pointer-events-none">
          {unit}
        </span>
      </div>
    </label>
  );
}
