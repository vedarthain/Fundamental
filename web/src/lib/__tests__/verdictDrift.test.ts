/**
 * The drift rules behind the Verdict tab.
 *
 * These exist because of a specific near-miss. The first version of `hasMoved`
 * treated "stored a value, live value is null" as a material change. On the
 * day the first 23 verdicts were loaded, `pct_above_200ema_252d` and
 * `ema_stack_bull` were written into the evidence from a live computation
 * while the newest metrics snapshot still carried nulls for both — so every
 * single verdict would have rendered "2 figures have moved" on launch.
 *
 * A panel that shouts on every row the day it ships teaches its reader to
 * ignore it, and ignoring it is the one outcome this whole feature exists to
 * prevent. CLAUDE.md §4: a fix must fail on the bug it fixes, so the first two
 * cases below are that exact input.
 */
import { describe, expect, it } from "vitest";
import { hasMoved, verdictBucket, type EvidenceValue } from "../verdictTypes";

describe("hasMoved — unverifiable is not the same as changed", () => {
  it("does not call a missing live value a move (the day-one bug)", () => {
    expect(hasMoved(0.1111, null)).toEqual({ moved: false, relPct: null, liveMissing: true });
    expect(hasMoved(0.0, null)).toEqual({ moved: false, relPct: null, liveMissing: true });
  });

  it("treats an absent stored value as unverifiable too", () => {
    expect(hasMoved(null, 0.5).liveMissing).toBe(true);
    expect(hasMoved(null, 0.5).moved).toBe(false);
  });

  it("does not let an unparseable live value masquerade as a change", () => {
    expect(hasMoved(40, "n/a").liveMissing).toBe(true);
    expect(hasMoved(40, "n/a").moved).toBe(false);
  });
});

describe("hasMoved — real movement is still caught", () => {
  it("flags a PE that moved past the relative threshold", () => {
    // The motivating example from migration 0086: written against PE 40, now 47.
    const r = hasMoved(40.0, 47.2);
    expect(r.moved).toBe(true);
    expect(r.liveMissing).toBe(false);
    expect(r.relPct).toBeCloseTo(0.18, 2);
  });

  it("ignores a move small enough that the prose still reads as rounded", () => {
    expect(hasMoved(40.0, 40.8).moved).toBe(false);
  });

  it("uses absolute points for 0..1 rates, so near-zero is not twitchy", () => {
    // 0.008 -> 0.02 is +150% relative and immaterial; it must not fire.
    expect(hasMoved(0.008, 0.02).moved).toBe(false);
    // 10 points -> 16 points is a real change in a rate.
    expect(hasMoved(0.1, 0.16).moved).toBe(true);
  });

  it("treats any boolean flip as material", () => {
    // ema_stack_bull is the entire content of two live upgrade triggers.
    expect(hasMoved(false, true).moved).toBe(true);
    expect(hasMoved(true, true).moved).toBe(false);
  });

  it("handles a stored zero without dividing by it", () => {
    expect(hasMoved(0, 0).moved).toBe(false);
    expect(hasMoved(0, 3).moved).toBe(true);
    expect(hasMoved(0, 3).relPct).toBeNull();
  });
});

describe("verdictBucket", () => {
  it("keeps a verdict that carries its own correction in the right bucket", () => {
    // The v3 report's most useful labels self-correct; an enum would have
    // flattened this back to "HOLD" and lost the downgrade.
    expect(verdictBucket("HOLD — downgraded from BUY, I was wrong")).toBe("hold");
    expect(verdictBucket("ACCUMULATE — upgraded")).toBe("buy");
    expect(verdictBucket("REDUCE — but watch for a turn")).toBe("sell");
    expect(verdictBucket("AVOID AT THIS PRICE")).toBe("sell");
    expect(verdictBucket("WATCH")).toBe("watch");
  });

  it("falls back to hold for an unrecognised label rather than throwing", () => {
    expect(verdictBucket("something nobody anticipated")).toBe("hold");
  });
});

describe("the shape the first real batch actually has", () => {
  // Guards the combination that was loaded on 7 Oct 2026 against the 4 Oct
  // metrics snapshot: technicals frozen from a live computation, the live
  // counterpart present as a key but null.
  const stored: Record<string, EvidenceValue> = {
    pe_ttm: 39.96,
    pct_above_200ema_252d: 0.0079,
    ema_stack_bull: 0.0,
  };
  const live: Record<string, EvidenceValue> = {
    pe_ttm: 39.96,
    pct_above_200ema_252d: null,
    ema_stack_bull: null,
  };

  it("reports nothing as moved, and two figures as unverifiable", () => {
    const rows = Object.keys(stored).map((k) => ({ k, ...hasMoved(stored[k], live[k]) }));
    expect(rows.filter((r) => r.moved)).toHaveLength(0);
    expect(rows.filter((r) => r.liveMissing).map((r) => r.k)).toEqual([
      "pct_above_200ema_252d",
      "ema_stack_bull",
    ]);
  });
});
