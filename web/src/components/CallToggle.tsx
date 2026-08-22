"use client";

/**
 * CallToggle — a segmented Buy/Sell "call" control that sits next to a stock's
 * composite score (scanner grid + expanded chart, stock homepage). Two segments:
 *
 *   [ B | S ]   both greyed  → no call
 *               B lit green  → Buy call
 *               S lit red    → Sell call
 *
 * Tap B for Buy, S for Sell; tap the lit segment again to clear. State is shared
 * app-wide via useCalls(), so a change on one card reflects everywhere. Signed-
 * out users see the greyed control; tapping then is a no-op (server-backed).
 */
import { useCalls, type CallSide } from "@/lib/stockCalls";

const BUY = "#0a8f2f";
const SELL = "#c0392b";

export function CallToggle({
  symbol,
  size = "md",
}: {
  symbol: string;
  size?: "sm" | "md";
}) {
  const { sideOf, setSide, signedIn } = useCalls();
  const side = sideOf(symbol);

  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[12px]";

  const seg = (s: CallSide, activeColor: string) => {
    const active = side === s;
    const title = signedIn
      ? active
        ? `Clear ${s === "B" ? "Buy" : "Sell"} call`
        : `Mark ${s === "B" ? "Buy" : "Sell"}`
      : "Sign in to make Buy/Sell calls";
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setSide(symbol, s);
        }}
        disabled={!signedIn}
        aria-pressed={active}
        aria-label={title}
        title={title}
        className={`font-bold leading-none transition-colors ${pad} ${
          signedIn ? "cursor-pointer" : "cursor-default"
        } ${active ? "text-white" : "hover:bg-[var(--color-paper)]"}`}
        style={{
          background: active ? activeColor : "transparent",
          color: active ? "#fff" : "var(--color-muted)",
        }}
      >
        {s}
      </button>
    );
  };

  return (
    <div
      className={`inline-flex items-center overflow-hidden rounded border hairline ${
        signedIn ? "" : "opacity-70"
      }`}
      role="group"
      aria-label="Buy or Sell call"
    >
      {seg("B", BUY)}
      <span className="self-stretch w-px bg-[var(--color-border-default)]" aria-hidden />
      {seg("S", SELL)}
    </div>
  );
}
