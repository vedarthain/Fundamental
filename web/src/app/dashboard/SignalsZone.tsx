/**
 * Zone 5 — today's three scanners, five rows each.
 *
 * Deliberately reuses /tools/scanner's unstable_cache keyParts and tags so the
 * two pages share one Data Cache entry per scanner rather than each paying its
 * own Neon round-trip. The `null` argument is not decoration: the cache key is
 * keyParts + arguments, and the scanner's landing render calls these with
 * `one(sp.mDate)` → null. Calling them with no argument at all would be a
 * DIFFERENT key and would miss the entry the scanner just warmed.
 *
 * "Fallen Leaders" is absent on purpose — it is a client component reading
 * /api/opportunities over the full ~2,100-row universe, which is the one
 * payload on the scanner heavy enough to be worth not putting on a home page.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { loadLatestMomentum } from "@/lib/momentum";
import { loadLatestTrendLeaders } from "@/lib/trendLeaders";
import { loadLatestSupportFloor } from "@/lib/supportFloor";
import { Zone, Delta, Empty, SymbolLink, fmtDay, num } from "./ui";

const ROW_N = 5;
const HOUR = 3600;
const CACHE_TAGS = ["scanner", "panel-cache"];

const cachedMomentum = unstable_cache(loadLatestMomentum, ["scanner:momentum:v1"], {
  revalidate: HOUR,
  tags: CACHE_TAGS,
});
const cachedTrend = unstable_cache(loadLatestTrendLeaders, ["scanner:trend:v1"], {
  revalidate: HOUR,
  tags: CACHE_TAGS,
});
const cachedFloor = unstable_cache(loadLatestSupportFloor, ["scanner:floor:v1"], {
  revalidate: HOUR,
  tags: CACHE_TAGS,
});

export async function SignalsZone() {
  const [momentum, trend, floor] = await Promise.all([
    cachedMomentum(null).catch(() => null),
    cachedTrend(null).catch(() => null),
    cachedFloor(null).catch(() => null),
  ]);

  const snapDate = momentum?.snapDate ?? trend?.snapDate ?? floor?.snapDate ?? null;

  return (
    <Zone
      title="Signals"
      href="/tools/scanner"
      meta={snapDate ? `post-close · ${fmtDay(snapDate)}` : undefined}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <SignalList
          heading="Igniting"
          sub="abnormal volume"
          href="/tools/scanner?tab=igniting"
          rows={(momentum?.signals ?? []).slice(0, ROW_N).map((s) => ({
            symbol: s.symbol,
            right: <Delta v={s.retPct} />,
            note: `${s.volX.toFixed(1)}× vol${s.newHigh ? " · new high" : ""}`,
          }))}
        />
        <SignalList
          heading="Trend"
          sub="fresh golden cross"
          href="/tools/scanner?tab=trend"
          rows={(trend?.signals ?? []).slice(0, ROW_N).map((s) => ({
            symbol: s.symbol,
            right: <Delta v={s.pctSinceCross} />,
            note: `since ${fmtDay(s.crossDate)}`,
          }))}
        />
        <SignalList
          heading="At support"
          sub="tested floor"
          href="/tools/scanner?tab=floor"
          rows={(floor?.signals ?? []).slice(0, ROW_N).map((s) => ({
            symbol: s.symbol,
            right: (
              <span className="muted-text">
                {s.pctAbove == null ? "—" : `${s.pctAbove.toFixed(1)}%`}
              </span>
            ),
            note: `floor ${num(s.floorPx)} · ${s.nTouch} tests`,
          }))}
        />
      </div>
    </Zone>
  );
}

type Row = { symbol: string; right: ReactNode; note: string };

function SignalList({
  heading,
  sub,
  href,
  rows,
}: {
  heading: string;
  sub: string;
  href: string;
  rows: Row[];
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 mb-1">
        <Link href={href} className="text-[12px] font-medium">
          {heading}
        </Link>
        <span className="muted-text text-[10.5px] truncate">{sub}</span>
      </div>
      {rows.length === 0 ? (
        <Empty>Nothing today.</Empty>
      ) : (
        <ul className="divide-y hairline">
          {rows.map((r) => (
            <li key={r.symbol} className="py-1 flex items-baseline gap-2">
              <span className="min-w-0 flex-1">
                <SymbolLink symbol={r.symbol} />
                <span className="block muted-text text-[10.5px] truncate">{r.note}</span>
              </span>
              <span className="shrink-0 text-[12px] tabular-nums">{r.right}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
