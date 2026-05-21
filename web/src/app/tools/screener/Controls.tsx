"use client";

import * as Slider from "@radix-ui/react-slider";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import {
  MKT_CAPS, MKT_CAP_LABELS, TIERS, TIER_LABELS,
  parseParams, paramsToQuery,
} from "./types";

export function Controls() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = parseParams(sp);
  const [, startTransition] = useTransition();

  const [tiersSel, setTiersSel] = useState<string[]>(initial.tiers);
  const [capsSel, setCapsSel] = useState<string[]>(initial.caps);
  const [minQ, setMinQ] = useState(initial.minQ);
  const [minV, setMinV] = useState(initial.minV);
  const [minM, setMinM] = useState(initial.minM);
  const [minC, setMinC] = useState(initial.minC);

  const push = useCallback(
    (override: Partial<{
      tiers: string[]; caps: string[];
      minQ: number; minV: number; minM: number; minC: number;
    }>) => {
      // Preserve sector, industry, and index from the URL — they're owned by
      // the MetaChips / SubClusterChips / IndexChips components, not by this
      // control panel. Without preserving them, every slider movement would
      // clear those filters silently.
      const currentMetas = sp.get("metas")?.split(",").filter(Boolean) ?? [];
      const currentClusters = sp.get("clusters")?.split(",").filter(Boolean) ?? [];
      const rawIndex = (sp.get("index") ?? "").toLowerCase();
      const currentIndex = (["nifty50", "nifty200", "nifty500"] as const).includes(rawIndex as never)
        ? (rawIndex as "nifty50" | "nifty200" | "nifty500") : "";
      const q = paramsToQuery({
        metas: currentMetas,
        clusters: currentClusters,
        index: currentIndex,
        tiers: override.tiers ?? tiersSel,
        caps: override.caps ?? capsSel,
        minQ: override.minQ ?? minQ,
        minV: override.minV ?? minV,
        minM: override.minM ?? minM,
        minC: override.minC ?? minC,
        page: 1,
      });
      startTransition(() => router.replace("/tools/screener" + q, { scroll: false }));
    },
    [router, sp, tiersSel, capsSel, minQ, minV, minM, minC]
  );

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

      {/* Min pillar scores */}
      <section>
        <Label>Minimum pillar scores</Label>
        <div className="mt-3 space-y-3">
          <MinSlider label="Min Quality"   value={minQ} onChange={setMinQ} onCommit={() => push({ minQ })} />
          <MinSlider label="Min Valuation" value={minV} onChange={setMinV} onCommit={() => push({ minV })} />
          <MinSlider label="Min Momentum"  value={minM} onChange={setMinM} onCommit={() => push({ minM })} />
          <MinSlider label="Min Industry Score" value={minC} onChange={setMinC} onCommit={() => push({ minC })} />
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
