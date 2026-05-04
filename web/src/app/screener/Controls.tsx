"use client";

import * as Slider from "@radix-ui/react-slider";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import {
  MKT_CAPS, MKT_CAP_LABELS, PRESETS, TIERS, TIER_LABELS,
  type Weights, parseParams, paramsToQuery,
} from "./types";

export function Controls() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const [, startTransition] = useTransition();

  const [weights, setWeights] = useState<Weights>(initial.weights);
  const [preset, setPreset] = useState<string>(initial.preset);
  const [tiersSel, setTiersSel] = useState<string[]>(initial.tiers);
  const [capsSel, setCapsSel] = useState<string[]>(initial.caps);
  const [minQ, setMinQ] = useState(initial.minQ);
  const [minV, setMinV] = useState(initial.minV);
  const [minM, setMinM] = useState(initial.minM);
  const [minC, setMinC] = useState(initial.minC);

  const push = useCallback(
    (override: Partial<{
      weights: Weights; preset: string; tiers: string[];
      caps: string[]; minQ: number; minV: number; minM: number; minC: number;
    }>) => {
      // Preserve metas (managed by MetaChips above the table)
      const currentMetas = sp.get("metas")?.split(",").filter(Boolean) ?? [];
      const q = paramsToQuery({
        weights: override.weights ?? weights,
        preset: override.preset ?? preset,
        metas: currentMetas,
        tiers: override.tiers ?? tiersSel,
        caps: override.caps ?? capsSel,
        minQ: override.minQ ?? minQ,
        minV: override.minV ?? minV,
        minM: override.minM ?? minM,
        minC: override.minC ?? minC,
        page: 1,
      });
      startTransition(() => router.replace("/screener" + q, { scroll: false }));
    },
    [router, sp, weights, preset, tiersSel, capsSel, minQ, minV, minM, minC]
  );

  // Slider helpers — auto-renormalize so total stays 100
  const setWeight = (key: keyof Weights, val: number) => {
    const others = (Object.keys(weights) as (keyof Weights)[]).filter((k) => k !== key);
    const otherSum = others.reduce((s, k) => s + weights[k], 0);
    const newOtherSum = 100 - val;
    let next: Weights;
    if (otherSum === 0) {
      next = { q: 0, v: 0, m: 0 } as Weights;
      next[key] = val;
      const split = Math.round((100 - val) / 2);
      next[others[0]] = split;
      next[others[1]] = 100 - val - split;
    } else {
      next = { ...weights, [key]: val } as Weights;
      next[others[0]] = Math.round((weights[others[0]] / otherSum) * newOtherSum);
      next[others[1]] = 100 - val - next[others[0]];
    }
    setWeights(next);
    setPreset("custom");
    push({ weights: next, preset: "custom" });
  };

  const applyPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    const w = { q: p.q, v: p.v, m: p.m };
    setWeights(w);
    setPreset(key);
    push({ weights: w, preset: key });
  };

  const toggle = (
    list: string[],
    setter: (l: string[]) => void,
    value: string,
    fieldKey: "tiers" | "caps"
  ) => {
    const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    setter(next);
    push({ [fieldKey]: next } as never);
  };

  return (
    <div className="space-y-7">
      {/* Weight blender */}
      <section>
        <Label>Score weighting</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(PRESETS).map(([k, p]) => (
            <Chip
              key={k}
              active={preset === k}
              onClick={() => applyPreset(k)}
            >
              {p.label}
            </Chip>
          ))}
          <Chip active={preset === "custom"}>Custom</Chip>
        </div>

        <div className="mt-4 space-y-3">
          <WeightSlider label="Quality"   value={weights.q} onChange={(v) => setWeight("q", v)} />
          <WeightSlider label="Valuation" value={weights.v} onChange={(v) => setWeight("v", v)} />
          <WeightSlider label="Momentum"  value={weights.m} onChange={(v) => setWeight("m", v)} />
        </div>
      </section>

      <Divider />

      {/* Min pillar scores */}
      <section>
        <Label>Minimum pillar scores</Label>
        <div className="mt-3 space-y-3">
          <MinSlider label="Min Quality"   value={minQ} onChange={setMinQ} onCommit={() => push({ minQ })} />
          <MinSlider label="Min Valuation" value={minV} onChange={setMinV} onCommit={() => push({ minV })} />
          <MinSlider label="Min Momentum"  value={minM} onChange={setMinM} onCommit={() => push({ minM })} />
          <MinSlider label="Min Composite" value={minC} onChange={setMinC} onCommit={() => push({ minC })} />
        </div>
      </section>

      <Divider />

      {/* Maturity tier */}
      <section>
        <Label>Maturity</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TIERS.map((t) => (
            <Chip key={t} active={tiersSel.includes(t)} onClick={() => toggle(tiersSel, setTiersSel, t, "tiers")}>
              {TIER_LABELS[t]}
            </Chip>
          ))}
        </div>
      </section>

      <Divider />

      {/* Market cap */}
      <section>
        <Label>Market cap</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {MKT_CAPS.map((c) => (
            <Chip key={c} active={capsSel.includes(c)} onClick={() => toggle(capsSel, setCapsSel, c, "caps")}>
              {MKT_CAP_LABELS[c]}
            </Chip>
          ))}
        </div>
      </section>

    </div>
  );
}

/* ----- small UI primitives ------------------------------------------ */

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wide muted-text">{children}</div>;
}

function Divider() {
  return <div className="border-t hairline" />;
}

function Chip({
  children, active, onClick,
}: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  const base = "inline-flex items-center px-2.5 py-1 rounded-full text-[12px] border transition-colors cursor-pointer select-none";
  const cls = active
    ? "bg-[var(--color-accent-50)] border-[var(--color-accent-300)] text-[var(--color-accent-700)]"
    : "bg-[var(--color-card)] hairline text-[var(--color-ink)] hover:bg-[var(--color-paper)]";
  return (
    <button type="button" className={base + " " + cls} onClick={onClick}>
      {children}
    </button>
  );
}

function WeightSlider({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between text-[12px]">
        <span>{label}</span>
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
          <Slider.Range className="absolute bg-[var(--color-accent-400)] rounded-full h-full" />
        </Slider.Track>
        <Slider.Thumb
          className="block w-4 h-4 bg-white border border-[var(--color-accent-500)] rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-300)] hover:scale-105 transition-transform"
          aria-label={label}
        />
      </Slider.Root>
    </div>
  );
}

function MinSlider({
  label, value, onChange, onCommit,
}: { label: string; value: number; onChange: (v: number) => void; onCommit: () => void }) {
  return (
    <div>
      <div className="flex justify-between text-[12px]">
        <span>{label}</span>
        <span className="tabular-nums muted-text">{value > 0 ? `≥ ${value}` : "any"}</span>
      </div>
      <Slider.Root
        className="relative flex items-center select-none touch-none w-full h-5"
        value={[value]}
        max={100}
        step={5}
        onValueChange={(vals) => onChange(vals[0])}
        onValueCommit={() => onCommit()}
      >
        <Slider.Track className="bg-[var(--color-paper)] relative flex-1 rounded-full h-1.5">
          <Slider.Range className="absolute bg-[var(--color-muted)]/60 rounded-full h-full" />
        </Slider.Track>
        <Slider.Thumb
          className="block w-4 h-4 bg-white border border-[var(--color-muted)] rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-300)]"
          aria-label={label}
        />
      </Slider.Root>
    </div>
  );
}
