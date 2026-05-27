/**
 * Upstox API helpers — OAuth + token storage + thin LTP client.
 *
 * Auth flow (OAuth 2.0 authorization-code variant):
 *   1. Admin hits /api/upstox/login → we build the Upstox dialog URL with
 *      our api_key, redirect_uri, and a CSRF state cookie.
 *   2. Browser redirects to Upstox, user authenticates + consents.
 *   3. Upstox redirects back to /api/upstox/callback?code=...&state=...
 *   4. Callback exchanges `code` + `api_secret` for an `access_token` via
 *      POST https://api.upstox.com/v2/login/authorization/token.
 *   5. Token + identity are written into app.upstox_session (single-row
 *      table). Tokens expire daily at ~08:30 IST.
 *
 * Token-store table is single-row by design (CHECK id=1); we UPDATE in
 * place. See db/migrations/0026_upstox_session.sql for the schema.
 *
 * NOTE on TS-side LTP fetching: we DON'T currently call the LTP API from
 * the Next.js process — that lives in scripts/intraday-refresh-ltp.py
 * (Python, fan-out to update screener_meta + panel cache + snapshot).
 * This module is just OAuth.
 */
import "server-only";
import { sql } from "@/lib/db";

const UPSTOX_DIALOG_BASE  = "https://api.upstox.com/v2/login/authorization/dialog";
const UPSTOX_TOKEN_URL    = "https://api.upstox.com/v2/login/authorization/token";

export type UpstoxSession = {
  access_token: string | null;
  upstox_user_id: string | null;
  upstox_user_name: string | null;
  expires_at: string | null;
  refreshed_at: string | null;
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing from environment`);
  return v;
}

/** Build the Upstox login dialog URL. Caller is responsible for setting a
 *  CSRF `state` cookie before redirecting. */
export function buildLoginUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     env("UPSTOX_API_KEY"),
    redirect_uri:  env("UPSTOX_REDIRECT_URI"),
    state,
  });
  return `${UPSTOX_DIALOG_BASE}?${params.toString()}`;
}

/** Exchange the authorisation code for an access token. */
export async function exchangeCode(code: string): Promise<{
  access_token: string;
  user_id?: string;
  user_name?: string;
  email?: string;
  expires_in?: number;
}> {
  const body = new URLSearchParams({
    code,
    client_id:     env("UPSTOX_API_KEY"),
    client_secret: env("UPSTOX_API_SECRET"),
    redirect_uri:  env("UPSTOX_REDIRECT_URI"),
    grant_type:    "authorization_code",
  });

  const res = await fetch(UPSTOX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Accept":       "application/json",
      "Api-Version":  "2.0",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  // Upstox returns 200 + JSON on success; 400 + JSON error body otherwise.
  let payload: Record<string, unknown> = {};
  try { payload = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    const errMsg = typeof payload.errors === "object"
      ? JSON.stringify(payload.errors)
      : (payload.error_description ?? payload.message ?? `HTTP ${res.status}`);
    throw new Error(`Upstox token exchange failed: ${errMsg}`);
  }
  if (typeof payload.access_token !== "string") {
    throw new Error("Upstox token exchange returned no access_token");
  }
  return {
    access_token: payload.access_token,
    user_id:   typeof payload.user_id   === "string" ? payload.user_id   : undefined,
    user_name: typeof payload.user_name === "string" ? payload.user_name : undefined,
    email:     typeof payload.email     === "string" ? payload.email     : undefined,
    expires_in: typeof payload.expires_in === "number" ? payload.expires_in : undefined,
  };
}

/** Persist token + identity to app.upstox_session.  Expiry is set to the
 *  next 08:30 IST boundary because Upstox doesn't return an exp claim. */
export async function saveSession(tok: {
  access_token: string;
  user_id?: string;
  user_name?: string;
}): Promise<void> {
  const expiresAt = next0830Ist();
  await sql`
    UPDATE app.upstox_session
       SET access_token     = ${tok.access_token},
           upstox_user_id   = ${tok.user_id ?? null},
           upstox_user_name = ${tok.user_name ?? null},
           expires_at       = ${expiresAt.toISOString()},
           refreshed_at     = NOW()
     WHERE id = 1
  `;
}

/** Read the current session. May be empty / expired — callers check. */
export async function loadSession(): Promise<UpstoxSession> {
  const rows = await sql<UpstoxSession[]>`
    SELECT access_token,
           upstox_user_id,
           upstox_user_name,
           expires_at::text   AS expires_at,
           refreshed_at::text AS refreshed_at
      FROM app.upstox_session
     WHERE id = 1
  `;
  return rows[0] ?? {
    access_token: null, upstox_user_id: null, upstox_user_name: null,
    expires_at: null, refreshed_at: null,
  };
}

/** Next 08:30 IST boundary (UTC = next 03:00 UTC).  Used as the expiry
 *  hint when storing tokens — Upstox doesn't return one explicitly. */
function next0830Ist(): Date {
  const now = new Date();
  // 03:00 UTC = 08:30 IST.
  const candidate = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0,
  ));
  if (candidate <= now) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}
