#!/usr/bin/env python3
"""Log in to Screener and rotate the session cookie everywhere it is used.

    etl/.venv/bin/python scripts/screener-session.py           # .env.local + DB
    etl/.venv/bin/python scripts/screener-session.py --local   # .env.local only
    etl/.venv/bin/python scripts/screener-session.py --check    # probe, change nothing

THE BUTTON IS THE PRIMARY PATH, THIS IS THE FALLBACK
----------------------------------------------------
/admin/screener does the same login, the same proof and the same write, from a
phone, with no credentials on disk. This script exists for when the web app is
the thing that is broken, and because a CLI is easier to run under a debugger
than a route. Both write app.screener_session (migration 0084), which is the one
copy every workflow reads — so they cannot disagree about where the cookie lives.

WHY THIS EXISTS
---------------
SCREENER_SESSIONID expires on Screener's schedule, not ours, and it used to live
in two places that expired independently: .env.local on this machine and the
repo's GitHub secrets. On 2026-10-02 the GitHub copy was found 33 days stale,
having silently broken four workflows — refresh-company-overview,
refresh-company-info, refresh-shareholding and the Screener scrape inside
weekly-fetch — with a backlog of 2,235 symbols due and 2,062 holding no overview
at all. The local copy turned out to be dead too. Rotating by hand meant finding
the cookie in devtools, editing a file, and remembering `gh secret set` twice;
the step people forget is the second place, which is also the one nothing
visibly depends on until a scheduled job fails at 23:02 on a Wednesday.

Migration 0084 collapsed those copies into app.screener_session, so there is now
one row to rotate and no GitHub secret to forget.

WHY A LOGIN AND NOT A COOKIE EXTRACT
------------------------------------
The obvious alternative is to read the live cookie out of Chrome's store. On
macOS that means Keychain access and an AES-CBC decrypt, it breaks when Chrome
changes its storage, and it only works on the one machine with the browser.
Screener's login is a plain Django form — measured 2026-10-02, GET /login/
returns 200 with a csrfmiddlewaretoken field and fields named `username` and
`password`, no captcha and no Cloudflare interstitial. A scripted login is
simpler, works headless, and is the same thing the browser does.

WHAT IT REFUSES TO DO
---------------------
It will not write a cookie it has not PROVEN works. Logging in successfully is
not the proof: Screener's company pages render for anonymous visitors, so a page
that looks right says nothing about whether we are authenticated — that mistake
is what made an earlier "the cookie is alive" check wrong, because it tested the
public About blurb. The proof used here is the Key Points fragment at
/wiki/company/{id}/commentary/v2/, which 302s to the login page without a valid
session. Nothing is written until that fragment comes back.

It also never prints a cookie value, and never writes credentials anywhere. The
only artefacts are .env.local (already gitignored) and the app.screener_session
row.

ON PUTTING THE PASSWORD IN CI — DECIDED YES, 2026-10-06
-------------------------------------------------------
This section used to say "deliberately not done", on the grounds that a
reusable credential in CI is worse than a cookie that expires on its own. The
tradeoff was left open for an owner to settle. Deb settled it on 2026-10-06,
and the reason is that the premise had been measured wrong.

"Expires on its own" was assumed to mean roughly monthly. It does not. The
cookie rotated at 2026-10-03 00:13 IST was dead by 2026-10-06 00:41 UTC —
THREE DAYS — after working for the 10-03 and 10-04 runs. Verified by hand
against RELIANCE's own Key Points fragment, not just the failing probe symbol,
so it was the session and not one company's page. At that cadence a human
rotation is not a monthly chore, it is a standing outage: four scheduled jobs
break, each opens an issue, and the backlog they exist to drain stops draining.

So the cost of NOT having credentials in CI is a pipeline that is broken more
often than it works. The credential is scoped to a free read-only data account
with no payment method and no write access to anything of ours, and it buys a
job that repairs itself. That is the trade, stated so the next reader can
re-open it rather than rediscover it.

What did NOT change: there is still exactly ONE copy of the cookie, in
app.screener_session. `--ensure` writes that row and nothing else. The bug this
file was created to kill was two copies expiring independently, and putting the
PASSWORD in CI does not resurrect it — a password is not a second cookie.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / ".env.local"

BASE = "https://www.screener.in"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# Same markers as build-company-overview.mjs and check-freshness.py. A correct
# Key Points response is an XHR fragment: no <html> element, no Django CSRF
# field. Their presence means we were served a page instead.
LOGGED_OUT_RE = re.compile(r"<html|csrfmiddlewaretoken|auth-partition", re.I)
DATA_URL_RE = re.compile(r'data-url="(/wiki/company/\d+/commentary/v2/)"')
CSRF_FIELD_RE = re.compile(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"')

# Probing needs a company that definitely HAS a Key Points page, or a missing
# fragment is ambiguous. These are large, long-covered names; the first that
# exposes a data-url is used. Deliberately a list and not one symbol — a single
# constant turns one delisting into a permanently broken rotation tool.
PROBE_SYMBOLS = ("RELIANCE", "INFY", "TCS", "HDFCBANK", "ITC")


def fail(msg: str) -> None:
    print(f"FAILED: {msg}", file=sys.stderr)
    sys.exit(1)


def read_env(path: Path) -> dict[str, str]:
    """Minimal .env reader — KEY=VALUE, ignoring blanks, comments and `export`."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k = k.strip().removeprefix("export ").strip()
        out[k] = v.strip().strip('"').strip("'")
    return out


