"use client";

/**
 * ReviewMark / ReviewCounter — the "I've reviewed this" control for the Graph
 * (per sector) and Themes (per theme) rails.
 *
 * Design notes that matter at the call site:
 *
 * • The toggle is a SIBLING of the row's select button, never nested inside it.
 *   Both rails wrap the name in a <button onClick={select}>; an inner <button>
 *   would be invalid HTML and clicking the check would also navigate. Call
 *   sites place <ReviewMark> between the chevron and the select button.
 *
 * • It stops propagation so marking a sector never changes what the grid shows.
 *   Recording that you finished looking at something should not move you.
 *
 * • Dimming is the PRIMARY signal; the "3d" text is confirmation. On a page
 *   whose job is scanning charts, "what's left this week" should be answerable
 *   without reading anything. Call sites apply `reviewedRowStyle` to the row.
 */
import { shortAge, REVIEW_WINDOW_DAYS } from "@/lib/sectorReviews";

/** Opacity for a row reviewed inside the window. Low enough to recede on a
 *  scan, high enough that the name stays legible when you go looking for it. */
export const REVIEWED_OPACITY = 0.45;

/** Row style for a reviewed entry — spread onto the rail row's style object. */
export function reviewedRowStyle(reviewed: boolean): React.CSSProperties {
  return reviewed ? { opacity: REVIEWED_OPACITY } : {};
}

function CheckIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={filled ? 3.4 : 2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/**
 * The per-row toggle plus its age label.
 *
 * Renders at a fixed width whether marked or not, so marking a row cannot
 * reflow the rail — a list that shifts under the cursor as you tick through it
 * is how you end up clicking the wrong sector.
 */
export function ReviewMark({
  reviewed,
  ts,
  onToggle,
  label,
  now,
}: {
  reviewed: boolean;
  /** Epoch ms of the marker, when reviewed. */
  ts?: number;
  onToggle: () => void;
  /** Name used in the tooltip/aria — e.g. "Financials". */
  label: string;
  now: number;
}) {
  const age = reviewed && ts ? shortAge(ts, now) : "";
  return (
    <span className="flex shrink-0 items-center gap-0.5" style={{ minWidth: 34 }}>
      <button
        type="button"
        onClick={(e) => {
          // Keep the click off the row's select handler — recording that you
          // reviewed something must not navigate you somewhere.
          e.stopPropagation();
          e.preventDefault();
          onToggle();
        }}
        aria-pressed={reviewed}
        aria-label={
          reviewed
            ? `Mark ${label} as not reviewed`
            : `Mark ${label} as reviewed`
        }
        title={
          reviewed
            ? `Reviewed ${age} ago — click to clear. Clears itself after ${REVIEW_WINDOW_DAYS} days.`
            : `Mark ${label} reviewed`
        }
        className="rounded p-0.5 transition-colors hover:bg-[var(--color-border)]"
        style={{
          color: reviewed ? "var(--color-delta-up, #0a0)" : "var(--color-border)",
          opacity: reviewed ? 1 : 0.9,
        }}
      >
        <CheckIcon filled={reviewed} />
      </button>
      <span
        className="text-[9px] tabular-nums leading-none muted-text"
        style={{ minWidth: 16 }}
        aria-hidden
      >
        {age}
      </span>
    </span>
  );
}

/**
 * Toolbar counter: "5 / 9 reviewed · 7d".
 *
 * This is the whole point of the feature — the question is "how many have I
 * done this week", and this answers it without the user diffing dates. Clicking
 * it clears the surface (starts a fresh pass); it's inert at zero.
 */
export function ReviewCounter({
  reviewed,
  total,
  onClear,
  noun = "reviewed",
}: {
  reviewed: number;
  total: number;
  onClear: () => void;
  noun?: string;
}) {
  const done = reviewed > 0 && reviewed >= total;
  return (
    <button
      type="button"
      onClick={reviewed > 0 ? onClear : undefined}
      disabled={reviewed === 0}
      title={
        reviewed === 0
          ? `Nothing marked reviewed in the last ${REVIEW_WINDOW_DAYS} days.`
          : `${reviewed} of ${total} marked reviewed in the last ${REVIEW_WINDOW_DAYS} days. Click to clear and start a fresh pass. Markers expire on their own after ${REVIEW_WINDOW_DAYS} days.`
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-default"
      style={{
        borderColor: done ? "var(--color-delta-up, #0a0)" : "var(--color-border)",
        color: done ? "var(--color-delta-up, #0a0)" : "var(--color-muted)",
        background: done
          ? "color-mix(in srgb, var(--color-delta-up, #0a0) 10%, transparent)"
          : undefined,
      }}
    >
      <CheckIcon filled={done} />
      <span className="tabular-nums">
        {reviewed} / {total}
      </span>
      <span className="hidden sm:inline">{noun}</span>
      <span className="opacity-60">· {REVIEW_WINDOW_DAYS}d</span>
    </button>
  );
}
