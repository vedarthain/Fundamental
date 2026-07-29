"use client";

/**
 * WindowPicker — a small segmented control for choosing a sparkline time window.
 *
 * Presentational only: the parent owns the selected `days` and the options list
 * (from sparkWindows.ts), so the same control serves every tab with that tab's
 * own subset (Igniting tops out at 1Y, At Support runs to ALL). `loading` just
 * dims the row and shows a tiny spinner so a window switch reads as "fetching".
 */
import type { WindowOpt } from "./sparkWindows";

export function WindowPicker({
  options,
  days,
  onSelect,
  loading = false,
}: {
  options: WindowOpt[];
  days: number;
  onSelect: (days: number) => void;
  loading?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label="Chart time range">
      <div className="inline-flex rounded-md border hairline overflow-hidden">
        {options.map((o) => {
          const active = o.days === days;
          return (
            <button
              key={o.label}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(o.days)}
              className="px-2 py-1 text-[11px] font-medium tabular-nums transition-colors"
              style={{
                background: active ? "var(--color-accent-600)" : "transparent",
                color: active ? "#fff" : "var(--color-muted)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <span
        className="text-[10px] muted-text transition-opacity"
        style={{ opacity: loading ? 1 : 0 }}
        aria-hidden={!loading}
      >
        …
      </span>
    </div>
  );
}
