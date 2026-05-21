"use client";

/** Compact single-select dropdown for screener filters (Sector / Industry /
 * Index). Replaces the pill rows that were eating ~100-150px of sidebar
 * vertical space each. A dropdown with the same data takes ~30px collapsed
 * and opens an overlay when clicked.
 *
 * URL-driven — click an option → navigates with the new param → server
 * re-renders. Closes on outside-click, Escape, or selection.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type DropdownOption = {
  value: string;
  label: string;
  /** Optional secondary label shown on the right (e.g. stock count). */
  hint?: string;
  /** When true, the option appears disabled (and is not selectable). */
  disabled?: boolean;
};

export function FilterDropdown({
  value, options, hrefFor, placeholder, disabled,
}: {
  value: string;
  /** All selectable options. Caller provides the "All" / clear option as the
   *  first entry if desired. */
  options: DropdownOption[];
  /** Build the href for an option click — caller knows how to update URL. */
  hrefFor: (option: DropdownOption) => string;
  /** Shown when value is empty / matches no option. */
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Find the currently-selected option's label to show in the button.
  const selected = options.find((o) => o.value === value);
  const buttonLabel = selected ? selected.label : placeholder;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full inline-flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[12.5px] border hairline transition-colors ${
          disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-[var(--color-paper)]"
        }`}
        style={{ backgroundColor: "var(--color-card)" }}
      >
        <span className={`truncate ${selected ? "ink-text" : "muted-text"}`}>
          {buttonLabel}
        </span>
        <span aria-hidden className="text-[9px] opacity-60 shrink-0">▾</span>
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-[260px] overflow-y-auto rounded-md border hairline shadow-lg"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            if (opt.disabled) {
              return (
                <div
                  key={opt.value}
                  className="block px-2.5 py-1.5 text-[12px] muted-text opacity-50"
                  role="option"
                  aria-selected={false}
                  aria-disabled
                >
                  {opt.label}
                </div>
              );
            }
            return (
              <Link
                key={opt.value}
                href={hrefFor(opt)}
                role="option"
                aria-selected={active}
                scroll={false}
                onClick={() => setOpen(false)}
                className={`block px-2.5 py-1.5 text-[12px] hover:bg-[var(--color-paper)] transition-colors ${
                  active ? "bg-[var(--color-accent-50)] text-[var(--color-accent-700)]" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{opt.label}</span>
                  {opt.hint && (
                    <span className="text-[10.5px] muted-text tabular-nums shrink-0">
                      {opt.hint}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
