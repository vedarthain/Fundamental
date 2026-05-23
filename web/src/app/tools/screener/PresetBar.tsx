"use client";

/**
 * Quick-preset bar — pre-built filter combinations the user can apply
 * with one click instead of configuring 5+ sliders manually.
 *
 * Presets are defined in types.ts (FILTER_PRESETS).  Each preset
 * explicitly clears the other range filters so combinations don't
 * accumulate from previous sessions; clicking "Value" after "Growth"
 * gives you the Value filter set, not Value-plus-Growth.
 *
 * Each preset is keyed by the URL param `preset=` for sharability /
 * back-button restoration.  The CSV export button reuses the same URL
 * + a /export suffix so downloads respect the active preset.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { FILTER_PRESETS, parseParams, paramsToQuery, type ScreenerParams } from "./types";

export function PresetBar() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const [, startTransition] = useTransition();

  // Detect which preset (if any) is currently active by comparing the
  // preset's defined filters against the current params.  Picks the first
  // exact match — presets are deliberately disjoint so at most one matches.
  const activeKey = (() => {
    for (const [key, preset] of Object.entries(FILTER_PRESETS)) {
      const f = preset.filters;
      // Each preset is a tuple of expected (param, value) pairs.  All must
      // match the current params for the preset to be "active".
      const matches = Object.entries(f).every(([k, v]) =>
        (initial as unknown as Record<string, unknown>)[k] === v
      );
      if (matches) return key;
    }
    return null;
  })();

  const apply = useCallback((presetKey: string) => {
    // Toggle: clicking an already-active preset clears its filters back to
    // the defaults instead of being a no-op.
    if (presetKey === activeKey) {
      const cleared: Partial<ScreenerParams> = {
        roeMin: null, divYldMin: null, opmMin: null, ret12mMin: null,
        peMax: null, pbMax: null, mcapMin: null, mcapMax: null,
        minQ: 0, minV: 0, minM: 0, minC: 0,
      };
      const q = paramsToQuery({ ...initial, ...cleared, page: 1 });
      startTransition(() => router.replace("/tools/screener" + q, { scroll: false }));
      return;
    }
    const preset = FILTER_PRESETS[presetKey];
    if (!preset) return;
    const q = paramsToQuery({ ...initial, ...preset.filters, page: 1 });
    startTransition(() => router.replace("/tools/screener" + q, { scroll: false }));
  }, [router, initial, activeKey]);

  // Build the current export URL — same params, suffixed with /export so
  // the route handler can serve text/csv.
  const exportHref = "/tools/screener/export" + paramsToQuery(initial);

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
      <span className="text-[11px] uppercase tracking-wide muted-text font-medium mr-1">
        Quick filters
      </span>
      {Object.entries(FILTER_PRESETS).map(([key, preset]) => {
        const active = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            onClick={() => apply(key)}
            title={preset.description}
            className="px-2.5 py-1 rounded-md border text-[11.5px] font-medium transition-colors whitespace-nowrap"
            style={
              active
                ? {
                    borderColor: "var(--color-accent-500)",
                    backgroundColor: "var(--color-accent-50)",
                    color: "var(--color-accent-700)",
                    boxShadow: "inset 0 0 0 1px var(--color-accent-500)",
                  }
                : {
                    borderColor: "var(--color-border-default)",
                    backgroundColor: "transparent",
                    color: "var(--color-muted)",
                  }
            }
          >
            {preset.label}
          </button>
        );
      })}
      {/* CSV export — opens in a new tab so the user doesn't lose their
          filter state if the download is cancelled. */}
      <a
        href={exportHref}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto px-2.5 py-1 rounded-md border text-[11.5px] font-medium transition-colors whitespace-nowrap"
        style={{
          borderColor: "var(--color-border-default)",
          backgroundColor: "var(--color-card)",
          color: "var(--color-ink)",
        }}
        title="Download the full filtered result set as a CSV"
      >
        Export CSV ↓
      </a>
    </div>
  );
}
