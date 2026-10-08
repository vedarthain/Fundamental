/**
 * withinPingerWindow is a cost guard: every fire it lets through wakes Neon
 * for five minutes, and every fire it rejects is a stretch of the trading day
 * where the site shows a stale price. Both directions of error are real, and
 * neither is visible from the outside — a band that is too wide shows up only
 * on the bill, and one that is too narrow only as prices that don't move.
 *
 * So the cadence is asserted here rather than left to the comment. The thing
 * these tests exist to catch is a band edit that silently doubles the wake
 * count (two fires landing in one band) or silently drops a slot.
 */
import { describe, it, expect } from "vitest";
import { withinPingerWindow } from "../marketHours";

/** A Date at the given IST wall-clock time. IST is UTC+5:30 with no DST, so
 *  the offset is a constant and this needs no timezone library. */
function ist(day: string, hh: number, mm: number): Date {
  return new Date(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`);
}

// 2026-10-08 is a Thursday; 2026-10-10 a Saturday, 2026-10-11 a Sunday.
const THU = "2026-10-08";
const SAT = "2026-10-10";
const SUN = "2026-10-11";

describe("withinPingerWindow", () => {
  it("accepts the 09:15 open — the slot the hourly :30 cadence missed", () => {
    expect(withinPingerWindow(ist(THU, 9, 15))).toBe(true);
  });

  it("accepts the 15:45 post-close slot that sees the settled close", () => {
    expect(withinPingerWindow(ist(THU, 15, 45))).toBe(true);
  });

  it("rejects the :00 and :30 fires, so the pinger's 15-min rate halves", () => {
    expect(withinPingerWindow(ist(THU, 11, 0))).toBe(false);
    expect(withinPingerWindow(ist(THU, 11, 30))).toBe(false);
  });

  it("takes exactly one fire per band from a :00-aligned 15-min pinger", () => {
    // The failure this guards: a band widened past 15 minutes admits two
    // consecutive fires, doubling Neon wake-ups with nothing to show for it.
    const accepted: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 15, 30, 45]) {
        if (withinPingerWindow(ist(THU, h, m))) accepted.push(`${h}:${m}`);
      }
    }
    expect(accepted).toEqual([
      "9:15", "9:45", "10:15", "10:45", "11:15", "11:45", "12:15", "12:45",
      "13:15", "13:45", "14:15", "14:45", "15:15", "15:45",
    ]);
    expect(accepted).toHaveLength(14);
  });

  it("absorbs pinger jitter inside a band but not beyond it", () => {
    expect(withinPingerWindow(ist(THU, 10, 24))).toBe(true);
    expect(withinPingerWindow(ist(THU, 10, 25))).toBe(false);
    expect(withinPingerWindow(ist(THU, 10, 54))).toBe(true);
    expect(withinPingerWindow(ist(THU, 10, 55))).toBe(false);
  });

  it("rejects everything before the open and after 15:45", () => {
    expect(withinPingerWindow(ist(THU, 8, 45))).toBe(false);
    expect(withinPingerWindow(ist(THU, 9, 0))).toBe(false);
    expect(withinPingerWindow(ist(THU, 16, 15))).toBe(false);
    expect(withinPingerWindow(ist(THU, 23, 45))).toBe(false);
  });

  it("rejects weekends regardless of the clock", () => {
    expect(withinPingerWindow(ist(SAT, 11, 15))).toBe(false);
    expect(withinPingerWindow(ist(SUN, 11, 45))).toBe(false);
  });
});