def login(email: str, password: str) -> tuple[str, str]:
    """Return (sessionid, csrftoken). Raises SystemExit with a reason on failure."""
    with httpx.Client(timeout=30.0, follow_redirects=True,
                      headers={"User-Agent": UA}) as c:
        page = c.get(f"{BASE}/login/")
        if page.status_code != 200:
            fail(f"GET /login/ → HTTP {page.status_code}")
        m = CSRF_FIELD_RE.search(page.text)
        if not m:
            fail("no csrfmiddlewaretoken on /login/ — the form changed, or an "
                 "interstitial was served instead of the login page")
        token = m.group(1)

        # Django rejects a POST whose Referer is not the same origin when the
        # connection is HTTPS, regardless of the CSRF token being correct.
        resp = c.post(
            f"{BASE}/login/",
            data={"csrfmiddlewaretoken": token, "username": email,
                  "password": password, "next": "/dash/"},
            headers={"Referer": f"{BASE}/login/"},
        )
        sid = c.cookies.get("sessionid")
        csrf = c.cookies.get("csrftoken")
        # TWO SIGNALS, BOTH NEEDED (measured 2026-10-02). A non-existent account
        # returns HTTP 200 with no sessionid — Django re-renders the form rather
        # than 4xx-ing, so status alone cannot separate a wrong password from
        # success. But "a sessionid was issued" is not proof either: Django hands
        # an anonymous session to a failed attempt whenever the login view
        # touches request.session. Only a redirect AND a session cookie together
        # mean we are in. Accepting one of them reports a rejected password as
        # an unauthenticated cookie and sends you looking at the wrong thing.
        # follow_redirects=True, so a successful login shows up as a non-empty
        # .history with a final 200 — not as a 302 status.
        if not sid or (not resp.history and resp.status_code == 200):
            fail(f"Screener rejected those credentials (HTTP {resp.status_code}, "
                 f"session cookie {'issued' if sid else 'not issued'}). A "
                 f"successful login redirects; this re-rendered the login form.")
        return sid, csrf or token


