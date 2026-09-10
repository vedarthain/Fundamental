/**
 * IntradayPriceBadge — the live intraday price + a small "HH:MM IST" pill showing
 * when the price pinger last refreshed it.
 *
 * The price shown here is app.screener_meta.current_price /
 * cluster_stocks_panel_cache.current_price — the value the /api/cron/intraday-equity
 * pinger overwrites ~7×/day during market hours (09:30–15:30 IST). It is the
 * FRESHEST live number available; the range/LTP figures elsewhere come from golden
 * EOD (adj_close) and only advance once a day. So intraday this badge leads them.
 *
 * The timestamp is honest, not "live": outside market hours it shows the last
 * fire (e.g. yesterday's 15:30), which the tooltip spells out. Renders nothing
 * when there's no price.
 *
 * Lifted from the stock detail page header so watchlist / scanner / portfolio all
 * render an identical badge.
 */

const IST_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function IntradayPriceBadge({
  price,
  fetchedAt,
  className,
}: {
  price: number | null;
  fetchedAt: string | null;
  className?: string;
}) {
  if (price == null) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 tabular-nums ${className ?? ""}`}>
      <span>₹{price.toLocaleString("en-IN")}</span>
      {fetchedAt && (
        <span
          className="inline-flex items-center rounded px-1.5 py-[1px] text-[10px] font-medium tabular-nums"
          style={{
            background: "color-mix(in srgb, var(--color-muted) 10%, transparent)",
            color: "var(--color-muted)",
          }}
          title="Last time the intraday price pinger updated this stock (blank/older outside 09:30–15:30 IST market hours)"
        >
          {IST_TIME.format(new Date(fetchedAt))} IST
        </span>
      )}
    </span>
  );
}
