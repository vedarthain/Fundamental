import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import { loadReportData } from "@/lib/reportData";
import { ReportExtractorClient } from "./ReportExtractorClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Report Extraction Desk — Admin · EquityRoots",
  robots: { index: false, follow: false },
};

export default async function ReportsPage() {
  if (!(await isAdminRequest())) redirect("/");

  const initialRows = await loadReportData().catch((err) => {
    console.error("Error loading initial report data:", err);
    return [];
  });

  return (
    <main className="w-full max-w-[1720px] mx-auto px-2.5 sm:px-4 py-3 sm:py-4">
      <ReportExtractorClient initialData={initialRows} />
    </main>
  );
}
