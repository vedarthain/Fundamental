/**
 * /dashboard — signed-in home. One screen, five zones, ordered by how urgently
 * each one asks something of you.
 *
 * This page awaits NOTHING but the session. Every zone is its own async server
 * component inside its own <Suspense>, so the shell flushes immediately and
 * each zone streams in when its queries land — one slow loader can no longer
 * hold the whole page. That is the entire reason the zones are separate files:
 * if you inline a loader here, you reintroduce the blocking first paint.
 *
 * Mobile is the primary layout: a single scrolling column in urgency order, no
 * collapsing and no stored UI state. Desktop goes 2-up from `lg` for the two
 * book-side zones only — the market line, the action list and the signals grid
 * stay full-width because they are already multi-column internally.
 *
 * Everything here is end-of-day. There is no intraday feed in this app, so each
 * zone carries its own "as of" rather than implying live prices.
 *
 * `/` stays the public marketing page (ISR 24h). Do not branch it on auth.
 * `/portfolio` and `/watchlist` stay the workspaces; these zones link out.
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ZoneSkeleton } from "./ui";
import { MarketLine } from "./MarketLine";
import { NeedsAction } from "./NeedsAction";
import { BookZone } from "./BookZone";
import { CallsZone } from "./CallsZone";
import { SignalsZone } from "./SignalsZone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · EquityRoots" };

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/dashboard")}`);
  }

  return (
    <div className="mx-auto max-w-[1300px] px-4 md:px-6 py-5 md:py-6">
      <h1 className="font-display text-[22px] md:text-[26px] leading-[1.1] tracking-tight mb-3">
        Home
      </h1>

      <div className="space-y-3">
        <Suspense fallback={<ZoneSkeleton title="Market" rows={2} />}>
          <MarketLine />
        </Suspense>

        <Suspense fallback={<ZoneSkeleton title="Needs action" rows={4} />}>
          <NeedsAction userId={session.userId} />
        </Suspense>

        <div className="grid gap-3 lg:grid-cols-[2fr_1fr] lg:items-start">
          <div className="space-y-3">
            <Suspense fallback={<ZoneSkeleton title="Your book" rows={5} />}>
              <BookZone userId={session.userId} />
            </Suspense>
          </div>
          <Suspense fallback={<ZoneSkeleton title="Open calls" rows={4} />}>
            <CallsZone userId={session.userId} />
          </Suspense>
        </div>

        <Suspense fallback={<ZoneSkeleton title="Signals" rows={5} />}>
          <SignalsZone />
        </Suspense>
      </div>
    </div>
  );
}
