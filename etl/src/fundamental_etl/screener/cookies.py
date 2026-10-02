"""Resolve the Screener session cookie — database first, environment second.

WHY DB FIRST

Until 0084 the cookie lived in two places that expired independently: .env.local
on one laptop and this repo's GitHub secrets. On 2026-10-02 the GitHub copy was
found 33 days stale, having silently broken four workflows. The fix is not a
better reminder, it is one copy: app.screener_session, which every workflow
already has a connection to. Rotating it is then a single write, and there is no
second place to forget.

WHY THE ENVIRONMENT IS STILL READ

Three reasons, all real:

  1. The table is new. A workflow that runs before 0084 is applied, or against a
     database that does not have it, must not hard-fail on a missing relation.
  2. Overriding by hand is how you test a suspect cookie without writing it to
     the shared row that four scheduled jobs read.
  3. web-ci and anything running without APP_DB_URL cannot reach the table at
     all.

So: env wins ONLY when the table has nothing. An explicitly set SCREENER_SESSIONID
does not silently shadow a freshly rotated row — that would recreate exactly the
two-sources-of-truth bug this module exists to remove. The precedence is stated
here once so the four call sites cannot drift apart.

WHAT THIS DOES NOT DO

It does not validate the cookie. Screener's company pages render for anonymous
visitors, so only the login-gated Key Points fragment can tell a live session
from a dead one, and that probe belongs to the writer (scripts/screener-session.py,
/api/screener/session) and to the morning check (check-freshness.py), not to
every reader. A reader that validated on each call would make a login-gated HTTP
request per process start and still be stale by the next one.
"""
from __future__ import annotations

import os

from ..log import log


def resolve() -> tuple[str, str, str]:
    """Return (sessionid, csrftoken, source).

    `source` is "db", "env" or "none" — logged by callers so a failure says
    WHICH copy was in play. Empty strings mean nothing was found anywhere;
    raising is the caller's decision, because a run with
    --no-screener-fallback legitimately needs no cookie at all.
    """
    sid, csrf = _from_db()
    if sid and csrf:
        return sid, csrf, "db"

    sid = os.environ.get("SCREENER_SESSIONID", "") or ""
    csrf = os.environ.get("SCREENER_CSRFTOKEN", "") or ""
    if sid and csrf:
        return sid, csrf, "env"
    return "", "", "none"


def _from_db() -> tuple[str, str]:
    """Read the singleton row, returning blanks on ANY failure.

    Deliberately swallows everything: no APP_DB_URL, the remote-write guard
    refusing, the table not existing yet, the network being down. A reader that
    crashed here would take out jobs that would otherwise have run fine on the
    environment copy, and the cookie is not the thing those jobs are about. The
    failure is logged at debug so it is findable without being noise.
    """
    try:
        from ..db import app_conn

        with app_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT sessionid, csrftoken FROM app.screener_session WHERE id = 1"
            )
            row = cur.fetchone()
    except Exception as exc:  # noqa: BLE001 — see docstring
        log.debug("screener_cookie_db_unavailable", error=str(exc)[:200])
        return "", ""

    if not row:
        return "", ""
    # app_conn() hands back dict_row, not tuples — indexing by position raises
    # KeyError here, which the except above would have swallowed into a silent
    # "no cookie in the database" and a silent fall back to the stale env copy.
    # Exactly the invisible-degradation shape this module was written to remove.
    return (row["sessionid"] or ""), (row["csrftoken"] or "")
