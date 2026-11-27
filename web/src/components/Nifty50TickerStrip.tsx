"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ConstituentRow } from "@/app/api/indices/constituents/route";

/**
 * Self-contained rotating Nifty 50 ticker strip for the landing page.
 * Completely independent of the global top SnapshotRibbon / TopNav banner.
 * Fetches /api/indices/constituents?code=NIFTY50 client-side so the landing
 * page can stay statically cached without baking stale prices.
 */
export function Nifty50TickerStrip() {
  const [items, setItems] = useState<ConstituentRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetch("/api/indices/constituents?code=NIFTY50")
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (!active) return;
          if (json && Array.isArray(json.constituents)) {
            setItems(json.constituents);
          }
          setLoaded(true);
        })
        .catch(() => {
          if (active) setLoaded(true);
        });
    };

    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Hide only if fetch completed with zero items
  if (loaded && items.length === 0) return null;

  return (
    <section
      aria-label="Nifty 50 live ticker"
      className="max-w-[1200px] mx-auto px-3.5 sm:px-6 pt-4 sm:pt-5 pb-0"
    >
      <div
        className="relative flex items-center overflow-hidden rounded-xl border hairline shadow-2xs"
        style={{ backgroundColor: "var(--color-card)" }}
      >
        <div
          className="shrink-0 z-10 flex items-center gap-1.5 px-3 py-2 border-r hairline text-[11px] font-semibold tracking-wide uppercase"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-livepulse"
            style={{ backgroundColor: "var(--color-score-excellent)" }}
          />
          <span>Nifty 50</span>
        </div>

        {!loaded ? (
          <div className="flex-1 px-4 py-2 text-[12px] muted-text">
            Loading Nifty 50 quotes…
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <div
              className="flex w-max items-center animate-marquee hover:[animation-play-state:paused]"
              style={{ animationDuration: "95s" }}
            >
              {[0, 1].map((dup) => (
                <div
                  key={dup}
                  aria-hidden={dup === 1}
                  className="flex items-center shrink-0"
                >
                  {items.map((row) => (
                    <TickerItem key={`${dup}-${row.symbol}`} row={row} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TickerItem({ row }: { row: ConstituentRow }) {
  const pct = row.pct_1d != null ? row.pct_1d * 100 : null;
  const up = pct != null && pct >= 0;
  const pctColor =
    pct == null
      ? "text-slate-400"
      : up
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400";

  return (
    <Link
      href={`/stock/${encodeURIComponent(row.symbol)}`}
      className="inline-flex items-baseline gap-1.5 px-3.5 py-2 border-r hairline/60 whitespace-nowrap shrink-0 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors"
    >
      <span className="text-[12px] font-semibold">{row.symbol}</span>
      {row.price != null ? (
        <span className="num num-sm text-[11.5px] muted-text">
          ₹{row.price.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
        </span>
      ) : null}
      {pct != null ? (
        <span className={`num num-sm text-[11px] font-semibold ${pctColor}`}>
          {up ? "+" : ""}
          {pct.toFixed(2)}%
        </span>
      ) : null}
    </Link>
  );
}
