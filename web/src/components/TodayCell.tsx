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
const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

type MarketStatus = "open" | "pre_open" | "post_close" | "closed";

function istMarketState(): { dateStr: string; status: MarketStatus } {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  const mins = hour * 60 + Number(p.minute);
  if (!WEEKDAYS.has(p.weekday)) {
    return { dateStr, status: "closed" };
  }
  if (mins >= 9 * 60 && mins < 9 * 60 + 15) {
    return { dateStr, status: "pre_open" };
  }
  if (mins >= 9 * 60 + 15 && mins <= 15 * 60 + 40) {
    return { dateStr, status: "open" };
  }
  if (mins > 15 * 60 + 40) {
    return { dateStr, status: "post_close" };
  }
  return { dateStr, status: "closed" };
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
  const [state, setState] = useState<{ dateStr: string; status: MarketStatus }>({
    dateStr: initial,
    status: "open",
  });
  const [fetchedTime, setFetchedTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setState(istMarketState());
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

  if (state.status === "pre_open") {
    return <>{state.dateStr} - Pre-Open (9:15 AM)</>;
  }
  if (state.status === "post_close") {
    return <>{state.dateStr} - Closed (3:30 PM)</>;
  }
  if (state.status === "closed") {
    return <>{state.dateStr} - Market Closed</>;
  }
  return <>{fetchedTime ? `${state.dateStr} - ${fetchedTime}` : state.dateStr}</>;
}
