"use client";

/**
 * ScannerDatePicker — lets a scanner browse its stored history (up to ~1 year
 * of daily snapshots). Each scanner owns its own URL search-param (mDate, tDate,
 * fDate, rDate), so their dates move independently. Changing it does a soft
 * navigation; the server re-loads that scanner for the chosen date. "Latest"
 * clears the param so the page always defaults to the freshest scan.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";

function label(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function ScannerDatePicker({
  param,
  dates,
  selected,
}: {
  /** URL search-param this picker controls (e.g. "mDate"). */
  param: string;
  /** Available snapshot dates, most recent first. */
  dates: string[];
  /** Currently-shown date (matches one of `dates`). */
  selected: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Nothing to browse with a single snapshot — don't clutter the header.
  if (dates.length <= 1) return null;

  const isLatest = selected === dates[0];

  function onChange(value: string) {
    const q = new URLSearchParams(searchParams.toString());
    if (value === "latest") q.delete(param);
    else q.set(param, value);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <label className="inline-flex items-center gap-1.5 text-[12px]">
      <span className="muted-text">History</span>
      <select
        value={isLatest ? "latest" : selected ?? "latest"}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border hairline bg-transparent px-2 py-1 text-[12px] tabular-nums"
        style={{ color: "var(--color-ink)" }}
      >
        <option value="latest">Latest ({label(dates[0])})</option>
        {dates.slice(1).map((d) => (
          <option key={d} value={d}>
            {label(d)}
          </option>
        ))}
      </select>
    </label>
  );
}
