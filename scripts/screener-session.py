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

ON PUTTING THE PASSWORD IN CI
----------------------------
Deliberately not done. Doing it would let a scheduled job rotate the session
unattended and remove this failure mode entirely, at the cost of a reusable
credential sitting in CI instead of a cookie that expires on its own. That is a
security tradeoff with an owner, and it should be made explicitly rather than
arrived at because it was convenient.
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
        if resp.status_code not in (200, 302):
            fail(f"POST /login/ → HTTP {resp.status_code}")

        sid = c.cookies.get("sessionid")
        csrf = c.cookies.get("csrftoken")
        if not sid:
            # Django re-renders the form with an error rather than 4xx-ing, so
            # status alone cannot distinguish wrong password from success.
            hint = ("credentials rejected"
                    if "password" in resp.text.lower() else "no sessionid cookie set")
            fail(f"login did not produce a session — {hint}")
        return sid, csrf or token


def probe(sid: str, csrf: str) -> str:
    """Prove the cookie is authenticated. Returns a short description on success.

    Anonymous visitors can read Screener company pages, so only the login-gated
    Key Points fragment settles the question.
    """
    headers = {"User-Agent": UA, "Cookie": f"sessionid={sid}; csrftoken={csrf}"}
    with httpx.Client(timeout=30.0, follow_redirects=True, headers=headers) as c:
        for sym in PROBE_SYMBOLS:
            page = c.get(f"{BASE}/company/{sym}/consolidated/")
            m = DATA_URL_RE.search(page.text)
            if not m:
                continue
            frag = c.get(BASE + m.group(1)).text
            if LOGGED_OUT_RE.search(frag):
                fail(f"the Key Points fragment for {sym} was served as a login "
                     f"page — this cookie is NOT authenticated. Nothing was "
                     f"written.")
            if len(frag) < 200:
                fail(f"Key Points fragment for {sym} was only {len(frag)} bytes. "
                     f"Nothing was written.")
            return f"{sym}: {len(frag)} byte fragment"
    fail("no probe symbol exposed a Key Points data-url — cannot verify the "
         "session, so nothing was written")


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
    args = ap.parse_args()

    env = {**read_env(ENV_FILE), **{k: v for k, v in os.environ.items()
                                    if k.startswith("SCREENER_")}}

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
