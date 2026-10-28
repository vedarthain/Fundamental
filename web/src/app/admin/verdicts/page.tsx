/**
 * /admin/verdicts — Institutional Conviction Board & Verdict Management.
 *
 * Admin-gated (same flow as the rest of /admin).
 * Provides full universe coverage (3,174 stocks) grouped by conviction
 * actions (BUY, ACCUMULATE, HOLD, WATCH, AVOID), with price performance
 * tracking from anchor date to latest close, thesis, and live drift alerts.
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import { VerdictQueueClient } from "./VerdictQueueClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Verdicts — Admin",
  robots: { index: false, follow: false },
};

export default async function AdminVerdictsPage() {
  if (!(await isAdminRequest())) redirect("/");

  return (
    <main className="mx-auto max-w-[1600px] px-3 sm:px-4 py-2 sm:py-3">
      <div className="mb-2 flex items-center justify-between border-b border-slate-200/80 pb-1.5">
        <h1 className="text-[14px] font-semibold text-slate-800 tracking-tight">
          Verdict - Admin
        </h1>
      </div>
      <VerdictQueueClient />
    </main>
  );
}
