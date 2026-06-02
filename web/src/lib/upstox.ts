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
 * NOTE on TS-side LTP fetching: equity LTP fan-out still lives in
 * scripts/intraday-refresh-ltp.py (Python, updates screener_meta + panel
 * cache). But the lightweight INDEX tick (NIFTY 50 / NIFTY BANK only) is
 * fetched server-side here via fetchIndexQuotes() — see the cron route at
 * /api/cron/intraday-index. Indices are just 2 instrument keys, so a small
 * native fetch beats spinning up a Python runner on a 15-min cadence.
 */
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { sql } from "@/lib/db";

const UPSTOX_DIALOG_BASE  = "https://api.upstox.com/v2/login/authorization/dialog";
const UPSTOX_TOKEN_URL    = "https://api.upstox.com/v2/login/authorization/token";
const UPSTOX_LTP_URL      = "https://api.upstox.com/v2/market-quote/ltp";

// Upstox instrument keys for the two headline indices we tick intraday.
// Stable, well-known constants (indices aren't in our app.upstox_instrument
// equity table). KEY = the Upstox instrument key we request by; VALUE = our
// internal index_code used everywhere else (market_index_history /
// market_index_intraday).
export const INDEX_INSTRUMENT_KEYS: Record<string, string> = {
  "NSE_INDEX|Nifty 50":   "NIFTY50",
  "NSE_INDEX|Nifty Bank": "NIFTYBANK",
};

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

/** Build the Upstox login dialog URL with a freshly-signed state token. */
export function buildLoginUrl(): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     env("UPSTOX_API_KEY"),
    redirect_uri:  env("UPSTOX_REDIRECT_URI"),
    state:         signState(),
  });
  return `${UPSTOX_DIALOG_BASE}?${params.toString()}`;
}

// ── Self-validating OAuth state ───────────────────────────────────────────
//
// We used to store the state in a cookie and compare on callback. iOS
// Safari's ITP blocked that cookie on the cross-site redirect back from
// upstox.com, surfacing as "state mismatch" errors on mobile.
//
// Switched to HMAC-signed state that carries its own validity envelope:
//   state = "<nonce>.<exp>.<mac>"
//   nonce  : 16 hex chars (random per login)
//   exp    : unix seconds, +5 min from issue
//   mac    : truncated HMAC-SHA256(nonce + "." + exp, SESSION_SECRET)
//
// On callback we recompute the MAC and compare constant-time; if it
// matches and exp hasn't passed, the state is from us and still valid.
// No cookie crosses the origin boundary.  Replay is bounded by the
// 5-minute exp window plus the fact that Upstox burns the `code` after
// one exchange.

const STATE_NAMESPACE = "upstox-state:";

function stateSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET missing — reused as the Upstox state signer");
  }
  return s;
}

function signState(): string {
  const nonce = randomBytes(8).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + 300;
  const body = `${nonce}.${exp}`;
  const mac = createHmac("sha256", stateSecret())
    .update(STATE_NAMESPACE + body)
    .digest("hex")
    .slice(0, 32);
  return `${body}.${mac}`;
}

export function verifyState(state: string | null | undefined): boolean {
  if (!state) return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expStr, macGiven] = parts;
  if (!/^[0-9a-f]+$/i.test(nonce) || !/^\d+$/.test(expStr)) return false;
  const expected = createHmac("sha256", stateSecret())
    .update(STATE_NAMESPACE + nonce + "." + expStr)
    .digest("hex")
    .slice(0, 32);
  if (macGiven.length !== expected.length) return false;
  const a = Buffer.from(macGiven, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (!timingSafeEqual(a, b)) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  return true;
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

// ── Intraday index LTP client ─────────────────────────────────────────────

export type IndexQuote = { index_code: string; ltp: number };

/** Thrown when the Upstox token is missing/expired — the cron route maps
 *  this to a soft 200 (no-op) so a missed morning reauth never trips the
 *  external pinger into retry storms. */
export class UpstoxTokenError extends Error {
  constructor(msg: string) { super(msg); this.name = "UpstoxTokenError"; }
}

/**
 * Fetch live LTP for the two headline indices from Upstox.
 *
 * Mirrors the Python equity path (scripts/intraday-refresh-ltp.py): one
 * GET /v2/market-quote/ltp with the instrument keys comma-joined, Bearer
 * auth. Upstox returns data keyed by an opaque string per instrument;
 * each value carries `instrument_token` (the canonical request key) plus
 * `last_price`. We map instrument_token → our internal index_code.
 *
 * Returns [] only if Upstox returns no usable rows; throws
 * UpstoxTokenError on 401 (expired token) so the caller can no-op cleanly.
 */
export async function fetchIndexQuotes(): Promise<IndexQuote[]> {
  const session = await loadSession();
  if (!session.access_token) {
    throw new UpstoxTokenError("Upstox access token missing — reauth at /api/upstox/login");
  }
  // Cheap expiry guard: our stored expires_at is the next 08:30 IST
  // boundary. If it's in the past the token is certainly dead.
  if (session.expires_at && new Date(session.expires_at) <= new Date()) {
    throw new UpstoxTokenError("Upstox access token expired — reauth at /api/upstox/login");
  }

  const keys = Object.keys(INDEX_INSTRUMENT_KEYS);
  const qs = new URLSearchParams({ instrument_key: keys.join(",") });
  const res = await fetch(`${UPSTOX_LTP_URL}?${qs.toString()}`, {
    method: "GET",
    headers: {
      "Accept":        "application/json",
      "Api-Version":   "2.0",
      "Authorization": `Bearer ${session.access_token}`,
    },
    // Never let a stale CDN/proxy answer a market-data call.
    cache: "no-store",
  });

  if (res.status === 401) {
    throw new UpstoxTokenError(`Upstox 401 — token rejected; reauth required`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Upstox LTP HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await res.json().catch(() => ({}))) as {
    status?: string;
    data?: Record<string, { instrument_token?: string; last_price?: number }>;
  };
  if (payload.status !== "success" || !payload.data) return [];

  const out: IndexQuote[] = [];
  for (const v of Object.values(payload.data)) {
    const reqKey = v.instrument_token;       // canonical "NSE_INDEX|Nifty 50"
    const code = reqKey ? INDEX_INSTRUMENT_KEYS[reqKey] : undefined;
    if (!code || typeof v.last_price !== "number") continue;
    out.push({ index_code: code, ltp: v.last_price });
  }
  return out;
}
