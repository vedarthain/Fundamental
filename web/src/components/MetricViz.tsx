/**
 * MetricViz — animated worked-example renderer for the /glossary entries.
 *
 * Amplified-gauge design — the result and the band gauge are the *visual hero*
 * of each entry. The formula line is supporting context above.
 *
 * Animation contract — every viz behaves identically so users can predict it:
 *   1. Inputs fade in left-to-right (140ms stagger)
 *   2. Result number counts up from 0 to its final value
 *   3. Marker slides from the left edge of the gauge to its final position
 *   4. The active band segment brightens and its label scales up
 *
 * No bouncing, no spinning. The animation IS the explanation — ingredients
 * first, then computation, then where the answer lands on the scoring scale.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

// COUNT_UP_MS — duration of the result number's tick-from-zero animation. Tuned
// so the eye can follow each digit step without the result feeling slow.
const COUNT_UP_MS = 850;

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
      { threshold: 0.3 },
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

  // Stagger delays (ms) — each input fades in after the previous, result starts
  // counting up once all inputs are in.
  const stagger = 140;
  const resultDelay = ex.parts.length * stagger + 80;
  const gaugeDelay = resultDelay + 200;
  const noteDelay = gaugeDelay + COUNT_UP_MS + 200;

  // Animated result number — counts up from 0 to ex.result.numeric over
  // COUNT_UP_MS, preserving the original display's prefix / decimal places /
  // suffix so "₹3,496 cr" and "18.2%" both look right while ticking.
  const liveValue = useCountUp(ex.result.numeric, visible, resultDelay);
  const display = useMemo(
    () => formatLikeTemplate(liveValue, ex.result.display, ex.result.numeric),
    [liveValue, ex.result.display, ex.result.numeric],
  );

  return (
    <div
      ref={ref}
      className="rounded-lg border p-4 mt-3"
      style={{
        borderColor: "var(--color-border-default)",
        background: "linear-gradient(180deg, var(--color-card) 0%, var(--color-paper) 100%)",
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] muted-text mb-3 font-semibold">
        Example · {ex.context}
      </div>

      {/* Formula plug-in line — supporting context above the headline result. */}
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
      </div>

      {/* Headline result — counts up, big and colored to match the band. */}
      <div
        className="flex items-baseline gap-2 mt-2"
        style={{
          opacity: visible ? 1 : 0,
          transition: `opacity 360ms ${resultDelay - 200}ms ease-out`,
        }}
      >
        <span
          className="num font-semibold tabular-nums"
          style={{
            color: resultColor,
            fontSize: 32,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
          }}
        >
          {display}
        </span>
        {activeBand && (
          <span
            className="text-[11px] uppercase tracking-[0.12em] font-semibold pb-1"
            style={{ color: resultColor, opacity: 0.85 }}
          >
            {activeBand.label}
          </span>
        )}
      </div>

      {/* Amplified band gauge — taller, rounded segments, drop-shadow marker.
          Each band segment lifts to full opacity when the marker lands on it. */}
      {bands.length > 0 && (
        <div className="mt-3">
          <div
            className="relative h-3 rounded-full flex overflow-hidden"
            style={{
              backgroundColor: "var(--color-border-default)",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.08)",
            }}
          >
            {bands.map((b, i) => {
              const prevUpto = i === 0 ? 0 : bands[i - 1].upTo;
              const width = ((b.upTo - prevUpto) / gaugeMax) * 100;
              const isActive = activeBand === b;
              return (
                <div
                  key={i}
                  style={{
                    width: `${width}%`,
                    backgroundColor: toneColor(b.tone),
                    opacity: visible && isActive ? 1 : 0.55,
                    transition: `opacity 400ms ${gaugeDelay + 100}ms ease-out`,
                  }}
                />
              );
            })}
            {/* Marker — a chunky pin that slides into position then pulses once. */}
            <div
              className="absolute w-4 h-4 rounded-full border-[3px]"
              style={{
                top: "50%",
                left: `calc(${visible ? markerPct : 0}% - 8px)`,
                transform: "translateY(-50%)",
                borderColor: resultColor,
                backgroundColor: "#fff",
                boxShadow: visible
                  ? `0 2px 6px rgba(0,0,0,0.15), 0 0 0 4px ${withAlpha(resultColor, 0.15)}`
                  : "0 1px 3px rgba(0,0,0,0.1)",
                transition: `left 1000ms cubic-bezier(.2,.7,.25,1) ${gaugeDelay}ms, box-shadow 600ms ${gaugeDelay + 800}ms ease-out`,
              }}
            />
          </div>

          {/* Band labels below the gauge. Active band: bigger, bolder, colored. */}
          <div className="flex justify-between text-[9.5px] uppercase tracking-[0.1em] muted-text mt-2">
            {bands.map((b, i) => {
              const isActive = activeBand === b;
              return (
                <span
                  key={i}
                  style={{
                    color: isActive ? resultColor : undefined,
                    fontWeight: isActive ? 700 : 500,
                    fontSize: isActive ? "10.5px" : "9.5px",
                    transition: `color 360ms ${gaugeDelay + 200}ms ease-out, font-size 360ms ${gaugeDelay + 200}ms ease-out`,
                  }}
                >
                  {b.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {ex.note && (
        <div
          className="text-[12.5px] leading-relaxed muted-text mt-3"
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

/**
 * Tick a numeric value from 0 to `target` over COUNT_UP_MS once `start` flips
 * true (typically when the viz scrolls into view). The animation begins after
 * `delayMs` so it lines up with the rest of the staggered fade-in.
 */
function useCountUp(target: number, start: boolean, delayMs: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf = 0;
    let cancelled = false;
    const timer = setTimeout(() => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const p = Math.min(1, (now - t0) / COUNT_UP_MS);
        // ease-out cubic — quick start, gentle settle
        const eased = 1 - Math.pow(1 - p, 3);
        setValue(target * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
        else setValue(target);
      };
      raf = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, start, delayMs]);
  return value;
}

/**
 * Format `current` to match the structure of `template`. Preserves any prefix
 * (₹, +, −) and suffix (%, ×, cr, K, etc.) and uses the same decimal precision
 * the template shows. Falls back to the template string verbatim when we can't
 * find a numeric span in it.
 *
 * Examples:
 *   formatLikeTemplate(2200, "₹3,496 cr", 3496)  →  "₹2,200 cr"
 *   formatLikeTemplate(20, "31.8×", 31.8)        →  "20.0×"
 *   formatLikeTemplate(0.15, "0.15×", 0.15)      →  "0.15×"
 */
function formatLikeTemplate(current: number, template: string, target: number): string {
  // Find the numeric span in the template (digits, commas, optional decimal).
  const match = template.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return template;
  const numText = match[0];
  const idx = match.index ?? 0;
  const prefix = template.slice(0, idx);
  const suffix = template.slice(idx + numText.length);

  // Decimal places — match the template (0 if no '.', else digits after '.').
  const dotIdx = numText.indexOf(".");
  const decimals = dotIdx === -1 ? 0 : numText.length - dotIdx - 1;

  // Group separator — Indian numbering uses commas; preserve if present.
  const hasCommas = numText.includes(",");

  let body = current.toFixed(decimals);
  if (hasCommas) {
    const [intPart, fracPart] = body.split(".");
    // en-IN puts the first comma after the thousands then every two digits
    // (e.g. 12,34,56,789). For our display we'd rather match the template's
    // grouping style — use toLocaleString("en-IN").
    const intNum = parseInt(intPart, 10);
    if (!Number.isNaN(intNum)) {
      body = intNum.toLocaleString("en-IN") + (fracPart != null ? "." + fracPart : "");
    }
  }
  // While counting up we may briefly display 0 with a tiny negative-zero
  // artifact (-0.0); collapse it.
  if (Math.abs(current) < Math.pow(10, -decimals) / 2) {
    body = (0).toFixed(decimals);
  }
  // If we're close enough to the target value, snap to the template's exact
  // formatted body so the final frame matches the source verbatim.
  if (Math.abs(current - target) < Math.pow(10, -decimals) / 2) {
    return template;
  }
  return prefix + body + suffix;
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

// Approximate CSS-var-aware alpha mix for the marker's outer glow. We resolve
// the named CSS vars by hand (keep in sync with globals.css).
function withAlpha(cssColor: string, alpha: number): string {
  const HEX: Record<string, string> = {
    "var(--color-score-excellent)": "#2e9a47",
    "var(--color-score-good)":      "#6abf5d",
    "var(--color-score-neutral)":   "#d9b755",
    "var(--color-score-weak)":      "#e08855",
    "var(--color-score-poor)":      "#c63f23",
    "var(--color-accent-600)":      "#2c4361",
  };
  const hex = HEX[cssColor] ?? "#3d5778";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
