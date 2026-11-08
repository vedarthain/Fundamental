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

export function formatFetchedAt(iso: string): string {
  try {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return iso;

    // Get time and day in Asia/Kolkata
    const istStr = dt.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istStr);

    const dayOfWeek = istDate.getDay(); // 0 = Sun, 6 = Sat
    const hour = istDate.getHours();
    const minute = istDate.getMinutes();
    const totalMinutes = hour * 60 + minute;

    // Market session is Mon-Fri 09:15 to 15:30 IST (555 to 930 mins)
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isAfterClose = totalMinutes > 930; // after 15:30 IST
    const isBeforeOpen = totalMinutes < 555; // before 09:15 IST

    // If fetched outside market trading hours (e.g. weekend or night batch),
    // anchor the display to the actual settled trading session's close (15:30 IST)
    if (isWeekend || isAfterClose || isBeforeOpen) {
      const sessionDate = new Date(istDate);
      if (dayOfWeek === 6) {
        // Saturday -> Friday close
        sessionDate.setDate(sessionDate.getDate() - 1);
      } else if (dayOfWeek === 0) {
        // Sunday -> Friday close
        sessionDate.setDate(sessionDate.getDate() - 2);
      } else if (isBeforeOpen) {
        // Weekday morning before open -> previous trading day's close
        sessionDate.setDate(sessionDate.getDate() - (dayOfWeek === 1 ? 3 : 1));
      }
      const dateStr = sessionDate.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });
      return `${dateStr} 15:30 IST`;
    }

    // Active market hours (09:15 - 15:30 IST)
    const now = new Date();
    const isToday =
      dt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) ===
      now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

    const timeStr = dt.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    if (isToday) {
      return `Today ${timeStr} IST`;
    }
    const dateStr = dt.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
    });
    return `${dateStr} ${timeStr} IST`;
  } catch {
    return iso;
  }
}

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
          title={`Last price update: ${new Date(fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`}
        >
          {formatFetchedAt(fetchedAt)}
        </span>
      )}
    </span>
  );
}
