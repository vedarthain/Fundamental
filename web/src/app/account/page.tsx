/**
 * /account — signed-in user's account settings.
 *
 * Currently: identity summary + change-password. Gated on a valid session;
 * signed-out visitors are bounced to /login?next=/account.
 */
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account · EquityRoots" };

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login?next=/account");
  }

  return (
    <div className="mx-auto max-w-[460px] px-4 md:px-6 py-8 md:py-12">
      <header className="mb-6">
        <h1 className="font-display text-[26px] tracking-tight">Account</h1>
        <p className="muted-text text-[13px] mt-1">
          Signed in as <span className="font-medium" style={{ color: "var(--color-ink)" }}>{user.email}</span>
          {user.displayName ? <> · {user.displayName}</> : null}
        </p>
      </header>

      <section>
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">
          Change password
        </div>
        <ChangePasswordForm />
        <p className="muted-text text-[11.5px] mt-3 leading-relaxed">
          Forgot your current password and can&apos;t sign in? There&apos;s no
          email reset — write to us via <a className="underline" href="/feedback">feedback</a> and
          an admin will reset it for you.
        </p>
      </section>
    </div>
  );
}
