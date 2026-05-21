"use client";

import * as Slider from "@radix-ui/react-slider";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import {
  MKT_CAPS, MKT_CAP_LABELS, TIERS, TIER_LABELS,
  parseParams, paramsToQuery,
} from "./types";
import { MultiFilterDropdown } from "./MultiFilterDropdown";

/** Backwards-compatible Controls component — renders all three sections.
 * The screener sidebar now uses the section-scoped variants below
 * (MaturityControls, MarketCapControls, MinScoresControls) so each can live
 * in its own collapsible <details> wrapper. Other callers (e.g. local dev)
 * may still use Controls if they want the full stacked layout. */
export function Controls({ only }: { only?: "maturity" | "cap" | "minScores" }) {
  if (only === "maturity")  return <MaturityControls />;
  if (only === "cap")       return <MarketCapControls />;
  if (only === "minScores") return <MinScoresControls />;
  return (
    <div className="space-y-7">
      <MinScoresControls />
      <Divider />
      <MaturityControls />
      <Divider />
      <MarketCapControls />
    </div>
  );
}

/** Shared push-to-URL hook — every sub-Controls component reads current
 * params, applies its override, and replaces the URL. Preserves sector /
 * industry / index / sort / dir / density via parseParams + spread. */
function useScreenerPush() {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  return useCallback((override: Partial<{
    tiers: string[]; caps: string[];
    minQ: number; minV: number; minM: number; minC: number;
  }>) => {
    const initial = parseParams(sp);
    const q = paramsToQuery({ ...initial, ...override, page: 1 });
    startTransition(() => router.replace("/tools/screener" + q, { scroll: false }));
  }, [router, sp]);
}

export function MinScoresControls() {
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const push = useScreenerPush();
  const [minQ, setMinQ] = useState(initial.minQ);
  const [minV, setMinV] = useState(initial.minV);
  const [minM, setMinM] = useState(initial.minM);
  const [minC, setMinC] = useState(initial.minC);
  return (
    <div className="space-y-3">
      <MinSlider label="Min Quality"        value={minQ} onChange={setMinQ} onCommit={() => push({ minQ })} />
      <MinSlider label="Min Valuation"      value={minV} onChange={setMinV} onCommit={() => push({ minV })} />
      <MinSlider label="Min Momentum"       value={minM} onChange={setMinM} onCommit={() => push({ minM })} />
      <MinSlider label="Min Industry Score" value={minC} onChange={setMinC} onCommit={() => push({ minC })} />
    </div>
  );
}

export function MaturityControls() {
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const push = useScreenerPush();
  const options = TIERS.map((t) => ({ value: t, label: TIER_LABELS[t] }));
  return (
    <MultiFilterDropdown
      values={initial.tiers}
      options={options}
      onApply={(tiers) => push({ tiers })}
      placeholder="All maturities"
    />
  );
}

export function MarketCapControls() {
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const push = useScreenerPush();
  const options = MKT_CAPS.map((c) => ({ value: c, label: MKT_CAP_LABELS[c] }));
  return (
    <MultiFilterDropdown
      values={initial.caps}
      options={options}
      onApply={(caps) => push({ caps })}
      placeholder="All caps"
    />
  );
}

/* ----- small UI primitives ------------------------------------------ */

function Divider() {
  return <div className="border-t hairline" />;
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
