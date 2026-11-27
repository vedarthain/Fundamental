import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { band, bandColor } from "@/lib/score";

export type PeerMiniRow = {
  symbol: string;
  company_name: string | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
};

/**
 * Compact top-3 cluster peer strip rendered on the Strengths & gaps tab
 * of /stock/[symbol], with a 1-click link into /tools/peer-comparison.
 */
export function PeerMiniStrip({
  symbol,
  industryName,
  peers,
}: {
  symbol: string;
  industryName: string | null;
  peers: PeerMiniRow[];
}) {
  if (peers.length === 0) return null;

  const params = new URLSearchParams();
  const slots = ["a", "b", "c", "d"] as const;
  [symbol, ...peers.slice(0, 3).map((p) => p.symbol)].forEach((s, i) => {
    if (slots[i]) params.set(slots[i], s);
  });
  const compareHref = `/tools/peer-comparison?${params.toString()}`;

  return (
    <section className="card p-6 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="font-display text-[17px]">Top cluster peers</h3>
          {industryName ? (
            <p className="text-[12px] muted-text">
              Highest-ranked peers in {industryName}
            </p>
          ) : null}
        </div>
        <Link
          href={compareHref}
          className="inline-flex items-center gap-1 text-[12.5px] font-semibold hover:underline"
          style={{ color: "var(--color-accent-700)" }}
        >
          Compare in Peer Comparison
          <ArrowRight size={13} />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {peers.slice(0, 3).map((p) => {
          const scoreColor =
            p.composite_pct != null ? bandColor(band(p.composite_pct)) : "var(--color-muted)";
          return (
            <Link
              key={p.symbol}
              href={`/stock/${encodeURIComponent(p.symbol)}`}
              className="rounded-lg border hairline p-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors block"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-[13.5px] truncate">
                  {p.symbol}
                </span>
                <span
                  className="num num-sm text-[13px] font-bold shrink-0"
                  style={{ color: scoreColor }}
                >
                  {p.composite_pct != null ? Math.round(p.composite_pct) : "—"}
                </span>
              </div>
              {p.company_name ? (
                <div className="text-[11.5px] muted-text truncate mt-0.5">
                  {p.company_name}
                </div>
              ) : null}
              <div className="mt-2 flex items-center gap-2 text-[10.5px] font-mono muted-text">
                <span>Q {p.quality_pct != null ? Math.round(p.quality_pct) : "—"}</span>
                <span>·</span>
                <span>V {p.valuation_pct != null ? Math.round(p.valuation_pct) : "—"}</span>
                <span>·</span>
                <span>M {p.momentum_pct != null ? Math.round(p.momentum_pct) : "—"}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