def probe(sid: str, csrf: str, strict: bool = True) -> str | None:
    """Prove the cookie is authenticated. Returns a short description on success.

    Anonymous visitors can read Screener company pages, so only the login-gated
    Key Points fragment settles the question.

    `strict` is the difference between the two callers. After a login, a failed
    probe is fatal — it means we are about to store a cookie we cannot prove,
    which is the one thing this script refuses to do. For `--ensure`, a failed
    probe is the NORMAL case it exists to handle: it must return None so the
    caller can log in, not exit the process. Passing strict=False for the
    post-login probe would silently reintroduce writing unverified cookies.
    """
    def no(msg: str) -> None:
        if strict:
            fail(msg)
        print(f"  probe: {msg}")

    headers = {"User-Agent": UA, "Cookie": f"sessionid={sid}; csrftoken={csrf}"}
    with httpx.Client(timeout=30.0, follow_redirects=True, headers=headers) as c:
        for sym in PROBE_SYMBOLS:
            try:
                page = c.get(f"{BASE}/company/{sym}/consolidated/")
            except httpx.HTTPError as e:
                # A network failure is not evidence the cookie is dead. Under
                # --ensure, treating it as such would log in and rotate a
                # perfectly good session on every blip.
                no(f"{sym} unreachable ({e.__class__.__name__})")
                continue
            m = DATA_URL_RE.search(page.text)
            if not m:
                continue
            # Same headers build-company-overview.mjs sends on this request.
            # A probe that asks differently can bless a cookie that script
            # rejects.
            frag = c.get(
                BASE + m.group(1),
                headers={"X-Requested-With": "XMLHttpRequest",
                         "Referer": f"{BASE}/company/{sym}/consolidated/"},
            ).text
            if LOGGED_OUT_RE.search(frag):
                no(f"the Key Points fragment for {sym} was served as a login "
                   f"page — this cookie is NOT authenticated. Nothing was "
                   f"written.")
                return None
            if len(frag) < 200:
                no(f"Key Points fragment for {sym} was only {len(frag)} bytes. "
                   f"Nothing was written.")
                return None
            return f"{sym}: {len(frag)} byte fragment"
    no("no probe symbol exposed a Key Points data-url — cannot verify the "
       "session, so nothing was written")
    return None


def write_env(path: Path, updates: dict[str, str]) -> None:
    """Replace KEY= lines in place, appending any that are absent.

    Written to a temp file in the same directory and renamed, so an interrupted
    run cannot leave a half-written .env.local — which would take the database
    URLs down with it, not just the cookie.
    """
    lines = path.read_text().splitlines(keepends=True) if path.exists() else []
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        k = line.split("=", 1)[0].strip().removeprefix("export ").strip()
        if k in updates:
            out.append(f"{k}={updates[k]}\n")
            seen.add(k)
        else:
            out.append(line)
    for k, v in updates.items():
        if k not in seen:
            if out and not out[-1].endswith("\n"):
                out.append("\n")
            out.append(f"{k}={v}\n")

    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    fd, tmp = tempfile.mkstemp(dir=str(path.parent))
    try:
        with os.fdopen(fd, "w") as fh:
            fh.writelines(out)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def read_db_session() -> tuple[str, str] | None:
    """The cookie the WORKFLOWS actually read. Returns None if there isn't one.

    --ensure must probe this row and not .env.local. On a CI runner .env.local
    does not exist at all, and on this laptop it can hold a different (usually
    older) cookie than the one the scheduled jobs use — so probing the file
    would answer a question nobody asked and bless or condemn the wrong value.
    """
    url = os.environ.get("APP_DB_URL")
    if not url:
        fail("APP_DB_URL not set — --ensure reads app.screener_session.")

    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("SELECT sessionid, csrftoken FROM app.screener_session "
                    "WHERE id = 1")
        row = cur.fetchone()
    if not row or not row[0] or not row[1]:
        return None
    return row[0], row[1]


