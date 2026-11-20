"use client";

import { useEffect, useState } from "react";

/**
 * TodayCell — the "TODAY" value in SnapshotRibbon, computed in the browser.
 *
 * The ribbon lives in the root layout, so it's baked into every statically-
 * generated page (home/about/glossary/… revalidate hourly). A server-computed
 * `new Date()` therefore freezes at revalidation time and can read yesterday
 * until the page is next re-rendered — the BUG-05 "static vs data date skew".
 *
 * Rendering the date client-side sidesteps ISR entirely: `initial` seeds the
 * SSR/static HTML (so there's no flash / no-JS blank), then the effect
 * overwrites it with the real current IST day on mount. Keeps the whole site
 * statically generated while guaranteeing the visible date is always today.
 */
function istDate(): string {
  return new Date().toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function fmtIstTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d
    .toLocaleTimeString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();
}

export default function TodayCell({ initial }: { initial: string }) {
  const [dateStr, setDateStr] = useState(initial);
  const [fetchedTime, setFetchedTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setDateStr(istDate());
    tick();
    const id = setInterval(tick, 60_000);

    const onFetched = (ev: Event) => {
      const iso = (ev as CustomEvent<string>).detail;
      if (typeof iso === "string") {
        const t = fmtIstTime(iso);
        if (t) setFetchedTime(t);
      }
    };
    window.addEventListener("er:indices-fetched", onFetched);
    return () => {
      clearInterval(id);
      window.removeEventListener("er:indices-fetched", onFetched);
    };
  }, []);

  return <>{fetchedTime ? `${dateStr} - ${fetchedTime}` : dateStr}</>;
}
