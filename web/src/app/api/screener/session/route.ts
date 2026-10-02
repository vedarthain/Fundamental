/**
 * POST /api/screener/session — log in to Screener.in and store the cookie.
 *
 * WHY THIS ROUTE EXISTS
 *
 * SCREENER_SESSIONID expired on Screener's schedule and lived in two places that
 * expired independently: .env.local on one laptop and this repo's GitHub
 * secrets. On 2026-10-02 the GitHub copy was found 33 days stale, having
 * silently broken four workflows, with 2,235 symbols due and 2,062 holding no
 * overview at all. Rotating by hand meant devtools, a file edit and two
 * `gh secret set` calls — and the step that got forgotten was the second place,
 * which is also the one nothing visibly depends on until a scheduled job fails
 * at 23:02 on a Wednesday. This route makes rotation one phone tap with no
 * laptop involved, and 0084 makes it one copy.
 *
 * WHY NOT WRITE THE GITHUB SECRET INSTEAD
 *
 * That was the original request and it is the wrong trade. Writing a repo secret
 * from here needs a PAT with secrets-write on vedarthain/Fundamental — a PUBLIC
 * repo — sitting in Vercel's environment, held by a public-facing app. A
 * non-expiring credential that can inject anything into CI, guarding a cookie
 * that expires on its own. app.screener_session needs no new credential at all:
 * every workflow already holds NEON_APP_URL.
 *
 * WHAT IT REFUSES TO DO
 *
 * 1. It will not store a cookie it has not PROVEN works. A successful login is
 *    not the proof — Screener's company pages render for anonymous visitors, so
 *    a page that looks right says nothing about whether we are authenticated.
 *    That mistake is exactly what made an earlier "the cookie is alive" check
 *    report a dead session as live. The proof is the Key Points fragment at
 *    /wiki/company/{id}/commentary/v2/, which 302s to the login page without a
 *    valid session. Nothing is written until that fragment comes back.
 * 2. It never stores the password, never logs it, and never returns it. The
 *    credentials exist for the duration of one request. A stored password would
 *    convert a self-expiring cookie into a permanent credential — the same
 *    mistake as the PAT, one layer down.
 * 3. It never returns the cookie value to the browser. The caller gets a verdict
 *    and a timestamp; the secret goes to Postgres and nowhere else.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://www.screener.in";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// A correct Key Points response is an XHR FRAGMENT: no <html> element and no
// Django CSRF field. Their presence means we were served a page instead — the
// login page, the register page, or any future interstitial — without having to
// enumerate which. Kept identical to build-company-overview.mjs's
// LOGGED_OUT_MARKER and check-freshness.py's _LOGGED_OUT_RE; all three must
// agree or this route will certify a cookie those scripts then reject.
const LOGGED_OUT_RE = /<html|csrfmiddlewaretoken|auth-partition/i;
const DATA_URL_RE = /data-url="(\/wiki\/company\/\d+\/commentary\/v2\/)"/;
const CSRF_FIELD_RE = /name="csrfmiddlewaretoken"\s+value="([^"]+)"/;

// Probing needs a company that definitely HAS a Key Points page, or a missing
// fragment is ambiguous. Large, long-covered names; the first that exposes a
// data-url is used. Deliberately a list and not one constant — a single symbol
// turns one delisting into a permanently broken rotation button.
const PROBE_SYMBOLS = ["RELIANCE", "INFY", "TCS", "HDFCBANK", "ITC"];

/** Pull one cookie's value out of a response's Set-Cookie headers. */
function readCookie(res: Response, name: string): string | null {
  // getSetCookie() is the only correct reader here — headers.get("set-cookie")
  // folds multiple cookies into one comma-joined string, and cookie values and
  // Expires attributes both contain commas, so splitting it is unparseable.
  const all = res.headers.getSetCookie?.() ?? [];
  for (const line of all) {
    const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(line);
    if (m && m[1]) return m[1];
  }
  return null;
}

type LoginResult =
  | { ok: true; sessionid: string; csrftoken: string; status: number }
  | { ok: false; error: string };

