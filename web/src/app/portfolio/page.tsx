/**
 * /portfolio — the signed-in user's holdings tracker.
 *
 * Auth-gated (server-side, like /watchlist): anonymous visitors get a
 * sign-in prompt, never a flash of empty cards. Everything below the fold —
 * live valuation, per-instrument rollup across brokers, the forward-only
 * equity curve vs NIFTF 500 — is derived at read time from broker holdings
 * imported via CSV/XLSX.
 */
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { loadPortfolio, loadEquityCurve } from "@/lib/portfolio";
import { PortfolioClient } from "./PortfolioClient";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const session = await getSession();

  if (!session) {
    return (
      <div className="mx-auto max-w-[520px] px-4 md:px-6 py-10 md:py-16">
        <div className="card p-8 md:p-10 text-center">
          <h1 className="font-display text-[24px] md:text-[26px] leading-[1.1] tracking-tight mb-3">
            Sign in to track your portfolio
          </h1>
          <p className="muted-text text-[13.5px] max-w-md mx-auto mb-6">
            Import holdings from Upstox, Zerodha, Fyers, 5paisa or Groww and see
            them re-priced live, scored on Q/V/M, and tracked forward against
            NIFTY 500. Private to your account.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[13px]">
            <Link
              href="/login?next=/portfolio"
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
            >
              Sign in
            </Link>
            <Link
              href="/signup?next=/portfolio"
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

  const [portfolio, curve] = await Promise.all([
    loadPortfolio(session.userId),
    loadEquityCurve(session.userId),
  ]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 md:px-6 py-6 md:py-8">
      <PortfolioClient portfolio={portfolio} curve={curve} />
    </div>
  );
}
