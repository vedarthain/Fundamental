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
    <main className="mx-auto max-w-[1600px] px-4 md:px-6 py-4 md:py-6">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200/80 pb-3">
        <div>
          <h1 className="text-[20px] font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            Institutional Verdicts & Conviction Board
            <span className="text-[10px] uppercase font-mono font-bold tracking-wider px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              Admin
            </span>
          </h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            Full coverage monitoring across active stocks · Live drift tracking against audit snapshots
          </p>
        </div>
      </div>
      <VerdictQueueClient />
    </main>
  );
}
