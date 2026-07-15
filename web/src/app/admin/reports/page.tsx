/**
 * /admin/reports — on-demand data exports.
 *
 * Admin-gated (same flow as the rest of /admin). Each report generates live from
 * Neon when the button is clicked and downloads as a file — no local step.
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reports — admin",
  robots: { index: false, follow: false },
};

export default async function ReportsPage() {
  if (!(await isAdminRequest())) redirect("/");

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1.25rem" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>Reports</h1>
      <p style={{ color: "var(--color-muted)", marginBottom: "1.5rem" }}>
        Generated live from Neon on click. Downloads immediately — nothing runs on your machine.
      </p>

      <section
        style={{
          border: "1px solid var(--color-border, #e2e5ec)",
          borderRadius: 12,
          padding: "1.25rem 1.25rem",
        }}
      >
        <h2 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "0.35rem" }}>
          NIFTY 500 Scorecard (.xlsx)
        </h2>
        <p style={{ color: "var(--color-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          All 500 constituents with peer rank, Q/V/M/Composite, market cap, price and
          1D / 1W / 1M / 1Y returns, plus a Sector › Industry › Category pivot. Every
          column matches equityroots.in (latest scoring snapshot); the 1D figure is the
          live golden close. Q/V/M and the weekly returns only move when a new snapshot
          lands, so re-running the same day yields the same fundamentals.
        </p>
        <a
          href="/api/admin/reports/nifty500"
          style={{
            display: "inline-block",
            background: "#1E2761",
            color: "#fff",
            padding: "0.55rem 1.1rem",
            borderRadius: 8,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Generate &amp; download
        </a>
      </section>
    </main>
  );
}
