/**
 * NSE market-hours helper for the intraday cron routes.
 *
 * Neon bills compute-hours = time the DB is AWAKE, and each pinger fire wakes
 * it (then it stays up for the 5-min autosuspend delay). So a pinger that
 * fires outside trading hours — e.g. cron-job.org over-firing past close or on
 * weekends — keeps paying compute for nothing. The cron routes call
 * withinPingerWindow() FIRST and no-op before any DB access when the market is
 * closed, so off-hours fires cost zero DB wake-ups regardless of the external
 * schedule.
 *
 * Window: Mon–Fri, 09:15–15:40 IST. 15:40 keeps the ~3:40 PM last fire (which
 * captures the 15:30 close + closing-auction settle) inside the window.
 *
 * Holiday caveat: a trading holiday that falls on a weekday still passes the
 * window check — a cosmetic edge that costs a few harmless ticks (prices just
 * won't move). Excluding holidays would need an NSE calendar; not worth it for
 * a cost guard.
 */

const OPEN_MIN = 9 * 60 + 15;   // 09:15 IST
const LAST_FIRE_MIN = 15 * 60 + 40; // 15:40 IST — last intraday pinger fire
const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

/** Current IST weekday + minutes-since-midnight, via Intl (no TZ libs). */
function istNow(d: Date = new Date()): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short", hour: "numeric", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  // hour12:false can emit "24" at midnight in some engines — normalise.
  const hour = Number(p.hour) % 24;
  return { weekday: p.weekday, minutes: hour * 60 + Number(p.minute) };
}

/** True during the intraday pinger window: Mon–Fri, 09:15–15:40 IST. */
export function withinPingerWindow(d: Date = new Date()): boolean {
  const { weekday, minutes } = istNow(d);
  return WEEKDAYS.has(weekday) && minutes >= OPEN_MIN && minutes <= LAST_FIRE_MIN;
}
