"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";

function getSessionId(): string {
  try {
    const k = "er_insight_sid";
    let sid = sessionStorage.getItem(k);
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(k, sid);
    }
    return sid;
  } catch {
    return "anon";
  }
}

function getDevice(): "mobile" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  return window.innerWidth < 768 ? "mobile" : "desktop";
}

function sendInsight(payload: Record<string, unknown>) {
  try {
    const body = JSON.stringify({
      ...payload,
      device: getDevice(),
      session_id: getSessionId(),
    });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/insights/collect", blob);
    } else {
      fetch("/api/insights/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Non-blocking telemetry
  }
}

export function SiteInsightsTracker() {
  const pathname = usePathname() || "/";
  const pathRef = useRef(pathname);
  const engagedFired = useRef(false);

  useEffect(() => {
    pathRef.current = pathname;
    engagedFired.current = false;

    // 1. Pageview event
    sendInsight({
      event_type: "pageview",
      path: pathname,
      referrer: typeof document !== "undefined" ? document.referrer : "",
    });

    // 2. Human engagement signal (scroll >= 25% or >= 10s dwell + interaction)
    let interacted = false;
    let scrolled25 = false;
    const startedAt = Date.now();

    const fireEngaged = () => {
      if (engagedFired.current) return;
      engagedFired.current = true;
      sendInsight({
        event_type: "engaged",
        path: pathname,
        dwell_ms: Date.now() - startedAt,
      });
    };

    const onInteract = () => {
      interacted = true;
      if (scrolled25) fireEngaged();
    };

    const onScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? window.scrollY / docHeight : 0;
      if (pct >= 0.25 && !scrolled25) {
        scrolled25 = true;
        if (interacted) fireEngaged();
      }
    };

    const dwellTimer = window.setTimeout(() => {
      if (interacted) fireEngaged();
    }, 10_000);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("mousemove", onInteract, { once: true, passive: true });
    window.addEventListener("keydown", onInteract, { once: true });
    window.addEventListener("touchstart", onInteract, { once: true, passive: true });
    window.addEventListener("click", onInteract, { once: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("mousemove", onInteract);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("touchstart", onInteract);
      window.removeEventListener("click", onInteract);
      window.clearTimeout(dwellTimer);
    };
  }, [pathname]);

  // 3. Core Web Vitals (TTFB, FCP, LCP, CLS, INP) via Next.js built-in hook
  useReportWebVitals((metric) => {
    const p = pathRef.current || "/";
    if (metric.name === "TTFB") {
      sendInsight({ event_type: "vital", path: p, ttfb_ms: metric.value });
    } else if (metric.name === "FCP") {
      sendInsight({ event_type: "vital", path: p, fcp_ms: metric.value });
    } else if (metric.name === "LCP") {
      sendInsight({ event_type: "vital", path: p, lcp_ms: metric.value });
    } else if (metric.name === "CLS") {
      sendInsight({ event_type: "vital", path: p, cls: metric.value });
    } else if (metric.name === "INP") {
      sendInsight({ event_type: "vital", path: p, inp_ms: metric.value });
    }
  });

  return null;
}
