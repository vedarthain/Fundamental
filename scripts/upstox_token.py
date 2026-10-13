"""
upstox_token.py — the one place that decides which Upstox token to use.

WHY THIS FILE EXISTS

Upstox issues two kinds of credential and they fail in opposite ways:

  * The OAuth session token in app.upstox_session dies at 03:30 IST every
    night, and Upstox issues no refresh token and no headless login. An
    unattended job authenticating with it is dead by construction until a
    human opens a browser — the intraday feed ran silently dead for four
    trading days in Sept 2026 on exactly this.
  * The analytics token is one per account, valid a year, read-only GET,
    generated from the Developer Apps console with no redirect and no
    static-IP whitelist. That is what makes it usable from Vercel and GitHub
    runners with rotating egress IPs.

So every unattended caller must prefer the analytics token and keep the
session row only as a fallback. Commit 09d1593 did that for the intraday
pinger and for check-freshness — by writing the resolution logic twice, in
two scripts, with a third copy in TypeScript. fetch-ipos.py was not in that
diff and kept reading app.upstox_session unconditionally, so on 2026-10-12 it
failed with a token four days dead while the analytics token was fine. That
is the copied-rule failure CLAUDE.md warns about: the fix reached two of the
three copies and the third had no way to receive it.

One module now. The next caller imports it instead of reinventing the order.

THIS MUST STAY IN STEP WITH resolveMarketDataToken() IN web/src/lib/upstox.ts.
Both resolve the same two sources in the same order. A disagreement means a
cron route and a script authenticate as different principals against the same
API and write to the same columns.

WHAT THE ANALYTICS TOKEN CANNOT DO

It is read-only. Any caller that POSTs to Upstox — placing an order, for
instance — cannot use it and must keep the interactive session token. Nothing
in this repo does that today; every Upstox call here is a GET. If that changes,
the new caller does NOT belong on this resolver.
"""
from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def jwt_expiry(token: str) -> datetime | None:
    """`exp` out of a JWT, unverified.

    We are not authenticating anything — we are reading the issuer's stated
    expiry so it can be reported before it bites. Unparseable returns None and
    the caller should still USE the token: refusing a working credential
    because its shape changed turns a reporting gap into an outage.
    """
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        pad = "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + pad))
        exp = claims.get("exp")
        if not isinstance(exp, (int, float)):
            return None
        return datetime.fromtimestamp(float(exp), tz=timezone.utc)
    except Exception:
        return None


def analytics_token() -> str:
    """UPSTOX_ANALYTICS_TOKEN from the environment, else from .env.local.

    The .env.local fallback is what lets a script run by hand on this machine
    behave the same as the same script under CI, where the value arrives as an
    env var. Returns "" rather than None so callers can test truthiness without
    distinguishing unset from empty — an empty-string secret is unset.
    """
    v = (os.environ.get("UPSTOX_ANALYTICS_TOKEN") or "").strip()
    if v:
        return v
    p = REPO / ".env.local"
    if p.exists():
        for line in p.read_text().splitlines():
            if line.startswith("UPSTOX_ANALYTICS_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def load_token(conn) -> tuple[str | None, datetime | None]:
    """Returns (token, expires_at) for an Upstox GET, analytics first.

    `conn` is an open psycopg connection; it is only touched when no analytics
    token is configured, so a caller that has one never pays for the query.

    An analytics token past its stated expiry is returned ANYWAY, with its
    expiry, rather than silently falling back to the session row. The caller
    reports which credential is wrong. Falling back here would hide the one
    event this token exists to make rare, and at that point the daily token is
    almost certainly dead too — the user would be told to re-login, fix the
    wrong thing, and see the same failure tomorrow.
    """
    analytics = analytics_token()
    if analytics:
        return (analytics, jwt_expiry(analytics))

    with conn.cursor() as cur:
        cur.execute("SELECT access_token, expires_at FROM app.upstox_session WHERE id = 1")
        row = cur.fetchone()
    return (row[0], row[1]) if row else (None, None)


def token_source() -> str:
    """'analytics' or 'session' — for log lines and failure messages.

    Worth printing on every run. The 2026-10-12 failure was slow to diagnose
    because the error said "re-login at /admin/upstox" without saying which of
    the two credentials it had actually tried, and the obvious reading was that
    the migration had already happened.
    """
    return "analytics" if analytics_token() else "session"
