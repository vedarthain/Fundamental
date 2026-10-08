/**
 * The half of the Upstox module that carries no database.
 *
 * WHY THIS FILE IS SEPARATE FROM lib/upstox.ts
 *
 * Same reason lib/verdictTypes.ts is separate from lib/verdict.ts: `upstox.ts`
 * imports `sql` from `@/lib/db`, which throws at import time without a
 * database URL in the environment. That makes every function in it — even a
 * pure string parser — unreachable from a unit test and from any context
 * without DB config.
 *
 * `jwtExpiry` is the advance-warning mechanism for a token that lasts a year.
 * A function whose whole job is to stop a silent annual outage, which cannot
 * itself be tested, is not a mechanism; it is a hope. So it lives here, where
 * a test can import it.
 *
 * Nothing here may import from `@/lib/db`.
 */

/**
 * Read the `exp` claim out of a JWT without verifying it.
 *
 * Deliberately not a signature check: we are not authenticating anything, we
 * are reading the issuer's own stated expiry so it can be reported before it
 * bites. A token we cannot parse yields `null` and is still used by callers —
 * refusing to use a working token because its shape changed would convert a
 * reporting gap into an outage.
 *
 * Mirrored by `_jwt_expiry` in scripts/check-freshness.py and `jwt_expiry` in
 * scripts/intraday-refresh-ltp.py. Verified against a live Upstox token: the
 * parsed exp matched the stored 03:30 IST expiry exactly.
 */
export function jwtExpiry(token: string): Date | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (typeof json.exp !== "number" || !Number.isFinite(json.exp)) return null;
    return new Date(json.exp * 1000);
  } catch {
    return null;
  }
}
