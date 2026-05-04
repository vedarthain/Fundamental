"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import {
  QUALITY_FORMULAS, VALUATION_FORMULAS, MOMENTUM_FORMULAS, FALLBACK_FORMULAS,
} from "../formulas";

type Active = {
  id: number;
  effective_from: string;
  pillar_weights: Record<string, number>;
  quality: Record<string, number>;
  valuation: Record<string, number>;
  momentum: Record<string, number>;
  loss_maker_val_fallback: [string, number][];
  edited_by: string | null;
  notes: string | null;
};

export function ScorecardEditor({
  clusterId, initial,
}: { clusterId: string; initial: Active | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pw, setPw] = useState({
    q: initial?.pillar_weights?.q ?? 40,
    v: initial?.pillar_weights?.v ?? 30,
    m: initial?.pillar_weights?.m ?? 30,
  });
  const [quality, setQuality] = useState<[string, number][]>(
    objToList(initial?.quality)
  );
  const [valuation, setValuation] = useState<[string, number][]>(
    objToList(initial?.valuation)
  );
  const [momentum, setMomentum] = useState<[string, number][]>(
    objToList(initial?.momentum)
  );
  const [fallback, setFallback] = useState<[string, number][]>(
    initial?.loss_maker_val_fallback ?? []
  );
  const [editor, setEditor] = useState("admin");
  const [notes, setNotes] = useState("");

  const pwSum = pw.q + pw.v + pw.m;
  const qSum = quality.reduce((s, [, w]) => s + w, 0);
  const vSum = valuation.reduce((s, [, w]) => s + w, 0);
  const mSum = momentum.reduce((s, [, w]) => s + w, 0);
  const fbSum = fallback.reduce((s, [, w]) => s + w, 0);

  const issues: string[] = [];
  if (Math.abs(pwSum - 100) > 0.5) issues.push(`Pillar weights sum to ${pwSum} (need 100)`);
  if (Math.abs(qSum - 100) > 0.5) issues.push(`Quality components sum to ${qSum} (need 100)`);
  if (Math.abs(vSum - 100) > 0.5) issues.push(`Valuation components sum to ${vSum} (need 100)`);
  if (Math.abs(mSum - 100) > 0.5) issues.push(`Momentum components sum to ${mSum} (need 100)`);
  if (fallback.length > 0 && Math.abs(fbSum - 1.0) > 0.05)
    issues.push(`Loss-maker fallback shares sum to ${fbSum.toFixed(2)} (need 1.0)`);
  // Duplicates
  for (const [pn, list] of [["Quality", quality], ["Valuation", valuation], ["Momentum", momentum]] as const) {
    const seen = new Set<string>();
    for (const [k] of list) {
      if (k && seen.has(k)) {
        issues.push(`${pn}: '${k}' appears twice`);
        break;
      }
      if (k) seen.add(k);
    }
  }

  const onSave = () => {
    setError(null);
    setSuccess(null);
    if (issues.length > 0) {
      setError(issues[0]);
      return;
    }
    start(async () => {
      const body = {
        pillar_weights: pw,
        quality: listToObj(quality),
        valuation: listToObj(valuation),
        momentum: listToObj(momentum),
        loss_maker_val_fallback: fallback.filter(([k, w]) => k && w > 0),
        edited_by: editor || null,
        notes: notes || null,
      };
      try {
        const r = await fetch(`/api/admin/scorecards/${clusterId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        setSuccess("Saved. New version will take effect on the next scoring run.");
        router.refresh();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Pillar weights */}
      <section className="card p-6">
        <SectionLabel>Pillar weights</SectionLabel>
        <p className="text-[12px] muted-text mb-4">Must sum to 100.</p>
        <div className="grid grid-cols-3 gap-4">
          <PillarInput label="Quality"  color="var(--color-accent-600)" value={pw.q} onChange={(v) => setPw({ ...pw, q: v })} />
          <PillarInput label="Valuation" color="var(--color-accent-400)" value={pw.v} onChange={(v) => setPw({ ...pw, v: v })} />
          <PillarInput label="Momentum" color="var(--color-accent-300)" value={pw.m} onChange={(v) => setPw({ ...pw, m: v })} />
        </div>
        <div className={`mt-3 text-[12px] tabular-nums ${Math.abs(pwSum - 100) > 0.5 ? "text-[var(--color-score-poor)]" : "muted-text"}`}>
          Total: {pwSum}
        </div>
      </section>

      {/* Quality components */}
      <ComponentEditor
        label="Quality components" color="var(--color-accent-600)"
        items={quality} setItems={setQuality}
        options={QUALITY_FORMULAS} sum={qSum}
      />

      {/* Valuation components */}
      <ComponentEditor
        label="Valuation components" color="var(--color-accent-400)"
        items={valuation} setItems={setValuation}
        options={VALUATION_FORMULAS} sum={vSum}
      />

      {/* Momentum components */}
      <ComponentEditor
        label="Momentum components" color="var(--color-accent-300)"
        items={momentum} setItems={setMomentum}
        options={MOMENTUM_FORMULAS} sum={mSum}
      />

      {/* Loss-maker fallback */}
      <FallbackEditor items={fallback} setItems={setFallback} sum={fbSum} />

      {/* Save bar */}
      <section className="card p-5 sticky bottom-4 z-10" style={{ backgroundColor: "var(--color-card)" }}>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
          <Field label="Edited by">
            <input
              value={editor}
              onChange={(e) => setEditor(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border hairline rounded-md bg-[var(--color-paper)]"
              placeholder="your name"
            />
          </Field>
          <Field label="Notes (optional)">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border hairline rounded-md bg-[var(--color-paper)]"
              placeholder="e.g. raised P/B weight for banks after Q3 review"
            />
          </Field>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || issues.length > 0}
            className="px-5 py-2.5 rounded-md text-[14px] font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ backgroundColor: "var(--color-accent-500)" }}
          >
            {pending ? "Saving…" : "Save new version"}
          </button>
        </div>
        {issues.length > 0 && (
          <div className="mt-3 text-[12px]" style={{ color: "var(--color-score-poor)" }}>
            {issues.length === 1 ? issues[0] : `${issues.length} issues — first: ${issues[0]}`}
          </div>
        )}
        {error && (
          <div className="mt-3 text-[12px]" style={{ color: "var(--color-score-poor)" }}>
            {error}
          </div>
        )}
        {success && (
          <div className="mt-3 text-[12px]" style={{ color: "var(--color-score-good)" }}>
            {success}
          </div>
        )}
      </section>
    </div>
  );
}

/* ----- subcomponents -------------------------------------------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wide muted-text mb-2">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wide muted-text mb-1">{label}</div>
      {children}
    </label>
  );
}

function PillarInput({
  label, color, value, onChange,
}: { label: string; color: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="text-[12px] mb-1.5" style={{ color }}>{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0} max={100} step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-20 px-3 py-2 text-[14px] tabular-nums border hairline rounded-md bg-[var(--color-paper)]"
        />
        <span className="text-[12px] muted-text">%</span>
      </div>
    </div>
  );
}

function ComponentEditor({
  label, color, items, setItems, options, sum,
}: {
  label: string;
  color: string;
  items: [string, number][];
  setItems: (next: [string, number][]) => void;
  options: readonly string[];
  sum: number;
}) {
  const off = Math.abs(sum - 100) > 0.5;
  return (
    <section className="card p-6" style={{ borderTop: `3px solid ${color}` }}>
      <div className="flex items-baseline justify-between mb-3">
        <SectionLabel>{label}</SectionLabel>
        <div className={`text-[12px] tabular-nums ${off ? "text-[var(--color-score-poor)]" : "muted-text"}`}>
          Total: {sum}
        </div>
      </div>
      <div className="space-y-2">
        {items.map(([k, w], i) => (
          <div key={i} className="grid grid-cols-[1fr_100px_36px] gap-2 items-center">
            <select
              value={k}
              onChange={(e) => {
                const next = [...items];
                next[i] = [e.target.value, w];
                setItems(next);
              }}
              className="w-full px-3 py-2 text-[13px] border hairline rounded-md bg-[var(--color-paper)]"
            >
              <option value="">— select metric —</option>
              {options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0} max={100} step={1}
                value={w}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = [k, Number(e.target.value) || 0];
                  setItems(next);
                }}
                className="w-full px-3 py-2 text-[13px] tabular-nums border hairline rounded-md bg-[var(--color-paper)]"
              />
              <span className="text-[11px] muted-text">%</span>
            </div>
            <button
              type="button"
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              className="p-2 hairline border rounded-md hover:bg-[var(--color-paper)] text-[var(--color-muted)]"
              aria-label="Remove component"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setItems([...items, ["", 0]])}
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md hairline border text-[12px] hover:bg-[var(--color-paper)]"
      >
        <Plus size={13} /> Add component
      </button>
    </section>
  );
}

function FallbackEditor({
  items, setItems, sum,
}: { items: [string, number][]; setItems: (next: [string, number][]) => void; sum: number }) {
  const off = items.length > 0 && Math.abs(sum - 1.0) > 0.05;
  return (
    <section className="card p-6">
      <div className="flex items-baseline justify-between mb-2">
        <SectionLabel>Loss-maker valuation fallback</SectionLabel>
        <div className={`text-[12px] tabular-nums ${off ? "text-[var(--color-score-poor)]" : "muted-text"}`}>
          Total share: {sum.toFixed(2)} {items.length > 0 && "(target 1.00)"}
        </div>
      </div>
      <p className="text-[12px] muted-text mb-3">
        When P/E is null (loss-makers), the metric weight that would have gone to P/E is
        redistributed across these fallback metrics in the given shares (e.g. 0.6 / 0.4).
      </p>
      <div className="space-y-2">
        {items.map(([k, share], i) => (
          <div key={i} className="grid grid-cols-[1fr_100px_36px] gap-2 items-center">
            <select
              value={k}
              onChange={(e) => {
                const next: [string, number][] = [...items];
                next[i] = [e.target.value, share];
                setItems(next);
              }}
              className="w-full px-3 py-2 text-[13px] border hairline rounded-md bg-[var(--color-paper)]"
            >
              <option value="">— select metric —</option>
              {FALLBACK_FORMULAS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <input
              type="number"
              min={0} max={1} step={0.05}
              value={share}
              onChange={(e) => {
                const next: [string, number][] = [...items];
                next[i] = [k, Number(e.target.value) || 0];
                setItems(next);
              }}
              className="w-full px-3 py-2 text-[13px] tabular-nums border hairline rounded-md bg-[var(--color-paper)]"
            />
            <button
              type="button"
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              className="p-2 hairline border rounded-md hover:bg-[var(--color-paper)] text-[var(--color-muted)]"
              aria-label="Remove fallback"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setItems([...items, ["", 0]])}
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md hairline border text-[12px] hover:bg-[var(--color-paper)]"
      >
        <Plus size={13} /> Add fallback
      </button>
    </section>
  );
}

/* ----- helpers --------------------------------------------------- */

function objToList(obj: Record<string, number> | undefined | null): [string, number][] {
  if (!obj) return [];
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

function listToObj(list: [string, number][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, w] of list) {
    if (k && !(k in out)) out[k] = w;
  }
  return out;
}
