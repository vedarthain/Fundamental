"use client";

/**
 * Engagement tracker — fires a Vercel Analytics custom event when the
 * current page session shows a strong "this is a human, not a bot" signal.
 *
 * The signal: user has either (a) scrolled past 25% of the page, OR
 * (b) been on the page for >= 10 seconds, AND has done at least one
 * mouse-move or key press. Bots typically don't satisfy any of these.
 *
 * The event fires AT MOST ONCE per page load (deduped via ref).  In
 * Vercel Analytics → Custom Events you can compare:
 *
 *   pageview   ← inflated by bots / crawlers / link-checkers
 *   engaged    ← actual humans
 *
 * The ratio between them gives a real-traffic estimate. Zero compute
 * cost — purely client-side; Vercel Analytics is included in your
 * existing plan.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@vercel/analytics";

export function EngagementTracker() {
  const fired = useRef(false);
  const pathname = usePathname();
  // Reset whenever the route changes — engagement is per-page.
  useEffect(() => {
    fired.current = false;
  }, [pathname]);

  useEffect(() => {
    let interacted = false;
    let scrolled25 = false;
    const startedAt = Date.now();

    const fire = (reason: string) => {
      if (fired.current) return;
      fired.current = true;
      track("engaged", {
        path: pathname || "",
        reason,
        dwell_ms: Date.now() - startedAt,
      });
    };

    const onInteract = () => {
      interacted = true;
      // If we've already scrolled enough, this interaction completes the signal.
      if (scrolled25) fire("scroll_and_interact");
    };

    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? scrollTop / docHeight : 0;
      if (pct >= 0.25 && !scrolled25) {
        scrolled25 = true;
        if (interacted) fire("scroll_and_interact");
      }
    };

    // Fallback: 10 seconds of dwell + at least one interaction = engaged.
    // Catches short pages where 25% scroll isn't possible (already at bottom).
    const dwellTimer = window.setTimeout(() => {
      if (interacted) fire("dwell_and_interact");
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

  // Headless — emits events only.
  return null;
}
