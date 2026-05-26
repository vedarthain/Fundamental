/**
 * /login — email + password sign-in.
 *
 * On success, fires a session-changed event so the top nav swaps
 * "Sign in" for "Watchlist" without a full reload, then redirects to the
 * URL passed via ?next=, falling back to /watchlist.
 */
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · EquityRoots" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-[420px] px-4 md:px-6 py-10 md:py-16">
      <header className="mb-6 text-center">
        <h1 className="font-display text-[26px] md:text-[30px] leading-[1.1] tracking-tight">
          Sign in
        </h1>
        <p className="muted-text text-[13px] mt-1.5">
          Access your watchlist across devices.
        </p>
      </header>
      <Suspense fallback={<div className="card p-6 text-[13px] muted-text">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
