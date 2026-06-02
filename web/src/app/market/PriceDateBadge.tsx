"use client";

/**
 * Price-freshness badge for the /market header.
 *
 * The server only knows the last EOD close date (`ltpDate` = MAX(date) in
 * market_index_history), which lags by a day while today's session is still
 * open. But the intraday pingers ARE updating live prices, so showing
 * "Close · <yesterday>" during market hours is misleading.
 *
 * This client component reads the browser clock and shows:
 *   - "Live · <today>"   with a pulsing dot, when NSE is open
 *                        (Mon–Fri, 09:15–15:30 IST)
 *   - "Close · <ltpDate>" otherwise (the last settled session)
 *
 * Why client-side: the /market page/response is CDN-cached up to an hour,
 * so a server-rendered open/closed decision could be stale. Computing in
 * the browser keeps the label correct regardless of cache age. First paint
 * renders the server-safe "Close · <ltpDate>" (null state) to avoid any
 * hydration mismatch, then upgrades after mount.
 *
 * Holiday caveat: a trading holiday that falls on a weekday inside market
 * hours would still read "Live". That's an acceptable cosmetic edge for a
 * freshness label — the underlying prices simply won't be moving.
 */
import { useEffect, useState } from "react";

const OPEN_MIN  = 9 * 60 + 15;   // 09:15 IST
const CLOSE_MIN = 15 * 60 + 30;  // 15:30 IST
const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

type LiveState = { live: boolean; label: string };

function istSnapshot(): { weekday: string; minutes: number; dateLabel: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short", day: "2-digit", month: "short",
    hour: "numeric", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  // hour12:false can emit "24" at midnight in some engines — normalise.
  const hour = Number(p.hour) % 24;
  return {
    weekday: p.weekday,
    minutes: hour * 60 + Number(p.minute),
    dateLabel: `${p.weekday}, ${p.day} ${p.month}`,
  };
}

function fmtClose(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}

export function PriceDateBadge({ ltpDate }: { ltpDate: string | null }) {
  // null → first paint matches the server (plain "Close · <ltpDate>").
  const [state, setState] = useState<LiveState | null>(null);

  useEffect(() => {
    const compute = () => {
      const { weekday, minutes, dateLabel } = istSnapshot();
      const open = WEEKDAYS.has(weekday) && minutes >= OPEN_MIN && minutes <= CLOSE_MIN;
      setState(open
        ? { live: true,  label: dateLabel }
        : { live: false, label: fmtClose(ltpDate) });
    };
    compute();
    // Re-evaluate each minute so the badge flips at the open/close boundary
    // without a reload.
    const id = setInterval(compute, 60_000);
    return () => clearInterval(id);
  }, [ltpDate]);

  const live = state?.live ?? false;
  const prefix = live ? "Live" : "EOD";
  const value = state ? state.label : fmtClose(ltpDate);

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border"
      style={{
        borderColor: live ? "var(--color-delta-up)" : "var(--color-border-default)",
        backgroundColor: live
          ? "color-mix(in srgb, var(--color-delta-up) 8%, var(--color-paper))"
          : "var(--color-paper)",
      }}
      title={live
        ? "Market open — prices updating intraday"
        : "End-of-day closing prices from the last settled session (NSE bhavcopy)"}
    >
      {live && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: "var(--color-delta-up)" }} />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-delta-up)" }} />
        </span>
      )}
      <span className="muted-text">{prefix}</span>
      <span className="font-medium" style={{ color: live ? "var(--color-delta-up)" : "var(--color-ink)" }}>
        {value}
      </span>
    </span>
  );
}
