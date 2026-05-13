/**
 * MetricViz — animated worked-example renderer for the /glossary entries.
 *
 * Why we built our own instead of using a chart lib:
 *   - All entries share the same shape (a ratio's inputs + the resulting
 *     value placed on a 5-tier band scale). One component handles ~50
 *     entries; a chart lib would be overkill for this density of
 *     pedagogy-first visuals.
 *   - SSR-friendly server component would be possible, but the staggered
 *     fade-in + gauge-fill animations want IntersectionObserver to trigger
 *     only when the entry actually scrolls into view (don't waste motion
 *     on entries the user never reaches). Hence "use client".
 *
 * Animation contract — every viz behaves identically so users can predict it:
 *   1. Numerator(s) fade in left-to-right (150ms stagger)
 *   2. The result fades in after them
 *   3. The marker slides along the band scale to its final position (900ms)
 *
 * No bouncing, no spinning. The animation IS the explanation — ingredients
 * first, then computation, then where the answer lands on the scoring scale.
 */
"use client";

import { useEffect, useRef, useState } from "react";

type Tone = "poor" | "weak" | "neutral" | "good" | "excellent";

export type MetricBand = {
  // Upper bound of this band (exclusive of higher bands). Bands must be
  // provided in ascending order of upTo so the gauge renders left-to-right.
  upTo: number;
  label: string;
  tone: Tone;
};

export type MetricExample = {
  // Short context line — usually "<SYMBOL> FY24" or "<SYMBOL> Q3 FY25".
  context: string;
  // Numerator/denominator/component values, in the order they should appear.
  // Each entry: a short label and a pre-formatted display string. We don't
  // re-format on the client so unit conventions (₹ cr, %, basis-points)
  // stay consistent with the rest of the page.
  parts: { label: string; display: string }[];
  // The computed result. `numeric` drives the marker position on the gauge;
  // `display` is the human-readable string ("18.2%", "1.4x", "₹4,200 cr").
  result: { display: string; numeric: number };
  // Optional band scale. Omit for ratios where a 5-tier comparison doesn't
  // make sense (e.g. some sector metrics where "good" depends on company size).
  bands?: MetricBand[];
  // Optional one-sentence interpretation of where the result landed.
  note?: string;
};

export function MetricViz({ ex }: { ex: MetricExample }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Trigger animations only after the entry scrolls into view. Once visible
  // we stop observing — the animation plays once per page load.
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            return;
          }
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const bands = ex.bands ?? [];
  // Gauge range: 0 → top band's upTo (clamped to a positive minimum so single-band
  // examples don't divide by zero). Marker position is the result's numeric value
  // as a percentage of the gauge range.
  const gaugeMax = bands.length > 0 ? bands[bands.length - 1].upTo : Math.max(1, ex.result.numeric * 1.2);
  const markerPct = Math.max(0, Math.min(100, (ex.result.numeric / gaugeMax) * 100));

  // Find which band the result lands in — drives marker color + note styling.
  const activeBand = bands.find((b) => ex.result.numeric <= b.upTo) ?? bands[bands.length - 1];
  const resultColor = activeBand ? toneColor(activeBand.tone) : "var(--color-accent-600)";

  // Stagger delays (ms) — each part fades in after the previous.
  const stagger = 140;
  const resultDelay = ex.parts.length * stagger;
  const noteDelay = resultDelay + stagger + 100;

  return (
    <div
      ref={ref}
      className="rounded-md border p-3 mt-3"
      style={{
        borderColor: "var(--color-border-default)",
        backgroundColor: "var(--color-paper)",
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.12em] muted-text mb-2 font-semibold">
        Example · {ex.context}
      </div>

      {/* Formula plug-in line — labels + values, then arrow → result */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px]">
        {ex.parts.map((p, i) => (
          <span
            key={i}
            style={{
              opacity: visible ? 1 : 0,
              transition: `opacity 360ms ${i * stagger}ms ease-out`,
            }}
          >
            <span className="muted-text">{p.label}: </span>
            <span className="num font-semibold" style={{ color: "var(--color-ink)" }}>
              {p.display}
            </span>
          </span>
        ))}
        <span
          style={{
            opacity: visible ? 1 : 0,
            transition: `opacity 360ms ${resultDelay}ms ease-out`,
          }}
        >
          <span className="muted-text">→ </span>
          <span
            className="num num-lg font-semibold"
            style={{ color: resultColor }}
          >
            {ex.result.display}
          </span>
        </span>
      </div>

      {/* Band gauge — 5-tier horizontal bar with a circular marker that
          slides into place. Skip the gauge if no bands provided. */}
      {bands.length > 0 && (
        <div className="mt-3">
          <div
            className="relative h-1.5 rounded-full overflow-hidden flex"
            style={{ backgroundColor: "var(--color-border-default)" }}
          >
            {bands.map((b, i) => {
              const prevUpto = i === 0 ? 0 : bands[i - 1].upTo;
              const width = ((b.upTo - prevUpto) / gaugeMax) * 100;
              return (
                <div
                  key={i}
                  style={{
                    width: `${width}%`,
                    backgroundColor: toneColor(b.tone),
                    opacity: 0.75,
                  }}
                />
              );
            })}
            {/* Marker — circle that slides along the gauge from 0% → markerPct */}
            <div
              className="absolute top-1/2 w-2.5 h-2.5 rounded-full border-2"
              style={{
                left: `calc(${visible ? markerPct : 0}% - 5px)`,
                transform: "translateY(-50%)",
                borderColor: resultColor,
                backgroundColor: "#fff",
                transition: "left 900ms cubic-bezier(.22,.7,.25,1) " + resultDelay + "ms",
              }}
            />
          </div>
          <div
            className="flex justify-between text-[9px] uppercase tracking-[0.1em] muted-text mt-1.5"
          >
            {bands.map((b, i) => (
              <span
                key={i}
                style={
                  activeBand === b
                    ? { color: resultColor, fontWeight: 600 }
                    : undefined
                }
              >
                {b.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {ex.note && (
        <div
          className="text-[12px] muted-text mt-2"
          style={{
            opacity: visible ? 1 : 0,
            transition: `opacity 360ms ${noteDelay}ms ease-out`,
          }}
        >
          {ex.note}
        </div>
      )}
    </div>
  );
}

function toneColor(t: Tone): string {
  switch (t) {
    case "excellent":
      return "var(--color-score-excellent)";
    case "good":
      return "var(--color-score-good)";
    case "neutral":
      return "var(--color-score-neutral)";
    case "weak":
      return "var(--color-score-weak)";
    case "poor":
      return "var(--color-score-poor)";
  }
}
