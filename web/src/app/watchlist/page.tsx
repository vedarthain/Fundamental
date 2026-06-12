/**
 * /watchlist — the user's saved stocks, with current scores and prices.
 *
 * Auth-gated: anonymous visitors see a "Sign in to see your watchlist"
 * panel rather than the list itself. The watchlist is private to the
 * signed-in user; we don't want strangers seeing each other's lists, and
 * we don't want to suggest there's any public/social data behind the URL.
 *
 * Server-side gating (vs. client-only) means signed-out visitors get a
 * fast HTML response with the sign-in prompt — no flicker of empty cards,
 * no extra round-trip. We also redirect ?next=/watchlist on the login
 * link so users land back here after authenticating.
 *
 * Once signed in, the page delegates to WatchlistClient which calls
 * /api/watchlist (no args → server returns the user's stored list).
 */
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { WatchlistClient } from "./WatchlistClient";
import { SignedInExtras } from "../market/SignedInExtras";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const session = await getSession();

  if (!session) {
    return (
      <div className="mx-auto max-w-[520px] px-4 md:px-6 py-10 md:py-16">
        <div className="card p-8 md:p-10 text-center">
          <h1 className="font-display text-[24px] md:text-[26px] leading-[1.1] tracking-tight mb-3">
            Sign in to see your watchlist
          </h1>
          <p className="muted-text text-[13.5px] max-w-md mx-auto mb-6">
            Your watchlist follows you across devices. Free, no spam — we only
            store your email and the symbols you save.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[13px]">
            <Link
              href="/login?next=/watchlist"
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
            >
              Sign in
            </Link>
            <Link
              href="/signup?next=/watchlist"
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

  return (
    <div className="mx-auto max-w-[1200px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-6">
        <h1 className="font-display text-[26px] md:text-[30px] leading-[1.1] tracking-tight">
          Your watchlist
        </h1>
        <p className="muted-text text-[13px] mt-1">
          Stocks you&apos;re tracking — refreshed with each weekly snapshot. Saved to your account.
        </p>
      </header>
      <WatchlistClient />

      {/* Personal cards moved here from /market — watchlist movers (1D/1W) +
          the 60-day FII/DII trend. Client-fetches /api/market/me. */}
      <div className="mt-8">
        <SignedInExtras />
      </div>
    </div>
  );
}
