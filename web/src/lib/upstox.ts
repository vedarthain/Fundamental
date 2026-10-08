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
 *      table). Upstox tokens expire daily at 03:30 IST.
 *
 * That daily expiry is why unattended market-data reads do NOT use this flow
 * by default — see resolveMarketDataToken() and the analytics token.
 *
 * Token-store table is single-row by design (CHECK id=1); we UPDATE in
 * place. See db/migrations/0026_upstox_session.sql for the schema.
 *
 * NOTE on TS-side LTP fetching: equity LTP fan-out still lives in
 * scripts/intraday-refresh-ltp.py (Python, updates screener_meta + panel
 * cache) and in the /api/cron/intraday-equity route via fetchLtpsByKeys().
 * The former intraday INDEX tick path (fetchIndexQuotes → market_index_intraday)
 * has been retired; daily index OHLC comes from scripts/fetch-indices.py
 * (NSE close CSV) into app.market_index_history.
 */
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { sql } from "@/lib/db";
import { jwtExpiry } from "@/lib/upstoxToken";

// Re-exported so callers that already reach for the Upstox module don't have
// to know about the DB-free split. New non-server callers should import from
// @/lib/upstoxToken directly — see that file's header.
export { jwtExpiry };

const UPSTOX_DIALOG_BASE  = "https://api.upstox.com/v2/login/authorization/dialog";
const UPSTOX_TOKEN_URL    = "https://api.upstox.com/v2/login/authorization/token";
const UPSTOX_LTP_URL      = "https://api.upstox.com/v2/market-quote/ltp";

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
 *  next 03:30 IST boundary because Upstox doesn't return an exp claim. */
export async function saveSession(tok: {
  access_token: string;
  user_id?: string;
  user_name?: string;
}): Promise<void> {
  const expiresAt = nextTokenExpiry();
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

/** Next 03:30 IST boundary (UTC = next 22:00 UTC). Used as the expiry hint
 *  when storing tokens — Upstox doesn't return one explicitly, but its daily
 *  access tokens die at 03:30 IST, so that IS the real expiry.
 *
 *  This used to snap to the next 08:30 IST boundary as a "re-auth every
 *  morning" nudge, and that silently killed the intraday pinger. Re-auth
 *  before 08:30 — which is exactly when you'd do it, since the point is to be
 *  ready for the open — and "next 08:30" resolves to THIS morning's, minutes
 *  away. The token was then marked dead before the pinger's first 09:30 pull,
 *  every pull that day no-opped (UpstoxTokenError maps to a soft 200), and
 *  prices silently froze at the previous EOD with no error anywhere. Observed:
 *  token refreshed 08:05 IST, expires_at 08:30 IST the same morning, zero
 *  intraday writes for four trading days.
 *
 *  Anchoring to the true 03:30 IST expiry means a token minted any time during
 *  a session covers the rest of that session, and re-auth timing can't
 *  accidentally shorten its life to minutes. */
function nextTokenExpiry(): Date {
  const now = new Date();
  // 22:00 UTC = 03:30 IST the following calendar day.
  const candidate = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 22, 0, 0,
  ));
  if (candidate <= now) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

// ── Intraday LTP client (equities) ────────────────────────────────────────

// Upstox accepts many instrument keys per /ltp call; we batch at 200 (well
// under their documented limit) — same chunk size the Python equity path
// used. ~11 calls for the full ~2,150-symbol universe.
const LTP_BATCH = 200;

/** Thrown when the Upstox token is missing/expired — cron routes map this
 *  to a soft 200 (no-op) so a missed morning reauth never trips the
 *  external pinger into retry storms. */
export class UpstoxTokenError extends Error {
  constructor(msg: string) { super(msg); this.name = "UpstoxTokenError"; }
}

/**
 * WHY THERE ARE TWO KINDS OF TOKEN
 *
 * The OAuth access token above cannot survive a night. Upstox issues no
 * refresh token and no non-interactive login — every access token dies at
 * 03:30 IST "regardless of the time it was generated", so an unattended
 * pinger is dead by definition until a human opens a browser. That is not a
 * hypothetical: the intraday feed ran silently dead for four trading days in
 * Sept 2026 on exactly this failure, and the only reason it surfaced was
 * someone noticing a price badge hadn't moved.
 *
 * Upstox's answer is the ANALYTICS TOKEN: one per account, 1-year validity,
 * read-only (GET requests only), generated straight from the Developer Apps
 * page with no authorization redirect. Market Quote — the only Upstox
 * endpoint this codebase calls — works with it and does NOT require a
 * whitelisted static IP, which matters because the callers run on Vercel and
 * GitHub runners with rotating egress IPs.
 *
 * So market-data reads prefer UPSTOX_ANALYTICS_TOKEN and fall back to the
 * daily session token. The fallback is kept rather than removed: it is what
 * makes setting the env var safe to do (and to undo) without a code change.
 *
 * What the analytics token CANNOT do: anything that is not a GET. Orders,
 * portfolio and user endpoints are out, and those also need a static IP. This
 * matters only if something later reaches for the token for a write — today
 * `fetchLtpsByKeys` is the sole consumer and it is a GET. Anything that posts
 * to Upstox must take the session token explicitly, not this resolver.
 *
 * And the §5 question — what keeps this current? A 1-year token nobody tracks
 * is just a silent outage scheduled twelve months out, which is strictly worse
 * than the daily one because the daily one at least taught you to notice. So
 * the expiry is parsed out of the JWT and surfaced: the admin page shows it
 * and check-freshness.py warns ahead of it. The token is not maintenance-free,
 * it is annual-maintenance, and the difference has to be visible somewhere.
 */
