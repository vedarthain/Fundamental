/**
 * Zone 4 — open Buy/Sell calls and how they have moved since the anchor.
 *
 * Active calls only; cleared ones are history and live on the stock page. The
 * move is raw anchor → latest close, so a Sell call showing a positive number
 * is a call going against you — the side chip is what makes the sign readable,
 * and it must not be dropped from this table.
 */
import { loadCalls } from "@/lib/calls";
import { Zone, MiniTable, Delta, Empty, SymbolLink, fmtDay, num } from "./ui";

const CALL_N = 12;

export async function CallsZone({ userId }: { userId: number }) {
  const all = await loadCalls(userId).catch(() => []);
  const active = all.filter((c) => c.cleared_at == null);
  const shown = active.slice(0, CALL_N);
  const oldest = shown.length > 0 ? shown[shown.length - 1].anchor_date : null;

  return (
    <Zone
      title="Open calls"
      count={active.length || undefined}
      meta={oldest ? `from ${fmtDay(oldest)}` : undefined}
    >
      {shown.length === 0 ? (
        <Empty>
          No open calls. Tag a stock Buy or Sell from its page or the scanner and
          it gets a server-side price anchor to score against.
        </Empty>
      ) : (
        /* The anchor date used to sit on a second line under the anchor price;
           it doubled every row's height for a date nobody acts on, so it moved
           to the header as the oldest open call. */
        <MiniTable
          headers={["Name", "Anchor", "LTP", "Move"]}
          rows={shown.map((c) => [
            <span key={c.symbol} className="flex items-baseline gap-1 min-w-0">
              <SideChip side={c.side} />
              <SymbolLink symbol={c.symbol} />
            </span>,
            <span key={`${c.symbol}-a`} className="muted-text">
              {num(c.anchor_price)}
            </span>,
            num(c.ltp),
            <Delta key={`${c.symbol}-m`} v={c.pct_move} />,
          ])}
        />
      )}
    </Zone>
  );
}

function SideChip({ side }: { side: "B" | "S" }) {
  const buy = side === "B";
  return (
    <span
      className="shrink-0 rounded px-1 text-[10px] font-semibold"
      style={{
        backgroundColor: buy ? "var(--color-delta-up)" : "var(--color-delta-down)",
        color: "white",
      }}
    >
      {buy ? "B" : "S"}
    </span>
  );
}
