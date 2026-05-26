/**
 * Auth helpers — session cookie sign/verify + getSession().
 *
 * Stateless session: the cookie payload is `{userId, exp}` HMAC-SHA256
 * signed with SESSION_SECRET. There is NO session table — verifying a
 * request is a single hash compute, not a DB round-trip. This keeps Rule
 * #1 happy (zero extra Neon reads per authenticated request).
 *
 * The cookie is httpOnly + Secure + SameSite=Lax, set on `/`, 30-day
 * expiry. We do NOT issue refresh tokens; if the cookie expires the user
 * just signs in again. For a watchlist app this is fine — there's nothing
 * to revoke server-side, and we'd rather force a fresh login than carry a
 * long-lived token.
 *
 * The signed payload is base64url(JSON) + "." + base64url(hmac). We don't
 * use JWT to avoid the JWT-library footgun surface (alg confusion etc.) —
 * a 40-line HMAC implementation has fewer ways to go wrong.
 *
 * SESSION_SECRET must be set in env. Pick a 32+ byte random string.
 */
import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { sql } from "@/lib/db";

const COOKIE_NAME = "er_session";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

export type SessionPayload = {
  userId: number;
  exp: number; // unix seconds
};

export type SessionUser = {
  id: number;
  email: string;
  displayName: string | null;
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "SESSION_SECRET missing or too short (need >=16 chars) — set in .env.local",
    );
  }
  return s;
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signSession(payload: SessionPayload): string {
  const body = b64urlEncode(JSON.stringify(payload));
  const mac = createHmac("sha256", secret()).update(body).digest();
  return `${body}.${b64urlEncode(mac)}`;
}

export function verifySession(token: string): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const macGiven = token.slice(dot + 1);
  const macExpected = b64urlEncode(
    createHmac("sha256", secret()).update(body).digest(),
  );
  // Constant-time compare to dodge timing-leak signature forgery.
  const a = Buffer.from(macGiven);
  const b = Buffer.from(macExpected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { userId?: unknown }).userId !== "number" ||
    typeof (parsed as { exp?: unknown }).exp !== "number"
  ) {
    return null;
  }
  const p = parsed as SessionPayload;
  if (p.exp < Math.floor(Date.now() / 1000)) return null;
  return p;
}

/** Issue a fresh session cookie for `userId`. Called from login/signup routes. */
export async function setSessionCookie(userId: number): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const token = signSession({ userId, exp });
  const c = await cookies();
  c.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

/** Clear the session cookie. */
export async function clearSessionCookie(): Promise<void> {
  const c = await cookies();
  c.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Read the current session from the incoming request's cookies.
 *
 * Returns the verified payload (just the userId — does NOT fetch the user
 * row). For pages/routes that only need to know "is someone logged in"
 * this is zero-cost. For pages that need email/display name, call
 * getSessionUser() below which adds one indexed SELECT.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const c = await cookies();
  const raw = c.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return verifySession(raw);
}

/** Like getSession but also pulls the user row. One indexed lookup. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const s = await getSession();
  if (!s) return null;
  const rows = await sql<{ id: number; email: string; display_name: string | null }[]>`
    SELECT id, email::text AS email, display_name
      FROM app.users
     WHERE id = ${s.userId}
     LIMIT 1
  `;
  const u = rows[0];
  if (!u) return null;
  return { id: u.id, email: u.email, displayName: u.display_name };
}
