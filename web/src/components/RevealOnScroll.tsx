"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Wraps a section. Its descendants' SVG animations stay reset to their
 * starting state until this wrapper enters the viewport, then play in
 * sequence. When the section scrolls out, animations reset — so they
 * play again next time the user scrolls back in.
 */
export function RevealOnScroll({
  children,
  threshold = 0.15,
}: {
  children: React.ReactNode;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Two-way toggle so animations replay every time the section
          // re-enters view, not just on first sight.
          setVisible(entry.isIntersecting);
        }
      },
      { threshold, rootMargin: "0px 0px -10% 0px" },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);

  return (
    <div ref={ref} className={`reveal-anim ${visible ? "is-visible" : ""}`}>
      {children}
    </div>
  );
}
