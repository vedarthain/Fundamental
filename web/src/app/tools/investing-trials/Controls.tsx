"use client";

import * as Slider from "@radix-ui/react-slider";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { PRESETS, type Weights } from "./types";

export function Controls({ weights, preset }: { weights: Weights; preset: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [w, setW] = useState<Weights>(weights);
  const [activePreset, setActivePreset] = useState(preset);

  const push = useCallback(
    (next: Weights, p: string) => {
      const q = new URLSearchParams(sp.toString());
      q.set("q", String(next.q));
      q.set("v", String(next.v));
      q.set("m", String(next.m));
      q.set("preset", p);
      q.set("page", "1");
      startTransition(() => router.replace("/tools/investing-trials?" + q.toString(), { scroll: false }));
    },
    [router, sp]
  );

  const setWeight = (key: keyof Weights, val: number) => {
    const others = (Object.keys(w) as (keyof Weights)[]).filter((k) => k !== key);
    const otherSum = others.reduce((s, k) => s + w[k], 0);
    const newOtherSum = 100 - val;
    let next: Weights;
    if (otherSum === 0) {
      const split = Math.round(newOtherSum / 2);
      next = { q: 0, v: 0, m: 0, [key]: val, [others[0]]: split, [others[1]]: newOtherSum - split } as Weights;
    } else {
      const a = Math.round((w[others[0]] / otherSum) * newOtherSum);
      next = { ...w, [key]: val, [others[0]]: a, [others[1]]: newOtherSum - a } as Weights;
    }
    setW(next);
    setActivePreset("custom");
    push(next, "custom");
  };

  const applyPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    const next = { q: p.q, v: p.v, m: p.m };
    setW(next);
    setActivePreset(key);
    push(next, key);
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">Preset</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PRESETS).map(([k, p]) => (
            <Chip key={k} active={activePreset === k} onClick={() => applyPreset(k)}>
              {p.label}
            </Chip>
          ))}
          <Chip active={activePreset === "custom"}>Custom</Chip>
        </div>
      </section>

      <section>
        <div className="text-[11px] uppercase tracking-wide muted-text mb-3">Weights</div>
        <div className="space-y-3">
          <WeightSlider label="Quality"   value={w.q} onChange={(v) => setWeight("q", v)} color="var(--color-accent-600)" />
          <WeightSlider label="Valuation" value={w.v} onChange={(v) => setWeight("v", v)} color="var(--color-accent-400)" />
          <WeightSlider label="Momentum"  value={w.m} onChange={(v) => setWeight("m", v)} color="var(--color-score-good)" />
        </div>
        <div className="mt-3 flex gap-3 text-[12px] muted-text">
          <span>Q <span className="tabular-nums ink-text">{w.q}%</span></span>
          <span>V <span className="tabular-nums ink-text">{w.v}%</span></span>
          <span>M <span className="tabular-nums ink-text">{w.m}%</span></span>
        </div>
      </section>
    </div>
  );
}

function WeightSlider({
  label, value, onChange, color,
}: { label: string; value: number; onChange: (v: number) => void; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[12px] mb-1">
        <span style={{ color }}>{label}</span>
        <span className="tabular-nums muted-text">{value}%</span>
      </div>
      <Slider.Root
        className="relative flex items-center select-none touch-none w-full h-5"
        value={[value]}
        max={100}
        step={5}
        onValueChange={(vals) => onChange(vals[0])}
      >
        <Slider.Track className="bg-[var(--color-paper)] relative flex-1 rounded-full h-1.5">
          <Slider.Range className="absolute rounded-full h-full" style={{ backgroundColor: color }} />
        </Slider.Track>
        <Slider.Thumb
          className="block w-4 h-4 bg-white rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-300)] hover:scale-105 transition-transform"
          style={{ border: `1.5px solid ${color}` }}
          aria-label={label}
        />
      </Slider.Root>
    </div>
  );
}

function Chip({
  children, active, onClick,
}: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  const cls = active
    ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
    : "bg-[var(--color-card)] hairline text-[var(--color-ink)] hover:bg-[var(--color-paper)]";
  return (
    <button
      type="button"
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[12px] border transition-colors cursor-pointer select-none ${cls}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
