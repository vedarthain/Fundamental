"use client";

/**
 * ManualTradeSheet — the quick-add trade experience, shared between the
 * portfolio page and a global (session-gated) floating button.
 *
 * Exports:
 *   - ManualTradePanel : the entry form + recent-trades list (no chrome).
 *   - TradeSheet        : bottom-sheet (mobile) / centered modal (desktop)
 *                         wrapping ManualTradePanel.
 *   - QuickAddTradeFab  : a persistent floating "+" mounted globally in the
 *                         root layout; only renders for signed-in users, and
 *                         hides itself on auth pages. Tapping opens TradeSheet.
 *
 * Previously the form lived inside PortfolioClient and was only reachable by
 * navigating to /portfolio. Extracting it here lets any page log a trade.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/session-client";

const GREEN = "var(--color-delta-up, #15803D)";
const RED = "var(--color-delta-down, #DC2626)";

function inr(v: number | null, dp = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

type IconProps = { className?: string; size?: number };
function svg(size: number | undefined, className: string | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size ?? 16}
      height={size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}
const IconEdit = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>);
const IconClose = ({ className, size }: IconProps) =>
  svg(size, className, <><path d="M18 6 6 18M6 6l12 12" /></>);

type ManualTrade = {
  id: string;
  symbol: string;
  name: string | null;
  broker: string;
  brokerLabel: string;
  side: string;
  date: string;
  quantity: number;
  price: number;
};
type SearchHit = { symbol: string; company_name: string };

// Brokers a manual trade can be tagged with (metadata — the trade is still a
// hand entry). Mirrors MANUAL_BROKERS in the manual-trade route.
const MANUAL_BROKERS = [
  { value: "zerodha", label: "Zerodha" },
  { value: "upstox", label: "Upstox" },
  { value: "fyers", label: "Fyers" },
  { value: "fivepaisa", label: "5paisa" },
  { value: "groww", label: "Groww" },
  { value: "other", label: "Other" },
] as const;

// ── Global floating "+" ─────────────────────────────────────────────────────

// Auth / entry pages where a floating trade button would be noise.
const HIDE_ON = ["/login", "/signup", "/register", "/forgot-password", "/reset-password"];

// Mobile-only floating "+": a persistent, thumb-reachable trigger on every
// page. On desktop the trigger lives inline in the top nav (QuickAddTradeButton,
// the "T" next to the scribble pad), so this FAB is md:hidden.
export function QuickAddTradeFab() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { user, loading } = useSession();
  const [open, setOpen] = useState(false);

  const signedIn = !loading && user !== null;
  const hidden = HIDE_ON.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!signedIn || hidden) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add a manual trade"
        className="md:hidden fixed z-40 bottom-5 right-5 h-14 w-14 rounded-full shadow-lg flex items-center justify-center transition-transform active:scale-95 text-[22px] font-semibold"
        style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
      >
        <span aria-hidden className="leading-none">T</span>
      </button>
      {open && <TradeSheet onClose={() => setOpen(false)} onChanged={() => router.refresh()} />}
    </>
  );
}

// Desktop inline trigger: a round "T" (for Trade) that sits next to the
// scribble-pad "✎" in the top nav. Mirrors that button's shape so the two read
// as a pair. Session-gating is handled by the caller (rendered only when
// signed in), matching how ScribblePad is placed.
export function QuickAddTradeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add a manual trade"
        title="Add a manual trade"
        className="inline-flex items-center justify-center w-8 h-8 rounded-full border transition-colors hover:bg-[var(--color-paper)] text-[13px] font-semibold"
      >
        <span aria-hidden className="leading-none">T</span>
      </button>
      {open && <TradeSheet onClose={() => setOpen(false)} onChanged={() => router.refresh()} />}
    </>
  );
}

// ── Bottom sheet / modal ────────────────────────────────────────────────────

// Quick-add overlay: a bottom sheet on mobile (slides up, thumb-reachable),
// a centered modal on desktop. Wraps the full ManualTradePanel form so the FAB
// and the Transactions-tab button share one code path. Closes on backdrop
// click, the × button, or Escape.
export function TradeSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // lock scroll behind the sheet
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  // Render through a portal to <body>. The desktop "T" trigger lives inside the
  // sticky site header, which sets `backdrop-blur` — a `backdrop-filter` makes
  // that header the containing block for any `position: fixed` descendant, so
  // without the portal this overlay would be trapped inside the header strip
  // instead of covering the viewport.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      // Close on any click that lands on the backdrop itself. The target guard
      // means a click that bubbled up from inside the card (or the tail of a
      // text-selection drag) won't dismiss the sheet.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add a manual trade"
    >
      <div
        className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        style={{ background: "var(--color-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b hairline"
          style={{ background: "var(--color-card)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-md"
              style={{ background: "color-mix(in srgb, var(--color-accent-600) 12%, transparent)", color: "var(--color-accent-700)" }}
            >
              <IconEdit size={15} />
            </span>
            <h2 className="text-[14px] font-semibold">Add a manual trade</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-[var(--color-paper)]"
            style={{ color: "var(--color-muted)" }}
          >
            <IconClose size={18} />
          </button>
        </div>
        <ManualTradePanel onChanged={onChanged} />
      </div>
    </div>,
    document.body,
  );
}

// ── Entry form + recent-trades list ─────────────────────────────────────────

export function ManualTradePanel({ onChanged }: { onChanged: () => void }) {
  const [trades, setTrades] = useState<ManualTrade[]>([]);
  const [symbol, setSymbol] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [brokerSel, setBrokerSel] = useState<string>("zerodha");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ err?: string; ok?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/portfolio/manual-trade", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setTrades(d.trades ?? []);
      }
    } catch {
      /* ignore — panel is non-critical */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Debounced symbol autocomplete against the shared /api/search endpoint.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (r.ok) {
          const d = await r.json();
          setHits(d.hits ?? []);
        }
      } catch {
        /* aborted / offline */
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  function pick(h: SearchHit) {
    setSymbol(h.symbol);
    setQuery(h.symbol);
    setShowHits(false);
  }

  async function submit() {
    setMsg(null);
    if (!symbol) return setMsg({ err: "Pick a stock from the suggestions first." });
    const q = Number(qty);
    const p = Number(price);
    if (!(q > 0)) return setMsg({ err: "Quantity must be greater than 0." });
    if (!(p >= 0)) return setMsg({ err: "Price must be zero or more." });
    setBusy(true);
    try {
      const r = await fetch("/api/portfolio/manual-trade", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, side, broker: brokerSel, date, quantity: q, price: p }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ err: d.error ?? `Failed (HTTP ${r.status})` });
      } else {
        setMsg({ ok: `${side === "buy" ? "Bought" : "Sold"} ${q} ${symbol} @ ₹${p.toLocaleString("en-IN")}.` });
        setSymbol("");
        setQuery("");
        setQty("");
        setPrice("");
        await load();
        onChanged();
      }
    } catch {
      setMsg({ err: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      const r = await fetch(`/api/portfolio/manual-trade?id=${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok) {
        await load();
        onChanged();
      }
    } catch {
      /* ignore */
    }
  }

  const inputCls =
    "rounded-md border px-3 py-2 text-[13px] bg-[var(--color-card)] w-full";
  const inputStyle = { borderColor: "var(--color-border-default)" };

  return (
    <div className="p-4 md:p-5">
      <p className="muted-text text-[11.5px] mb-3 leading-snug">
        Log a buy or sell between broker imports — it updates your holdings, not just the chart.
        A real <strong>holdings snapshot</strong> for the same stock always wins for the current
        quantity; until then the position is computed from your trades.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        {/* symbol autocomplete */}
        <div className="relative min-w-[190px] flex-1">
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Stock
          </label>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSymbol("");
              setShowHits(true);
            }}
            onFocus={() => setShowHits(true)}
            onBlur={() => setTimeout(() => setShowHits(false), 150)}
            placeholder="Search symbol or name…"
            className={inputCls}
            style={inputStyle}
          />
          {showHits && hits.length > 0 && (
            <ul
              className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border shadow-lg text-[12.5px]"
              style={{ borderColor: "var(--color-border-default)", background: "var(--color-card)" }}
            >
              {hits.map((h) => (
                <li key={h.symbol}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(h)}
                    className="block w-full text-left px-3 py-1.5 hover:bg-[var(--color-paper)]"
                  >
                    <span className="font-medium">{h.symbol}</span>
                    <span className="muted-text"> — {h.company_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* broker */}
        <div>
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Broker
          </label>
          <select
            value={brokerSel}
            onChange={(e) => setBrokerSel(e.target.value)}
            className="rounded-md border px-3 py-2 text-[13px] bg-[var(--color-card)]"
            style={inputStyle}
          >
            {MANUAL_BROKERS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>

        {/* side toggle */}
        <div>
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Side
          </label>
          <div className="inline-flex rounded-md border overflow-hidden" style={inputStyle}>
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className="px-3 py-2 text-[12.5px] font-medium capitalize transition-colors"
                style={
                  side === s
                    ? { background: s === "buy" ? GREEN : RED, color: "white" }
                    : { background: "transparent", color: "var(--color-muted)" }
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="w-[140px]">
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
        </div>

        <div className="w-[100px]">
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Qty
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={`${inputCls} text-right`}
            style={inputStyle}
          />
        </div>

        <div className="w-[120px]">
          <label className="block text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Price ₹
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={`${inputCls} text-right`}
            style={inputStyle}
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded-md font-medium text-[13px] transition-colors disabled:opacity-60"
          style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
        >
          {busy ? "Saving…" : "Add trade"}
        </button>
      </div>

      {msg && (
        <div
          className="mt-3 rounded-md px-3 py-2 text-[12.5px]"
          style={{
            background: msg.err
              ? "color-mix(in srgb, var(--color-delta-down, #DC2626) 10%, transparent)"
              : "color-mix(in srgb, var(--color-delta-up, #15803D) 12%, transparent)",
          }}
        >
          <span style={{ color: msg.err ? RED : GREEN }}>{msg.err ?? msg.ok}</span>
        </div>
      )}

      {trades.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-semibold muted-text uppercase tracking-wide mb-1">
            Manual trades ({trades.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <tbody>
                {trades.map((tr) => (
                  <tr key={tr.id} className="border-b hairline">
                    <td className="py-1.5 pr-3">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase"
                        style={{
                          color: "white",
                          background: tr.side === "buy" ? GREEN : RED,
                        }}
                      >
                        {tr.side}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-medium">{tr.symbol}</td>
                    <td className="py-1.5 pr-3">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10.5px] font-medium whitespace-nowrap"
                        style={{ background: "var(--color-paper)", color: "var(--color-muted)" }}
                      >
                        {tr.brokerLabel}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 muted-text truncate max-w-[200px] hidden sm:table-cell">
                      {tr.name}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{tr.quantity}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">@ {inr(tr.price, 2)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums muted-text">{tr.date}</td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => remove(tr.id)}
                        className="text-[11px] px-2 py-1 rounded hover:bg-[var(--color-paper)]"
                        style={{ color: RED }}
                        aria-label={`Delete ${tr.side} ${tr.symbol}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
