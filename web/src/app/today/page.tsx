/**
 * /today — redirect to /today/<today's date>.
 *
 * Permalink convention: every insight lives at /today/YYYY-MM-DD so a
 * Twitter share remains accurate forever ("here's today's signal" → click
 * tomorrow → still see what you shared). The bare /today URL is just a
 * convenient shortcut to the current day.
 *
 * Date is calculated server-side in IST (Indian markets / users), not UTC,
 * because crossing midnight UTC in the morning would otherwise show
 * "yesterday's" insight to morning visitors.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function istToday(): string {
  // IST = UTC+5:30. Build a date that's correct in IST regardless of where
  // Vercel is running the function.
  const nowUtc = new Date();
  const istMs = nowUtc.getTime() + (5 * 60 + 30) * 60_000;
  return new Date(istMs).toISOString().slice(0, 10);
}

export default function TodayRedirect() {
  redirect(`/today/${istToday()}`);
}
