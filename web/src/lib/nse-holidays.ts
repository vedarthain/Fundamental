/**
 * NSE trading holidays.
 *
 * Update once a year against NSE's official trading-holiday list at
 *   https://www.nseindia.com/resources/exchange-communication-holidays
 * (the "Trading Holidays" PDF — published in late December for the
 * upcoming calendar year).  Saturdays/Sundays are excluded from this
 * list because markets are weekend-closed by default.
 *
 * Calendar derivation:
 *   - Fixed-date holidays (Republic Day, Maharashtra Day, Independence
 *     Day, Gandhi Jayanti, Christmas) are stable across years.
 *   - Lunar / Hindu-calendar holidays (Holi, Diwali, Eid, Janmashtami,
 *     etc.) shift annually — DO NOT copy these forward when bumping the
 *     year; re-derive from the official NSE PDF or a verified almanac.
 *
 * If the page shows a "Bakri Eid was last Tuesday" sort of mismatch,
 * fix this file first and redeploy.
 */

export type NseHoliday = {
  date: string;     // ISO YYYY-MM-DD
  name: string;
};

/**
 * NSE 2026 trading holidays.
 *
 * Confidence levels:
 *   ✓ verified  — fixed-date national holiday, stable
 *   ~ best-effort — lunar/movable; cross-check against NSE PDF before
 *                   relying on this for anything ops-critical
 */
export const NSE_HOLIDAYS_2026: NseHoliday[] = [
  { date: "2026-01-26", name: "Republic Day" },                       // ✓ Mon
  { date: "2026-02-17", name: "Mahashivratri" },                      // ~ Tue
  { date: "2026-03-05", name: "Holi" },                               // ~ Thu (Dhulandi/Rangwali)
  { date: "2026-03-21", name: "Eid-Ul-Fitr (Ramzan ID)" },            // ~ Sat (weekend — but listed for visibility)
  { date: "2026-03-26", name: "Ram Navami" },                         // ~ Thu
  { date: "2026-03-31", name: "Shri Mahavir Jayanti" },               // ~ Tue
  { date: "2026-04-03", name: "Good Friday" },                        // ~ Fri (calculated Easter)
  { date: "2026-04-14", name: "Dr Baba Saheb Ambedkar Jayanti" },     // ✓ Tue
  { date: "2026-05-01", name: "Maharashtra Day" },                    // ✓ Fri
  { date: "2026-05-28", name: "Bakri Eid (Eid-ul-Adha)" },            // ~ Thu
  { date: "2026-08-15", name: "Independence Day" },                   // ✓ Sat (weekend — listed for completeness)
  { date: "2026-09-04", name: "Janmashtami" },                        // ~ Fri
  { date: "2026-09-14", name: "Ganesh Chaturthi" },                   // ~ Mon
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti" },             // ✓ Fri
  { date: "2026-10-20", name: "Dussehra" },                           // ~ Tue
  { date: "2026-11-09", name: "Diwali Balipratipada" },               // ~ Mon (Diwali Nov 8 Sun; next trading day off)
  { date: "2026-11-24", name: "Guru Nanak Jayanti" },                 // ~ Tue
  { date: "2026-12-25", name: "Christmas" },                          // ✓ Fri
];

/** Return the next N upcoming holidays on/after `from`. Used by /market. */
export function upcomingHolidays(from: Date, limit = 5): NseHoliday[] {
  const fromIso = from.toISOString().slice(0, 10);
  return NSE_HOLIDAYS_2026.filter((h) => h.date >= fromIso).slice(0, limit);
}
