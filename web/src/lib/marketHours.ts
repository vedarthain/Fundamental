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
 * Cadence: TWO pulls per hour, at :15 and :45, Mon–Fri, 09:15–15:45 IST —
 * 14 pulls/day. We gate to the :15–:24 and :45–:54 minute bands rather than
 * the whole trading day, so the DB wakes ~14×/day instead of ~26×.
 *
 * This is enforced in code, NOT in the external pinger: cron-job.org fires
 * every 15 minutes aligned to :00, and the two bands accept exactly the :15
 * and :45 fires while the :00 and :30 fires no-op here before touching Neon,
 * costing nothing. The bands are 10 minutes wide to absorb pinger jitter and
 * still narrower than the 15-minute gap, so no band can ever take two fires.
 *
 * WHY :15 AND :45 AND NOT :00 AND :30
 *
 * The first slot is the point of the choice. NSE opens at 09:15, and the
 * previous cadence took its first pull at 09:30 — so for the first fifteen
 * minutes of every session every page on the site showed yesterday's close
 * while the market was visibly moving. A :15-aligned band puts the first
 * refresh at the open instead of a quarter-hour into it.
 *
 * The 15:45 slot is after the 15:30 close and is deliberate: it is the first
 * pull that can see the settled closing price, and it lands nearly three
 * hours before the bhavcopy job (18:30 IST) makes that close authoritative.
 * Before it existed the closing price on screen was whatever the 15:30 pull
 * caught mid-auction.
 *
 * Changing the cadence here is the ONLY lever — the external pinger already
 * fires every 15 min and has done throughout. Widening a band or moving
 * FIRST_HOUR/LAST_HOUR changes Neon compute-hours and nothing else; each
 * extra slot is one more 5-minute wake per trading day (~1.8 compute-hours
 * per month per slot).
 *
 * Holiday caveat: a trading holiday that falls on a weekday still passes the
 * window check — a cosmetic edge that costs a few harmless ticks (prices just
 * won't move). Excluding holidays would need an NSE calendar; not worth it for
 * a cost guard.
 */

const FIRST_HOUR = 9;    // first pull at 09:15 IST, the open
const LAST_HOUR = 15;    // last pull at 15:45 IST → 7 hours × 2 slots = 14
// Two accepted bands per hour. Each is 10 min wide: enough for pinger jitter,
// comfortably less than the 15-min fire interval, so one fire per band.
const SLOTS: ReadonlyArray<readonly [number, number]> = [[15, 24], [45, 54]];
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

/** True only in a :15 or :45 slot on a weekday, 09:15–15:45 IST. Every other
 *  pinger fire no-ops before any DB access, so Neon wakes ~14×/day. */
export function withinPingerWindow(d: Date = new Date()): boolean {
  const { weekday, minutes } = istNow(d);
  if (!WEEKDAYS.has(weekday)) return false;
  const hour = Math.floor(minutes / 60);
  if (hour < FIRST_HOUR || hour > LAST_HOUR) return false;
  const minOfHour = minutes % 60;
  return SLOTS.some(([lo, hi]) => minOfHour >= lo && minOfHour <= hi);
}
