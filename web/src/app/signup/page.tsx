/**
 * /signup — create an account.
 *
 * Posts to /api/auth/signup which also sets the session cookie, so the
 * user is logged in immediately. Any localStorage watchlist symbols are
 * merged into the server-side list on first login.
 */
import { Suspense } from "react";
import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account · EquityRoots" };

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-[420px] px-4 md:px-6 py-10 md:py-16">
      <header className="mb-6 text-center">
        <h1 className="font-display text-[26px] md:text-[30px] leading-[1.1] tracking-tight">
          Create your account
        </h1>
        <p className="muted-text text-[13px] mt-1.5">
          Free. No spam. Just to save your watchlist.
        </p>
      </header>
      <Suspense fallback={<div className="card p-6 text-[13px] muted-text">Loading…</div>}>
        <SignupForm />
      </Suspense>
    </div>
  );
}
