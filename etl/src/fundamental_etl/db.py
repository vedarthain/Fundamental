"""Postgres connection helpers.

APP_DB_URL IS LOCAL-ONLY. THIS IS ENFORCED, NOT A CONVENTION.

Until 2026-09-19 there was a file at web/.env.prod.local that bound the two
PRODUCTION Neon URLs to the variable names APP_DB_URL and GOLDEN_DB_URL — the
same two names the repo-root .env.local binds to the LOCAL databases. Sourcing
the wrong file silently repointed every tool in the repo at production while
every command you typed looked exactly the same as it had a hundred times
before. Nothing would warn you; you would simply be running a backfill, a
DELETE, or a DROP against prod believing it was local.

That file is gone, but deleting a file removes the copy, not the hazard: any
stray `export APP_DB_URL=...` in a shell, a CI step, or a half-remembered
command from scrollback recreates it instantly. So the invariant is enforced
here, at the only place a connection is actually opened.

THE RULE: app_conn() and golden_conn() refuse any URL pointing at a remote
host. Local Postgres only. Production is reached exclusively through NEON_APP_URL
/ NEON_GOLDEN_URL, which no ETL code path reads — prod writes go through
scripts/migrate.py --url or scripts/sync-neon.sh, both of which require the
operator to name the target explicitly on the command line.

The check is on the HOST, not on a string like "neon.tech", because the failure
we are preventing is "this is not the machine I think it is". A URL with no host
(postgres:///fundamental_app) or an explicit loopback host is local; anything
else is somebody else's computer and gets refused regardless of vendor.

If you are here because this raised on something legitimate, the fix is to pass
the URL explicitly to the script that needs it — not to widen this check. The
whole value of the guard is that it has no "unless" clause.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row

from .config import settings

# A connection is local if it never leaves this machine. Empty host means a Unix
# socket (postgres:///fundamental_app), which is how .env.local is written.
_LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "::1", "0.0.0.0"}

# Deliberate, explicit, and logged — for the rare case of pointing the ETL at a
# remote DB on purpose (a staging box, a restore drill). Setting this is a
# conscious act that shows up in the shell history of whoever set it; the point
# of the guard is that you cannot arrive at prod by ACCIDENT, not that remote
# access is forbidden forever.
_OVERRIDE_ENV = "FUNDAMENTAL_ALLOW_REMOTE_DB"


def _assert_local(url: str, var_name: str) -> None:
    """Raise unless `url` points at this machine.

    Called before every connection. Cheap (a urlparse) and unconditional —
    a guard with a fast path is a guard that gets skipped on the run that
    matters.
    """
    if os.environ.get(_OVERRIDE_ENV) == "1":
        return

    host = (urlparse(url).hostname or "").lower()
    if host in _LOCAL_HOSTS:
        return

    raise RuntimeError(
        f"{var_name} points at a REMOTE host ({host!r}), and the ETL refuses to "
        f"open it.\n"
        f"\n"
        f"This almost certainly means a production URL has been exported into "
        f"{var_name}. The ETL writes — backfills, upserts, deletes — and it is "
        f"built on the assumption that {var_name} is the local database.\n"
        f"\n"
        f"To work against production, use the tool that asks for it by name:\n"
        f"  scripts/migrate.py --url \"$NEON_APP_URL\"     (schema)\n"
        f"  scripts/sync-neon.sh                          (data push)\n"
        f"\n"
        f"If you genuinely mean to point the ETL at a remote database, set "
        f"{_OVERRIDE_ENV}=1 in that command explicitly."
    )


@contextmanager
def golden_conn() -> Iterator[psycopg.Connection]:
    """Read-only connection to golden_db. Treat as read-only by convention."""
    _assert_local(settings.golden_db_url, "GOLDEN_DB_URL")
    with psycopg.connect(settings.golden_db_url, row_factory=dict_row) as conn:
        yield conn


@contextmanager
def app_conn() -> Iterator[psycopg.Connection]:
    """Writable connection to fundamental_app."""
    _assert_local(settings.app_db_url, "APP_DB_URL")
    with psycopg.connect(settings.app_db_url, row_factory=dict_row) as conn:
        yield conn
