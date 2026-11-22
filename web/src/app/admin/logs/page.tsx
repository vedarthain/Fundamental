/**
 * /admin/logs — Server Cron & Pipeline Execution Logs.
 *
 * Admin-gated view to inspect live outputs from native Droplet cron jobs:
 * 1. Nightly Verdict Drift Catch-Up (11:00 PM IST)
 * 2. Sunday Calls & Portfolio Audit (2:00 PM IST)
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import { LogsViewerClient } from "./LogsViewerClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Server Cron Logs — Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLogsPage() {
  if (!(await isAdminRequest())) redirect("/");

  return (
    <main className="mx-auto max-w-[1600px] px-3 sm:px-4 py-2 sm:py-3">
      <PageHeader
        eyebrow="Admin · Pipeline Monitoring"
        title="Server Cron Execution Logs"
        subtitle="Monitor live execution outputs for Nightly Verdict Drift (11:00 PM IST) and Sunday Calls (2:00 PM IST)."
      />
      <LogsViewerClient />
    </main>
  );
}
