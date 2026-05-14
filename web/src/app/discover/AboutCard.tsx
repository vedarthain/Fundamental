"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

/** Compact explainer above the discover controls. Collapsed by default. */
export function AboutCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--color-paper)]/60 transition-colors text-left"
      >
        <div>
          <div className="text-[13px] font-medium">How to read this page</div>
          <div className="text-[12px] muted-text mt-0.5">
            Score-weighted discovery — every stock ranked against its peer cluster, not the whole market.
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`muted-text shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t hairline">
          <ol className="space-y-3 text-[13px] leading-relaxed">
            <NumberedItem n={1}>
              <strong>What this is.</strong> A score-weighted view of every actively-traded NSE
              stock. Each one is scored on Quality, Valuation, and Momentum within its{" "}
              <em>peer cluster</em> (private banks vs other private banks; cement vs other cement,
              etc.) — not the whole market.
            </NumberedItem>
            <NumberedItem n={2}>
              <strong>The two score columns.</strong>{" "}
              <em>Industry Score</em> is the platform default — a sector-tuned blend our scoring engine
              uses for that industry. A 75 here means top 25% within its peer group.
              <br />
              <em>Your Score</em> is the same three pillars re-weighted by{" "}
              <strong>your</strong> sliders above. A stock can have a low <em>Industry Score</em> but a high{" "}
              <em>Your Score</em> if your weights happen to favour what it&apos;s good at —
              and vice versa.
            </NumberedItem>
            <NumberedItem n={3}>
              <strong>How to use it.</strong> Pick a preset
              ({" "}
              <Tag>Compounders</Tag> · <Tag>Value</Tag> · <Tag>Momentum</Tag>
              {" "}
              ) or drag the sliders for a custom tilt. Narrow with sector → industry, maturity tier,
              and market-cap chips. Click any stock for the full breakdown.
            </NumberedItem>
            <NumberedItem n={4}>
              <strong>Why it matters.</strong> A 75 here means &quot;top 25% within its peer
              group&quot; — apples-to-apples. A small bank scoring 80 isn&apos;t being compared to
              HDFC Bank; it&apos;s being compared to other small banks. Same business, same scorecard,
              same peer-relative percentile.
            </NumberedItem>
          </ol>
        </div>
      )}
    </div>
  );
}

function NumberedItem({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[24px_1fr] gap-3">
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] tabular-nums font-medium mt-0.5"
        style={{
          backgroundColor: "var(--color-accent-50)",
          color: "var(--color-accent-700)",
        }}
      >
        {n}
      </span>
      <div>{children}</div>
    </li>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[11px] tabular-nums"
      style={{
        backgroundColor: "var(--color-accent-50)",
        color: "var(--color-accent-700)",
      }}
    >
      {children}
    </span>
  );
}
