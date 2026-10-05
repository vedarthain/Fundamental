/**
 * /dashboard — signed-in landing. Not a widget page.
 *
 * Redirects to /portfolio when the account has holdings, else /watchlist when
 * it has saved names or open calls, else empty /portfolio (import CTA).
 * Anonymous visitors go to sign-in with ?next=/dashboard.
 *
 * `/` stays the public marketing page (ISR 24h). Do not branch it on auth.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { resolveSignedInHome, SIGNED_IN_HOME } from "@/lib/land";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home · EquityRoots" };

export default async function DashboardRedirect() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(SIGNED_IN_HOME)}`);
  }
  redirect(await resolveSignedInHome(session.userId));
}
