"use client";

/**
 * Price-freshness badge for the /market header.
 *
 * Shows one of three states:
 *   - "Live · <today>"      pulsing green dot  — NSE open (Mon–Fri 09:15–15:30 IST, non-holiday)
 *   - "Holiday · <name>"   amber               — trading holiday falling on a weekday
 *   - "EOD · <ltpDate>"    neutral             — outside trading hours or weekend
 *
 * Why client-side: the /market page is CDN-cached up to an hour, so a
 * server-rendered open/closed decision could be stale. Browser clock keeps
 * the label correct regardless of cache age. First paint renders the
 * server-safe EOD state (null) to avoid hydration mismatches.
 */
import { useEffect, useState } from "react";
import { NSE_HOLIDAYS_2026 } from "@/lib/nse-holidays";

const OPEN_MIN  = 9 * 60 + 15;   // 09:15 IST
const CLOSE_MIN = 15 * 60 + 30;  // 15:30 IST
const WEEKDAYS  = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

// ISO date → holiday name (weekday holidays only — weekends already excluded)
const HOLIDAY_MAP: Record<string, string> = Object.fromEntries(
  NSE_HOLIDAYS_2026.map((h) => [h.date, h.name])
);

type MarketState =
  | { kind: "live";    label: string }
  | { kind: "holiday"; label: string }  // holiday name
  | { kind: "eod";     label: string };

function istSnapshot(): {
  weekday: string; minutes: number; dateLabel: string; isoDate: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;  // hour12:false can emit "24" at midnight
  const isoDate = `${p.year}-${p.month}-${p.day}`;
  const dayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short",
  }).formatToParts(new Date());
  const dp = Object.fromEntries(dayParts.map((x) => [x.type, x.value]));
  return {
    weekday: p.weekday,
    minutes: hour * 60 + Number(p.minute),
    dateLabel: `${dp.weekday}, ${dp.day} ${dp.month}`,
    isoDate,
  };
}

function fmtClose(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}

export function PriceDateBadge({ ltpDate }: { ltpDate: string | null }) {
  const [state, setState] = useState<MarketState | null>(null);

  useEffect(() => {
    const compute = () => {
      const { weekday, minutes, dateLabel, isoDate } = istSnapshot();
      const isWeekday  = WEEKDAYS.has(weekday);
      const inSession  = minutes >= OPEN_MIN && minutes <= CLOSE_MIN;
      const holidayName = HOLIDAY_MAP[isoDate];

      if (isWeekday && holidayName) {
        // Weekday holiday — market is closed regardless of time
        setState({ kind: "holiday", label: holidayName });
      } else if (isWeekday && inSession) {
        setState({ kind: "live", label: dateLabel });
      } else {
        setState({ kind: "eod",  label: fmtClose(ltpDate) });
      }
    };
    compute();
    const id = setInterval(compute, 60_000);
    return () => clearInterval(id);
  }, [ltpDate]);

  const kind    = state?.kind ?? "eod";
  const value   = state ? state.label : fmtClose(ltpDate);

  const isLive    = kind === "live";
  const isHoliday = kind === "holiday";

  const borderColor = isLive
    ? "var(--color-delta-up)"
    : isHoliday
    ? "#d97706"
    : "var(--color-border-default)";

  const bgColor = isLive
    ? "color-mix(in srgb, var(--color-delta-up) 8%, var(--color-paper))"
    : isHoliday
    ? "rgba(217,119,6,0.08)"
    : "var(--color-paper)";

  const labelColor = isLive
    ? "var(--color-delta-up)"
    : isHoliday
    ? "#d97706"
    : "var(--color-ink)";

  const prefix = isLive ? "Live" : isHoliday ? "Holiday" : "EOD";

  const title = isLive
    ? "Market open — prices updating intraday"
    : isHoliday
    ? `NSE trading holiday — ${value}`
    : "End-of-day closing prices from the last settled session (NSE bhavcopy)";

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border"
      style={{ borderColor, backgroundColor: bgColor }}
      title={title}
    >
      {isLive && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: "var(--color-delta-up)" }} />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-delta-up)" }} />
        </span>
      )}
      {isHoliday && (
        <span className="text-[10px]" aria-hidden>🏛</span>
      )}
      <span className="muted-text">{prefix}</span>
      <span className="font-medium" style={{ color: labelColor }}>{value}</span>
    </span>
  );
}