async function screenerLogin(username: string, password: string): Promise<LoginResult> {
  const page = await fetch(`${BASE}/login/`, { headers: { "User-Agent": UA } });
  if (!page.ok) return { ok: false, error: `GET /login/ returned HTTP ${page.status}` };

  const html = await page.text();
  const tokenMatch = CSRF_FIELD_RE.exec(html);
  if (!tokenMatch) {
    return {
      ok: false,
      error:
        "no csrfmiddlewaretoken on Screener's login page — either the form " +
        "changed or an interstitial was served instead of the login page",
    };
  }
  const formToken = tokenMatch[1];
  const cookieToken = readCookie(page, "csrftoken") ?? formToken;

  const body = new URLSearchParams({
    csrfmiddlewaretoken: formToken,
    username,
    password,
    next: "/dash/",
  });

  // Two things Django insists on and neither is the token: the csrftoken COOKIE
  // must accompany the form field (double-submit), and over HTTPS the Referer
  // must be same-origin or the POST is rejected regardless of a correct token.
  // redirect:"manual" because a successful login 302s and following it would
  // discard the Set-Cookie we came for.
  const resp = await fetch(`${BASE}/login/`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE}/login/`,
      Cookie: `csrftoken=${cookieToken}`,
    },
    body,
  });

  // TWO SIGNALS, BOTH NEEDED, MEASURED AGAINST THE REAL ENDPOINT 2026-10-02.
  //
  // Posting a non-existent account returns HTTP 200 with NO sessionid: Django
  // re-renders the form with a field error rather than 4xx-ing, so the status
  // code alone cannot distinguish a wrong password from success. A successful
  // login redirects (302) to `next`.
  //
  // Neither signal is sufficient on its own. "sessionid was issued" is not proof
  // of authentication — Django will hand an anonymous session to a failed
  // attempt whenever the login view touches request.session, which is why the
  // first version of this route reported a rejected password as an
  // unauthenticated cookie and sent the operator looking at the probe. Requiring
  // a redirect AS WELL names the real failure.
  const sessionid = readCookie(resp, "sessionid");
  const redirected = resp.status >= 300 && resp.status < 400;
  if (!sessionid || !redirected) {
    return {
      ok: false,
      error:
        `Screener rejected those credentials (HTTP ${resp.status}, ` +
        `session cookie ${sessionid ? "issued" : "not issued"}). A successful ` +
        `login redirects; this re-rendered the login form. Check the email and ` +
        `password — nothing was stored.`,
    };
  }
  return {
    ok: true,
    sessionid,
    status: resp.status,
    csrftoken: readCookie(resp, "csrftoken") ?? cookieToken,
  };
}

type ProbeResult = { ok: true; symbol: string; bytes: number } | { ok: false; error: string };

/**
 * Prove the cookie is authenticated. Anonymous visitors can read Screener
 * company pages, so only the login-gated Key Points fragment settles it.
 */
async function probe(sessionid: string, csrftoken: string): Promise<ProbeResult> {
  const headers = {
    "User-Agent": UA,
    Cookie: `sessionid=${sessionid}; csrftoken=${csrftoken}`,
  };
  for (const symbol of PROBE_SYMBOLS) {
    const pageUrl = `${BASE}/company/${symbol}/consolidated/`;
    const page = await fetch(pageUrl, { headers });
    const m = DATA_URL_RE.exec(await page.text());
    if (!m) continue;

    // X-Requested-With and Referer are NOT decoration. build-company-overview.mjs
    // sends both on this exact request and is the thing this probe exists to
    // predict; a probe that asks differently can certify a cookie that script
    // then rejects, or reject one it would have accepted. The headers are part
    // of the contract, not of the transport.
    const res = await fetch(BASE + m[1], {
      headers: { ...headers, "X-Requested-With": "XMLHttpRequest", Referer: pageUrl },
    });
    const frag = await res.text();
    if (LOGGED_OUT_RE.test(frag)) {
      return {
        ok: false,
        error:
          `logged in, but the Key Points fragment for ${symbol} came back as a ` +
          `full page (HTTP ${res.status}, ${frag.length} bytes), which only ` +
          `happens for an unauthenticated request. The account logged in but ` +
          `does not appear to have Key Points access. Nothing was stored.`,
      };
    }
    if (frag.length < 200) {
      return {
        ok: false,
        error: `Key Points fragment for ${symbol} was only ${frag.length} bytes. Nothing was stored.`,
      };
    }
    return { ok: true, symbol, bytes: frag.length };
  }
  return {
    ok: false,
    error:
      "no probe symbol exposed a Key Points data-url, so the session cannot be " +
      "verified. Nothing was stored.",
  };
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });
  }

  let username = "";
  let password = "";
  try {
    const body = await req.json();
    username = String(body?.username ?? "").trim();
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "expected a JSON body" }, { status: 400 });
  }
  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: "both the Screener email and password are required" },
      { status: 400 },
    );
  }

  let login: LoginResult;
  try {
    login = await screenerLogin(username, password);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `could not reach Screener: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  if (!login.ok) return NextResponse.json({ ok: false, error: login.error }, { status: 400 });

  let verified: ProbeResult;
  try {
    verified = await probe(login.sessionid, login.csrftoken);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `could not verify the new session: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  // FAILS CLOSED. An unverified cookie is worse than no cookie: it looks like a
  // successful rotation, so nobody looks again until a scheduled job dies.
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: 502 });

  await sql`
    UPDATE app.screener_session
       SET sessionid       = ${login.sessionid},
           csrftoken       = ${login.csrftoken},
           verified_at     = now(),
           verified_symbol = ${verified.symbol},
           updated_at      = now(),
           updated_by      = 'admin-page'
     WHERE id = 1
  `;

  // No cookie value in the response. The caller needs to know it worked, not
  // what the secret is.
  return NextResponse.json({
    ok: true,
    verified_symbol: verified.symbol,
    fragment_bytes: verified.bytes,
    verified_at: new Date().toISOString(),
  });
}
