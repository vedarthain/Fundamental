/**
 * /admin/daily-brief — generate & review the admin-only Morning Brief.
 *
 * Admin-gated (same flow as the rest of /admin). Upload an epaper PDF; the
 * server extracts text, filters to the real news pages, synthesizes a brief with
 * Claude, and stores only the derived summary. The PDF itself is never kept.
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import DailyBriefClient from "./DailyBriefClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Morning Brief — admin",
  robots: { index: false, follow: false },
};

export default async function DailyBriefPage() {
  if (!(await isAdminRequest())) redirect("/");

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "2rem 1.25rem" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>Morning Brief</h1>
      <p style={{ color: "var(--color-muted)", marginBottom: "1.5rem" }}>
        Private to admin. Upload today&apos;s epaper PDF and Claude distills it into a structured
        brief — stored as summary only, never the source PDF.
      </p>
      <DailyBriefClient />
    </main>
  );
}
