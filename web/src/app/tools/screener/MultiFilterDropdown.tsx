"use client";

/** Multi-select filter dropdown for the screener sidebar.
 *
 * Used for Sector and Industry where a user might legitimately want to
 * combine multiple selections (e.g. "top compounders across Financials,
 * Tech, and Healthcare"). The Industry Score per stock stays meaningful
 * because each score is peer-relative within its OWN cluster — combining
 * sectors just picks which peer pools to draw from, not which scores to
 * compare against each other.
 *
 * Pending-state UX: checkboxes update local state on click (stays open so
 * users can pick several without re-rendering). When the dropdown closes
 * (click outside, Escape), we call onApply(pendingValues) once with the
 * final set — single URL update instead of one per click.
 */

import { useEffect, useRef, useState } from "react";

export type MultiOption = {
  value: string;
  label: string;
  hint?: string;
};

export function MultiFilterDropdown({
  values, options, onApply, placeholder, disabled, maxVisibleInLabel = 2,
}: {
  values: string[];
  options: MultiOption[];
  /** Called when the user closes the menu with a changed selection. */
  onApply: (values: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  /** How many selected labels to show in the button before collapsing to "+N". */
  maxVisibleInLabel?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string[]>(values);
  const ref = useRef<HTMLDivElement>(null);

  // Reset pending whenever the URL-driven `values` changes (covers Reset-all
  // and external state changes while the dropdown is closed).
  useEffect(() => {
    if (!open) setPending(values);
  }, [values, open]);

  // Apply when closing with a different selection.
  const close = () => {
    setOpen(false);
    if (!sameSet(pending, values)) onApply(pending);
  };

  // Open: snap pending to current values so the user starts from the
  // canonical state, not a stale one.
  const toggleOpen = () => {
    if (disabled) return;
    if (!open) setPending(values);
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending, values]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending, values]);

  const togglePending = (v: string) => {
    setPending((cur) => cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  };

  const clearPending = () => setPending([]);

  // Button label — show selected names, collapse if too many.
  const selectedOptions = values.map((v) => options.find((o) => o.value === v)).filter(Boolean) as MultiOption[];
  let buttonLabel: string;
  if (selectedOptions.length === 0) {
    buttonLabel = placeholder;
  } else if (selectedOptions.length <= maxVisibleInLabel) {
    buttonLabel = selectedOptions.map((o) => o.label).join(", ");
  } else {
    const visible = selectedOptions.slice(0, maxVisibleInLabel).map((o) => o.label).join(", ");
    const overflow = selectedOptions.length - maxVisibleInLabel;
    buttonLabel = `${visible} +${overflow}`;
  }

  const isSelected = values.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selectedOptions.length > maxVisibleInLabel
          ? selectedOptions.map((o) => o.label).join(", ")
          : undefined}
        className={`w-full inline-flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[12.5px] border hairline transition-colors ${
          disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-[var(--color-paper)]"
        }`}
        style={{ backgroundColor: "var(--color-card)" }}
      >
        <span className={`truncate ${isSelected ? "ink-text" : "muted-text"}`}>
          {buttonLabel}
        </span>
        <span aria-hidden className="text-[9px] opacity-60 shrink-0">▾</span>
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute z-30 mt-1 w-full max-h-[280px] overflow-y-auto rounded-md border hairline shadow-lg"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          {options.map((opt) => {
            const checked = pending.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => togglePending(opt.value)}
                className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-[var(--color-paper)] transition-colors ${
                  checked ? "bg-[var(--color-accent-50)]" : ""
                }`}
              >
                <span
                  aria-hidden
                  className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0 ${
                    checked ? "border-[var(--color-accent-600)]" : "border-[var(--color-border-default)]"
                  }`}
                  style={{
                    backgroundColor: checked ? "var(--color-accent-600)" : "transparent",
                  }}
                >
                  {checked && (
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5">
                      <path d="M2 6.5l2.5 2.5L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={`truncate flex-1 ${checked ? "text-[var(--color-accent-700)]" : ""}`}>
                  {opt.label}
                </span>
                {opt.hint && (
                  <span className="text-[10.5px] muted-text tabular-nums shrink-0">
                    {opt.hint}
                  </span>
                )}
              </button>
            );
          })}
          {pending.length > 0 && (
            <button
              type="button"
              onClick={clearPending}
              className="w-full text-left px-2.5 py-1.5 border-t hairline text-[11.5px] hover:bg-[var(--color-paper)] transition-colors text-[var(--color-accent-600)]"
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}