def write_db(sid: str, csrf: str, symbol: str) -> str:
    """Store the verified cookie in app.screener_session. Returns a description.

    Uses psycopg directly rather than fundamental_etl.db because this must be
    able to target Neon: the cookie's whole purpose is to be read by the GitHub
    workflows, and they read prod. The usual remote-write guard applies — set
    APP_DB_URL to the Neon URL plus FUNDAMENTAL_ALLOW_REMOTE_DB=1 if that is
    what you mean.
    """
    url = os.environ.get("APP_DB_URL")
    if not url:
        fail("APP_DB_URL not set — cannot write app.screener_session. Use "
             "--local to write only .env.local.")

    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE app.screener_session"
            "   SET sessionid = %s, csrftoken = %s, verified_at = now(),"
            "       verified_symbol = %s, updated_at = now(),"
            "       updated_by = 'screener-session.py'"
            " WHERE id = 1",
            (sid, csrf, symbol),
        )
        if cur.rowcount != 1:
            fail("app.screener_session has no id=1 row — migration 0084 has not "
                 "been applied to this database. Nothing was written there.")
        conn.commit()
    # Host only, never the credentials in the URL.
    return url.split("@")[-1].split("/")[0]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--local", action="store_true",
                    help="Write only .env.local, skipping app.screener_session. "
                         "For testing a cookie without handing it to the four "
                         "scheduled jobs that read that row.")
    ap.add_argument("--check", action="store_true",
                    help="Probe the CURRENT cookie and exit. Writes nothing, "
                         "logs in to nothing, needs no credentials.")
    ap.add_argument("--ensure", action="store_true",
                    help="CI entrypoint. Probe app.screener_session and log in "
                         "ONLY if it is dead. Exits 0 when the stored cookie "
                         "still works, so it is cheap to run before every job.")
    args = ap.parse_args()

    env = {**read_env(ENV_FILE), **{k: v for k, v in os.environ.items()
                                    if k.startswith("SCREENER_")}}

    if args.ensure:
        # Probe FIRST. Logging in unconditionally would mint a new session on
        # every scheduled run — more logins than a human ever made, against an
        # account whose rate limits are not ours to discover, and it would
        # invalidate the cookie a concurrently-running job is holding.
        current = read_db_session()
        if current and probe(*current, strict=False):
            print("session is LIVE — no login needed")
            return 0
        print("stored session is dead or missing — logging in")

        email = env.get("SCREENER_EMAIL")
        password = env.get("SCREENER_PASSWORD")
        if not email or not password:
            fail("the stored session is dead and SCREENER_EMAIL / "
                 "SCREENER_PASSWORD are not set, so it cannot be renewed. In "
                 "CI these are repository secrets; locally they go in "
                 ".env.local. Rotate by hand at /admin/screener meanwhile.")

        sid, csrf = login(email, password)
        where = probe(sid, csrf)                 # strict: fails before writing
        host = write_db(sid, csrf, where.split(":")[0])
        # .env.local is deliberately NOT written here. On a runner that would
        # create a file holding a live cookie in the workspace; on the laptop
        # it would be a side effect of a command whose job is the DB row.
        print(f"session renewed and verified ({where})")
        print(f"updated app.screener_session on {host}")
        return 0

    if args.check:
        sid, csrf = env.get("SCREENER_SESSIONID"), env.get("SCREENER_CSRFTOKEN")
        if not sid or not csrf:
            fail("SCREENER_SESSIONID / SCREENER_CSRFTOKEN not set")
        print(f"session is LIVE — {probe(sid, csrf)}")
        return 0

    email = env.get("SCREENER_EMAIL")
    password = env.get("SCREENER_PASSWORD")
    if not email or not password:
        fail("set SCREENER_EMAIL and SCREENER_PASSWORD in .env.local (it is "
             "gitignored) and re-run. They are used only to log in and are "
             "never written anywhere by this script.")

    sid, csrf = login(email, password)
    where = probe(sid, csrf)                     # fails closed before any write

    write_env(ENV_FILE, {"SCREENER_SESSIONID": sid, "SCREENER_CSRFTOKEN": csrf})
    print(f"session verified ({where})")
    print(f"updated {ENV_FILE.relative_to(REPO_ROOT)}")

    if args.local:
        print("app.screener_session NOT touched (--local) — the scheduled jobs "
              "still hold the previous cookie.")
    else:
        host = write_db(sid, csrf, where.split(":")[0])
        print(f"updated app.screener_session on {host} — this is the copy the "
              f"workflows read")
    return 0


if __name__ == "__main__":
    sys.exit(main())
