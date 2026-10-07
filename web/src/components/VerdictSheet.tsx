"use client";

/**
 * The watchlist-side entry point to a verdict: a row chip, and the sheet it
 * opens.
 *
 * WHY A CHIP AND NOT A BUTTON ON EVERY ROW
 *
 * A "Verdict" button on all 251 watchlist rows removes a navigation step and
 * replaces it with a worse problem: nothing on the screen tells you which rows
 * are worth opening, so finding the handful that have drifted means clicking
 * all of them. The chip carries the answer instead of asking for a click —
 * bucket colour for the call, a dot when the evidence has moved or the verdict
 * has aged past the review mark, nothing at all when no verdict exists. The
 * absence IS the signal, which is why an un-verdicted row renders empty space
 * rather than a greyed-out button.
 *
 * WHY THE SHEET FETCHES INSTEAD OF RECEIVING PROPS
 *
 * The chips come down with the watchlist as a small summary per symbol. The
 * full record — every point, every evidence figure, every superseded verdict —
 * is fetched for the one symbol actually opened. Shipping all of it for 251
 * symbols on the chance one gets clicked is a payload the user pays for and
 * never reads.
 *
 * The panel itself is `VerdictPanel`, the same component the stock page's tab
 * renders. See lib/verdictTypes.ts for why there is one and not two.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { VerdictPanel, VerdictEmpty } from "@/components/VerdictPanel";
import { BUCKET_COLOR } from "@/lib/verdictTypes";
import type { VerdictChip, VerdictData } from "@/lib/verdictTypes";

/** First word of the label, which is the call itself — "HOLD — downgraded
 *  from BUY" has to fit in a table cell without losing which way it points. */
function shortLabel(verdict: string): string {
  return verdict.split(/[\s—–-]+/)[0].toUpperCase().slice(0, 10);
}

/* -------------------------------------------------------------- the chip */

export function VerdictChipButton({
  chip,
  onOpen,
}: {
  chip: VerdictChip | undefined;
  onOpen: (symbol: string) => void;
}) {
  // No verdict written. Renders nothing, on purpose: a placeholder on every
  // un-verdicted row would be 230 pieces of furniture saying the same thing,
  // and the Verdict tab already lists what is missing as a work queue.
  if (!chip) return null;

  const needsAttention = chip.movedCount > 0 || chip.stale;
  const color = BUCKET_COLOR[chip.bucket] ?? "var(--color-muted)";
  const title = [
    chip.verdict,
    `confidence: ${chip.confidence}`,
    `written ${chip.ageDays}d ago`,
    chip.movedCount > 0
      ? `${chip.movedCount} of ${chip.comparableCount} stored figures have moved`
      : chip.comparableCount > 0
        ? "stored figures unchanged"
        : "no figures can be rechecked",
    chip.unverifiableCount > 0
      ? `${chip.unverifiableCount} not computed this snapshot`
      : "",
    chip.stale ? `past the review mark` : "",
  ].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onOpen(chip.symbol);
      }}
      title={title}
      aria-label={`Verdict for ${chip.symbol}: ${title}`}
      className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10.5px] font-semibold tracking-wide transition-opacity hover:opacity-80"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {shortLabel(chip.verdict)}
      {needsAttention && (
        <span
          aria-hidden
          className="inline-block w-[5px] h-[5px] rounded-full"
          style={{
            background: chip.movedCount > 0
              ? "var(--color-delta-down)"
              : "var(--color-score-mid, #d4951a)",
          }}
        />
      )}
    </button>
  );
}

/* ------------------------------------------------------------- the sheet */

export function VerdictSheet({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ok"; data: VerdictData | null } | { kind: "error"; msg: string }
  >({ kind: "loading" });

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    fetch(`/api/admin/verdict?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 401) {
          setState({ kind: "error", msg: "This view is admin-only and the session is not." });
          return;
        }
        if (!r.ok) {
          setState({ kind: "error", msg: `The verdict request failed (${r.status}).` });
          return;
        }
        const j = (await r.json()) as { data: VerdictData | null };
        setState({ kind: "ok", data: j.data });
      })
      .catch(() => {
        // Said plainly rather than rendered as an empty panel: "the request
        // broke" and "nobody has written one" are different facts and the
        // reader has to be able to tell them apart.
        if (live) setState({ kind: "error", msg: "The verdict request did not complete." });
      });
    return () => {
      live = false;
    };
  }, [symbol]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Verdict for ${symbol}`}
    >
      <div
        className="w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        style={{ background: "var(--color-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b hairline"
          style={{ background: "var(--color-card)" }}
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-[14px] font-semibold">Verdict · {symbol}</h2>
            <a
              href={`/stock/${symbol.toLowerCase()}`}
              className="text-[11.5px] underline"
              style={{ color: "var(--color-muted)" }}
            >
              open the stock page
            </a>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-[var(--color-paper)]"
            style={{ color: "var(--color-muted)" }}
          >
            ×
          </button>
        </div>

        <div className="p-4">
          {state.kind === "loading" && (
            <div className="text-[13px] muted-text py-8 text-center">Reading the verdict…</div>
          )}
          {state.kind === "error" && (
            <div
              className="rounded-lg border-l-4 px-4 py-3 text-[13px]"
              style={{ borderLeftColor: "var(--color-delta-down)" }}
            >
              <span className="font-semibold ink-text">Could not load it.</span>{" "}
              <span className="muted-text">{state.msg}</span>
            </div>
          )}
          {state.kind === "ok" &&
            (state.data ? (
              <VerdictPanel symbol={symbol} data={state.data} />
            ) : (
              <VerdictEmpty symbol={symbol} />
            ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------------------------------------- the hook */

/**
 * Fetch chips for a list of symbols, once, after the rows are on screen.
 *
 * Separate from the watchlist's own fetch so a failure here cannot take the
 * watchlist with it: the chips are an admin overlay on a page that must keep
 * working for everyone else. A 401 is the normal response for most sessions
 * and is not an error — it resolves to an empty map and no chips render.
 */
export function useVerdictChips(symbols: string[], enabled: boolean) {
  const [chips, setChips] = useState<Map<string, VerdictChip>>(new Map());
  const key = enabled ? symbols.join(",") : "";

  useEffect(() => {
    if (!key) {
      setChips(new Map());
      return;
    }
    let live = true;
    fetch(`/api/admin/verdict?chips=${encodeURIComponent(key)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { chips: [] }))
      .then((j: { chips: VerdictChip[] }) => {
        if (!live) return;
        setChips(new Map((j.chips ?? []).map((c) => [c.symbol, c])));
      })
      .catch(() => {
        if (live) setChips(new Map());
      });
    return () => {
      live = false;
    };
  }, [key]);

  return chips;
}
