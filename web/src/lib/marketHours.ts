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
 * Cadence: ONE pull per hour at :30, Mon–Fri, 09:30–15:30 IST — 7 pulls/day
 * (09:30, 10:30, …, 15:30). We gate to the :30–:39 minute band rather than the
 * whole trading day, so the DB wakes ~7×/day instead of ~26×. This is enforced
 * in code, NOT in the external pinger: cron-job.org can keep firing every 15
 * min (its usual over-firing) and every fire outside the :30 band no-ops here
 * before touching Neon, costing nothing. Any pinger aligned to :00 (15- or
 * 30-min interval) lands exactly one fire in the band each hour.
 *
 * Holiday caveat: a trading holiday that falls on a weekday still passes the
 * window check — a cosmetic edge that costs a few harmless ticks (prices just
 * won't move). Excluding holidays would need an NSE calendar; not worth it for
 * a cost guard.
 */

const FIRST_HOUR = 9;    // first pull at 09:30 IST
const LAST_HOUR = 15;    // last pull at 15:30 IST → 7 hourly slots
const SLOT_MIN = 30;     // pull at :30 past the hour
const SLOT_MAX = 39;     // accept :30–:39 to absorb pinger jitter (narrower than
                         // any 15-min interval, so only ONE fire/hour lands here)
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

/** True only in an hourly :30 slot on a weekday, 09:30–15:30 IST. Every other
 *  pinger fire no-ops before any DB access, so Neon wakes ~7×/day. */
export function withinPingerWindow(d: Date = new Date()): boolean {
  const { weekday, minutes } = istNow(d);
  if (!WEEKDAYS.has(weekday)) return false;
  const hour = Math.floor(minutes / 60);
  const minOfHour = minutes % 60;
  return hour >= FIRST_HOUR && hour <= LAST_HOUR && minOfHour >= SLOT_MIN && minOfHour <= SLOT_MAX;
}
