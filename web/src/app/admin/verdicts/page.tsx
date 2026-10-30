/**
 * /admin/verdicts — Verdict Management.
 *
 * Admin-gated (same flow as the rest of /admin).
 * Full universe coverage (3,174 stocks) grouped by conviction actions (BUY,
 * ACCUMULATE, HOLD, WATCH, AVOID), with price performance tracking from
 * anchor date to latest close, thesis, and live drift alerts.
 *
 * Used to switch between two views of the same queue — a dense "Board" grid
 * and this card-reading "Detail" tree — via VerdictTabs. The Board
 * (VerdictQueueClient) was decommissioned: Detail covers the same queue plus
 * per-symbol chart/verdict/news, so the tab switch and its header bar were
 * dead weight. Detail now mounts directly.
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import { VerdictDetailClient } from "./VerdictDetailClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Verdicts — Admin",
  robots: { index: false, follow: false },
};

export default async function AdminVerdictsPage() {
  if (!(await isAdminRequest())) redirect("/");

  return (
    // `zoom` (not `transform: scale`) so the bump actually reflows — most of
    // this page's text sizes are `text-[Npx]` arbitrary values, which are
    // absolute and ignore a parent font-size/em change. zoom scales those too
    // and is supported by every evergreen browser (Firefox since v126).
    <main
      className="mx-auto max-w-[1600px] px-3 sm:px-4 py-2 sm:py-3"
      style={{ zoom: 1.06 }}
    >
      <VerdictDetailClient />
    </main>
  );
}
