/**
 * NSE / BSE trading holidays.
 *
 * Source: NSE's published calendar. Hardcoded here rather than scraping a
 * URL every day — the calendar is announced once a year and stable, and
 * a five-line list of dates is cheaper to maintain than a network
 * dependency. Update at the start of each calendar year.
 *
 * Each entry: { date: "YYYY-MM-DD", name }. Sorted by date.
 * `name` follows the NSE official wording where possible.
 */

export type NseHoliday = {
  date: string;     // ISO YYYY-MM-DD
  name: string;
};

export const NSE_HOLIDAYS_2026: NseHoliday[] = [
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-03-04", name: "Mahashivratri" },
  { date: "2026-03-17", name: "Holi" },
  { date: "2026-03-21", name: "Eid-Ul-Fitr (Ramzan ID)" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-14", name: "Dr Baba Saheb Ambedkar Jayanti" },
  { date: "2026-04-21", name: "Shri Mahavir Jayanti" },
  { date: "2026-05-01", name: "Maharashtra Day" },
  { date: "2026-05-27", name: "Bakri Eid" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-09-25", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti" },
  { date: "2026-10-21", name: "Diwali Laxmi Pujan" },
  { date: "2026-10-22", name: "Diwali Balipratipada" },
  { date: "2026-11-04", name: "Guru Nanak Jayanti" },
  { date: "2026-12-25", name: "Christmas" },
];

/** Return the next N upcoming holidays on/after `from`. Used by /market. */
export function upcomingHolidays(from: Date, limit = 5): NseHoliday[] {
  const fromIso = from.toISOString().slice(0, 10);
  return NSE_HOLIDAYS_2026.filter((h) => h.date >= fromIso).slice(0, limit);
}
