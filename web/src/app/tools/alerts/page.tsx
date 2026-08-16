/**
 * /tools/alerts — ring-1 portfolio alerts (holdings discipline).
 *
 * Auth-gated like /portfolio. Renders active cards on top with dismissed greyed
 * below. We do NOT evaluate on load — a full re-eval hits the portfolio + golden
 * serially and added ~10s to first paint. Freshness comes from the daily cron
 * (/api/cron/evaluate-alerts) plus the on-demand "Check now" button. The heavy
 * lifting lives in lib/alerts.ts; this page is thin glue.
 */
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { loadAlerts } from "@/lib/alerts";
import { AlertsClient } from "./AlertsClient";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const session = await getSession();

  if (!session) {
    return (
      <div className="mx-auto max-w-[520px] px-4 md:px-6 py-10 md:py-16">
        <div className="card p-8 md:p-10 text-center">
          <h1 className="font-display text-[24px] md:text-[26px] leading-[1.1] tracking-tight mb-3">
            Sign in to see your alerts
          </h1>
          <p className="muted-text text-[13.5px] max-w-md mx-auto mb-6">
            Alerts watch the stocks you hold and flag the few that need a look
            today — profit target reached, a sharp down day, or a deep drawdown
            from your cost. Private to your account.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[13px]">
            <Link
              href="/login?next=/tools/alerts"
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
            >
              Sign in
            </Link>
            <Link
              href="/signup?next=/tools/alerts"
              className="px-4 py-2 rounded-md border font-medium transition-colors hover:bg-[var(--color-paper)]"
              style={{ borderColor: "var(--color-border-default)" }}
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Read the last-reconciled set only — fast. Re-evaluation is the cron's job
  // (or the user's, via "Check now"), not a blocking cost on every open.
  const { active, dismissed } = await loadAlerts(session.userId);

  return (
    <div className="theme-indigo mx-auto max-w-[880px] px-4 md:px-6 py-6 md:py-10">
      <header className="max-w-[640px] mb-6">
        <div className="eyebrow mb-3">Portfolio discipline</div>
        <h1 className="font-display text-[32px] md:text-[36px] tracking-tight leading-tight">
          Alerts
        </h1>
        <p className="muted-text mt-3 text-[14px] leading-[1.55]">
          The few holdings that need a look — profit target reached, a sharp
          down day, or a deep drawdown from your cost. Dismiss to acknowledge; a
          dismissed alert won&apos;t return until its condition clears and
          re-crosses.
        </p>
      </header>

      <AlertsClient initialActive={active} initialDismissed={dismissed} />
    </div>
  );
}
