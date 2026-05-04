/** Three large story cards (Q / V / M), each with a plain-English summary
 * + one strength + one gap. Visual replacement for the SHAP waterfall.
 *
 * v1 uses rule-based phrasing (etl/lib/explainer.ts). Once the Claude narrative
 * engine ships in Phase 3, swap the text with model output — same UI shape.
 */

import { band, bandColor } from "@/lib/score";
import type { PillarStory } from "@/lib/explainer";

export function PillarStoryCards({ stories }: { stories: PillarStory[] }) {
  return (
    <div className="space-y-4">
      {stories.map((s) => (
        <PillarCard key={s.pillar} story={s} />
      ))}
    </div>
  );
}

function PillarCard({ story }: { story: PillarStory }) {
  const bnd = band(story.pct);
  const c = bandColor(bnd);

  return (
    <div className="card p-5 grid grid-cols-[120px_1fr] gap-5 items-stretch">
      {/* Left: pillar name + big score chip */}
      <div className="flex flex-col">
        <div className="text-[11px] uppercase tracking-wide muted-text">
          Pillar
        </div>
        <div className="font-display text-[20px] mt-1 leading-tight">
          {story.pillar}
        </div>
        <div
          className="mt-3 rounded-md flex items-center justify-center h-[60px]"
          style={{
            backgroundColor: c,
            color: bnd === "neutral" ? "var(--color-ink)" : "white",
          }}
        >
          <span className="font-display text-[34px] tabular-nums leading-none">
            {story.pct == null ? "—" : Math.round(story.pct)}
          </span>
        </div>
      </div>

      {/* Right: summary + drivers */}
      <div className="flex flex-col">
        <p className="text-[15px] leading-relaxed">
          {story.summary}
        </p>

        <div className="mt-4 space-y-2">
          {story.strength && <DriverRow line={story.strength} />}
          {story.gap && <DriverRow line={story.gap} />}
          {!story.strength && !story.gap && (
            <div className="text-[12px] muted-text italic">
              No standout drivers — fundamentals broadly even.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DriverRow({ line }: { line: { label: string; subPct: number; kind: "up" | "down" } }) {
  const colour =
    line.kind === "up" ? "var(--color-score-good)" : "var(--color-score-poor)";
  const arrow = line.kind === "up" ? "↑" : "↓";
  return (
    <div className="flex items-start gap-2 text-[13px]">
      <span
        className="font-medium tabular-nums shrink-0 mt-0.5"
        style={{ color: colour, width: 22 }}
      >
        {arrow}
      </span>
      <span className="flex-1">{line.label}</span>
      <span
        className="text-[12px] tabular-nums muted-text shrink-0 mt-0.5"
        title="Sub-percentile within cluster peers"
      >
        {Math.round(line.subPct)} pct
      </span>
    </div>
  );
}