export type MarketDataToken = {
  token: string;
  source: "analytics" | "session";
  /** Parsed from the JWT `exp` claim (analytics) or the stored 03:30 IST
   *  boundary (session). Null when it could not be determined. */
  expiresAt: Date | null;
};

/**
 * Resolve the token to use for a market-data GET, preferring the long-lived
 * analytics token. Throws UpstoxTokenError when neither is usable.
 */
export async function resolveMarketDataToken(): Promise<MarketDataToken> {
  const analytics = process.env.UPSTOX_ANALYTICS_TOKEN?.trim();
  if (analytics) {
    const expiresAt = jwtExpiry(analytics);
    // An analytics token past its own stated expiry is not a reason to fall
    // back silently — falling back would hide the one event this token exists
    // to make rare, and the daily token is almost certainly dead too at that
    // point. Say which one is wrong.
    if (expiresAt && expiresAt <= new Date()) {
      throw new UpstoxTokenError(
        `UPSTOX_ANALYTICS_TOKEN expired ${expiresAt.toISOString().slice(0, 10)} — ` +
        "generate a new one in the Upstox Developer Apps console and update the env var",
      );
    }
    return { token: analytics, source: "analytics", expiresAt };
  }

  const session = await loadSession();
  if (!session.access_token) {
    throw new UpstoxTokenError(
      "No Upstox token: UPSTOX_ANALYTICS_TOKEN unset and no stored session — " +
      "set the analytics token, or reauth at /api/upstox/login",
    );
  }
  // Our stored expires_at is the next 03:30 IST boundary; past it = dead.
  if (session.expires_at && new Date(session.expires_at) <= new Date()) {
    throw new UpstoxTokenError(
      "Upstox session token expired (they die daily at 03:30 IST) — set " +
      "UPSTOX_ANALYTICS_TOKEN to stop needing a daily reauth, or reauth at /api/upstox/login",
    );
  }
  return {
    token: session.access_token,
    source: "session",
    expiresAt: session.expires_at ? new Date(session.expires_at) : null,
  };
}

/** Load the session and assert the token is present + not past its stored
 *  expiry. Throws UpstoxTokenError otherwise. */
async function requireFreshToken(): Promise<string> {
  return (await resolveMarketDataToken()).token;
}

/**
 * Low-level batched LTP fetch for arbitrary instrument keys.
 *
 * Mirrors the Python path (scripts/intraday-refresh-ltp.py): GET
 * /v2/market-quote/ltp with keys comma-joined, Bearer auth, chunked at 200.
 * Upstox echoes each instrument's canonical `instrument_token` + `last_price`;
 * we key the returned Map by instrument_token (what the caller requested by).
 *
 * Throws UpstoxTokenError on a 401 in the FIRST batch (whole token is dead);
 * a non-auth failure mid-run skips that chunk and keeps what we have, rather
 * than discarding a near-complete fetch.
 */
export async function fetchLtpsByKeys(keys: string[]): Promise<Map<string, number>> {
  const token = await requireFreshToken();
  const out = new Map<string, number>();

  for (let i = 0; i < keys.length; i += LTP_BATCH) {
    const chunk = keys.slice(i, i + LTP_BATCH);
    const qs = new URLSearchParams({ instrument_key: chunk.join(",") });
    let res: Response;
    try {
      res = await fetch(`${UPSTOX_LTP_URL}?${qs.toString()}`, {
        method: "GET",
        headers: {
          "Accept":        "application/json",
          "Api-Version":   "2.0",
          "Authorization": `Bearer ${token}`,
        },
        cache: "no-store",
      });
    } catch {
      if (i === 0) throw new Error("Upstox LTP fetch failed on first batch");
      continue; // transient mid-run network blip — keep partial results
    }

    if (res.status === 401) {
      // Auth is dead for every batch — no point continuing.
      throw new UpstoxTokenError("Upstox 401 — token rejected; reauth required");
    }
    if (!res.ok) {
      if (i === 0) {
        const body = await res.text().catch(() => "");
        throw new Error(`Upstox LTP HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      continue;
    }

    const payload = (await res.json().catch(() => ({}))) as {
      status?: string;
      data?: Record<string, { instrument_token?: string; last_price?: number }>;
    };
    if (payload.status !== "success" || !payload.data) continue;
    for (const v of Object.values(payload.data)) {
      const key = v.instrument_token;
      if (typeof key === "string" && typeof v.last_price === "number") {
        out.set(key, v.last_price);
      }
    }
  }
  return out;
}
