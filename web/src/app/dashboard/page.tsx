/**
 * /dashboard — signed-in home. One screen of tiles, ordered by how urgently
 * each one asks something of you.
 *
 * This page awaits NOTHING but the session. Every zone is its own async server
 * component inside its own <Suspense>, so the shell flushes immediately and
 * each zone streams in when its queries land — one slow loader can no longer
 * hold the whole page. That is the entire reason the zones are separate files:
 * if you inline a loader here, you reintroduce the blocking first paint.
 *
 * Layout: a DENSE GRID of fixed-height widget boxes, not a stack of cards. One
 * column on a phone, 2-up from `sm`, 3-up from `lg`. Every tile is the same
 * height (`ui.tsx`'s BODY_H) and scrolls inside itself, so the grid never goes
 * ragged and the page does not grow with the data. "Needs action" spans two
 * columns on desktop because its rows are sentences, not numbers.
 *
 * Eleven tiles. Every one of them is a different QUESTION, which is the only
 * admission test: "what moved", "what needs a decision", "what do I own", "how
 * concentrated is it", "what is due", "what did they file", "what is listing".
 * A twelfth tile that re-answers one of those belongs inside the tile that
 * already owns the question, not beside it.
 *
 * The market strip is the one non-widget: four index levels and the FII/DII net
 * on a single line above the grid. Boxing it wasted a whole row.
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
import { SectorHeat } from "./SectorHeat";
import { ResultsZone } from "./ResultsZone";
import { IpoZone } from "./IpoZone";
import { FilingsZone } from "./FilingsZone";
import { ConcentrationZone } from "./ConcentrationZone";

import { DashboardTabs } from "./DashboardTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · EquityRoots" };

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/dashboard")}`);
  }

  return (
    <div className="mx-auto max-w-[1300px] px-3 md:px-5 py-3 md:py-4">
      <div className="flex items-baseline gap-2 mb-2">
        <h1 className="font-display text-[18px] md:text-[20px] leading-none tracking-tight">
          Home
        </h1>
        <span className="muted-text text-[10px]">end of day</span>
      </div>

      <Suspense fallback={<div className="h-[34px] rounded-md border hairline" />}>
        <MarketLine />
      </Suspense>

      <DashboardTabs
        bookGroup={
          <>
            <div className="sm:col-span-2">
              <Suspense fallback={<ZoneSkeleton title="Needs action" />}>
                <NeedsAction userId={session.userId} />
              </Suspense>
            </div>

            <Suspense fallback={<ZoneSkeleton title="Research calls" />}>
              <CallsZone userId={session.userId} />
            </Suspense>

            <Suspense fallback={<ZoneSkeleton title="Your book" />}>
              <BookZone userId={session.userId} />
            </Suspense>

            <Suspense fallback={<ZoneSkeleton title="Concentration" />}>
              <ConcentrationZone userId={session.userId} />
            </Suspense>
          </>
        }
        signalsGroup={
          <>
            <Suspense fallback={<ZoneSkeleton title="Sector heat" />}>
              <SectorHeat />
            </Suspense>

            {/* Renders three sibling <Zone> boxes */}
            <Suspense
              fallback={
                <>
                  <ZoneSkeleton title="Igniting" />
                  <ZoneSkeleton title="Trend" />
                  <ZoneSkeleton title="At support" />
                </>
              }
            >
              <SignalsZone />
            </Suspense>
          </>
        }
        radarGroup={
          <>
            <Suspense fallback={<ZoneSkeleton title="Calendar" />}>
              <ResultsZone userId={session.userId} />
            </Suspense>

            <Suspense fallback={<ZoneSkeleton title="Filings" />}>
              <FilingsZone userId={session.userId} />
            </Suspense>

            <Suspense fallback={<ZoneSkeleton title="IPO" />}>
              <IpoZone />
            </Suspense>
          </>
        }
      />
    </div>
  );
}
