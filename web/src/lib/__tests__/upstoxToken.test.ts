/**
 * jwtExpiry is the only advance warning that the 1-year analytics token is
 * about to lapse. If it silently returns null the admin page and
 * check-freshness both degrade to "it will work until it doesn't" — which is
 * the state this whole change exists to leave behind. So it is pinned here
 * against a real Upstox token shape, and against the garbage inputs that
 * must NOT throw.
 */
import { describe, it, expect } from "vitest";
import { jwtExpiry } from "../upstoxToken";

/** A JWT with the given exp, signature irrelevant (we never verify it). */
function tokenWithExp(epochSeconds: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ typ: "JWT", alg: "HS256" })}.${b64({ sub: "85AX3T", exp: epochSeconds })}.sig`;
}

describe("jwtExpiry", () => {
  it("reads the exp claim as a Date", () => {
    // 2026-10-08T22:00:00Z — the real 03:30 IST boundary an Upstox daily
    // token carries, confirmed against the live stored token.
    const exp = Math.floor(Date.UTC(2026, 9, 8, 22, 0, 0) / 1000);
    expect(jwtExpiry(tokenWithExp(exp))?.toISOString()).toBe("2026-10-08T22:00:00.000Z");
  });

  it("returns null rather than throwing on anything unparseable", () => {
    for (const bad of ["", "garbage", "a.b", "a.b.c.d", "a.!!!.c"]) {
      expect(jwtExpiry(bad)).toBeNull();
    }
  });

  it("returns null when exp is absent or not a number", () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    expect(jwtExpiry(`x.${b64({ sub: "a" })}.y`)).toBeNull();
    expect(jwtExpiry(`x.${b64({ exp: "soon" })}.y`)).toBeNull();
  });
});
