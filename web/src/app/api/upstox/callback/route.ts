/**
 * GET /api/upstox/callback — completes the Upstox OAuth handshake.
 *
 * Upstox redirects here after the user grants access on their dialog
 * page.  Query carries:
 *   ?code=<authz_code>   — short-lived, exchanged for an access_token
 *   &state=<csrf_token>  — must match the cookie we set in /login
 *
 * Success path:
 *   1. Verify state matches the httpOnly cookie (CSRF defence).
 *   2. POST /v2/login/authorization/token with code + api_secret.
 *   3. Persist the resulting access_token to app.upstox_session.
 *   4. Render a tiny success page so the admin can confirm.
 *
 * Failure path: clear human-readable error in the response; no token
 * is persisted; cookie is cleared either way.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, saveSession } from "@/lib/upstox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "upstox_oauth_state";

function pageHtml({ title, body }: { title: string; body: string }): string {
  // Inlined CSS keeps the page useful without any client JS or framework
  // bundle.  Matches the platform's existing earthy palette loosely.
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${title} · EquityRoots</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#f7f5ee;color:#1a1f36;margin:0;padding:48px 24px;line-height:1.5}
  .card{max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e2da;
        border-radius:8px;padding:28px 32px}
  h1{font-family:Georgia,serif;font-size:22px;margin:0 0 8px;letter-spacing:-.01em}
  p{margin:0 0 12px;font-size:13.5px}
  code{background:#f0ede4;padding:1px 6px;border-radius:4px;font-size:12px}
  a{color:#3d7536;text-decoration:none;font-weight:500}
  a:hover{text-decoration:underline}
  .ok{color:#1f5a23}.err{color:#9c2a2a}
</style></head>
<body><div class="card">${body}</div></body></html>`;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const errFromUpstox = sp.get("error") || sp.get("error_description");

  const c = await cookies();
  const cookieState = c.get(STATE_COOKIE)?.value ?? "";

  // Always clear the CSRF cookie — single-use.
  const clearCookie = (res: NextResponse) =>
    res.cookies.set({ name: STATE_COOKIE, value: "", maxAge: 0, path: "/" });

  // 1. Upstox-side error (user denied, etc.)
  if (errFromUpstox) {
    const res = new NextResponse(
      pageHtml({
        title: "Upstox auth failed",
        body: `<h1 class="err">Upstox returned an error</h1>
               <p><code>${escapeHtml(errFromUpstox)}</code></p>
               <p><a href="/api/upstox/login">Try again</a></p>`,
      }),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
    clearCookie(res);
    return res;
  }

  // 2. State mismatch (CSRF or expired cookie)
  if (!state || !cookieState || state !== cookieState) {
    const res = new NextResponse(
      pageHtml({
        title: "Upstox state mismatch",
        body: `<h1 class="err">State mismatch</h1>
               <p>The OAuth state cookie did not match. This usually means
               the callback was opened from a different browser session,
               or the cookie expired (5 min window).</p>
               <p><a href="/api/upstox/login">Start again</a></p>`,
      }),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
    clearCookie(res);
    return res;
  }

  // 3. Missing code
  if (!code) {
    const res = new NextResponse(
      pageHtml({
        title: "Upstox missing code",
        body: `<h1 class="err">No authorisation code</h1>
               <p>Upstox redirected back without a code parameter.
               <a href="/api/upstox/login">Retry the login</a>.</p>`,
      }),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
    clearCookie(res);
    return res;
  }

  // 4. Exchange + persist
  try {
    const tok = await exchangeCode(code);
    await saveSession(tok);

    const res = new NextResponse(
      pageHtml({
        title: "Upstox connected",
        body: `<h1 class="ok">Upstox connected ✓</h1>
               <p>Token saved for <code>${escapeHtml(tok.user_name ?? tok.user_id ?? "this app")}</code>.
               Intraday refresh script can now fetch live LTPs until the next 08:30 IST expiry.</p>
               <p>You can close this tab.</p>`,
      }),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
    clearCookie(res);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[upstox/callback] exchange failed:", e);
    const res = new NextResponse(
      pageHtml({
        title: "Upstox exchange failed",
        body: `<h1 class="err">Token exchange failed</h1>
               <p><code>${escapeHtml(msg)}</code></p>
               <p>Check that <code>UPSTOX_API_KEY</code>, <code>UPSTOX_API_SECRET</code>,
               and <code>UPSTOX_REDIRECT_URI</code> are set correctly in the
               environment, then <a href="/api/upstox/login">retry</a>.</p>`,
      }),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
    clearCookie(res);
    return res;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
