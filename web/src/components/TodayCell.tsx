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
function istToday(): string {
  return new Date().toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function TodayCell({ initial }: { initial: string }) {
  const [today, setToday] = useState(initial);

  useEffect(() => {
    // Correct any stale baked-in value, then keep it honest if the tab is
    // left open across midnight IST.
    const tick = () => setToday(istToday());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  return <>{today}</>;
}
