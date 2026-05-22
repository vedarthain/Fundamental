#!/usr/bin/env python3
"""
migrate.py — minimal Postgres migration runner.

Reads SQL files from db/migrations/ (sorted alphabetically), applies any
that haven't been recorded in app.schema_migrations on the target DB, and
records each successful application.

WHY THIS EXISTS:
  Until now migrations were applied by hand (`psql -f db/migrations/0017.sql`),
  and Neon got the same DDL via shell heredocs duplicated in sync-neon.sh.
  No record of "which migrations are on which DB" → silent schema drift.

  This script is the single source of truth. Run it before any sync, locally
  or in CI, against any DB URL.  It is idempotent: re-running is a no-op.

USAGE:
  # Apply pending migrations to local DB (reads APP_DB_URL or postgres:///fundamental_app)
  scripts/migrate.py

  # Apply to Neon
  scripts/migrate.py --url "$NEON_APP_URL"

  # First-time setup on a DB whose schema was created before this script existed:
  # record migrations 0001..0017 as "already applied" without re-running them.
  scripts/migrate.py --baseline
  scripts/migrate.py --baseline --url "$NEON_APP_URL"

  # See what would be applied without doing it:
  scripts/migrate.py --dry-run

  # Show status (which versions applied, which pending):
  scripts/migrate.py --status

Each migration runs inside its own transaction along with the
schema_migrations INSERT, so a partial apply rolls back cleanly.

Migration file naming: NNNN_short_description.sql where NNNN is a
zero-padded sort key (e.g. 0018_schema_migrations.sql). The "version" is
the leading NNNN portion.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = ROOT / "db" / "migrations"

# Filename pattern: leading digits = version, rest = name.
# e.g. "0017_cluster_stocks_panel_cache.sql" → version=0017, name=cluster_stocks_panel_cache
_FILE_RE = re.compile(r"^(\d+)_([a-zA-Z0-9_\-]+)\.sql$")


def discover_migrations() -> list[tuple[str, str, Path]]:
    """Return [(version, name, path), ...] sorted by version."""
    if not MIGRATIONS_DIR.exists():
        raise SystemExit(f"Migrations dir not found: {MIGRATIONS_DIR}")
    out: list[tuple[str, str, Path]] = []
    for p in sorted(MIGRATIONS_DIR.iterdir()):
        m = _FILE_RE.match(p.name)
        if not m:
            # Skip README.md, .DS_Store, etc.  Warn on anything that looks
            # like it was MEANT to be a migration but didn't match.
            if p.suffix == ".sql":
                print(f"⚠ skipping malformed migration filename: {p.name}",
                      file=sys.stderr)
            continue
        version, name = m.group(1), m.group(2)
        out.append((version, name, p))
    return out


def ensure_tracking_table(conn: psycopg.Connection) -> None:
    """Bootstrap app.schema_migrations if it doesn't exist.

    Chicken-and-egg: the table that tracks migrations is itself created here
    rather than via a normal migration, because we need it before we can
    record anything.  Migration 0018 is the formal documentation of this
    table for new DBs; on existing DBs this CREATE IF NOT EXISTS is a
    no-op.
    """
    with conn.cursor() as cur:
        cur.execute("""
            CREATE SCHEMA IF NOT EXISTS app;
            CREATE TABLE IF NOT EXISTS app.schema_migrations (
                version    text NOT NULL PRIMARY KEY,
                name       text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now()
            );
        """)
    conn.commit()


def applied_versions(conn: psycopg.Connection) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT version FROM app.schema_migrations")
        return {r[0] for r in cur.fetchall()}


def apply_one(conn: psycopg.Connection, version: str, name: str, path: Path) -> None:
    """Run one migration file + record it.  Single transaction."""
    sql_text = path.read_text()
    with conn.cursor() as cur:
        cur.execute(sql_text)
        cur.execute(
            "INSERT INTO app.schema_migrations (version, name) VALUES (%s, %s)",
            (version, name),
        )
    conn.commit()


def cmd_status(conn: psycopg.Connection) -> int:
    ensure_tracking_table(conn)
    applied = applied_versions(conn)
    migs = discover_migrations()
    print(f"{'version':<8} {'status':<12} name")
    print("-" * 60)
    for version, name, _ in migs:
        status = "applied" if version in applied else "PENDING"
        print(f"{version:<8} {status:<12} {name}")
    pending = [v for v, _, _ in migs if v not in applied]
    print()
    print(f"Total: {len(migs)} migrations, {len(applied)} applied, {len(pending)} pending.")
    return 0 if not pending else 1


def cmd_apply(conn: psycopg.Connection, dry_run: bool) -> int:
    ensure_tracking_table(conn)
    applied = applied_versions(conn)
    migs = discover_migrations()
    pending = [(v, n, p) for v, n, p in migs if v not in applied]
    if not pending:
        print("Nothing to apply — schema is up to date.")
        return 0
    print(f"{'(dry-run) ' if dry_run else ''}Applying {len(pending)} migration(s):")
    for version, name, path in pending:
        print(f"  → {version} {name}")
        if not dry_run:
            try:
                apply_one(conn, version, name, path)
                print(f"    ✓ applied")
            except Exception as e:
                print(f"    ✗ FAILED: {e}", file=sys.stderr)
                return 2
    return 0


def cmd_baseline(conn: psycopg.Connection) -> int:
    """Mark every migration file as already-applied without running it.

    For one-time bootstrapping on a DB whose schema was created before this
    runner existed.  Run once per DB; subsequent migrate.py invocations
    will only apply genuinely new migrations.
    """
    ensure_tracking_table(conn)
    applied = applied_versions(conn)
    migs = discover_migrations()
    new_baseline = [(v, n) for v, n, _ in migs if v not in applied]
    if not new_baseline:
        print("All migrations already recorded — nothing to baseline.")
        return 0
    print(f"Recording {len(new_baseline)} migration(s) as already-applied:")
    with conn.cursor() as cur:
        for version, name in new_baseline:
            print(f"  ✓ {version} {name}")
            cur.execute(
                "INSERT INTO app.schema_migrations (version, name) VALUES (%s, %s)",
                (version, name),
            )
    conn.commit()
    return 0


def resolve_url(arg_url: str | None) -> str:
    """Resolve the target DB URL.

    Migrations need OWNER-level credentials (CREATE TABLE, GRANT, etc.) —
    NOT the limited ETL user.  Resolution order:
      1. --url arg (explicit)
      2. APP_DB_WRITE_URL env (separate write URL for production)
      3. .env.local APP_DB_WRITE_URL
      4. local OS-user socket connection (superuser on dev machines)

    APP_DB_URL is deliberately NOT used here — it's the ETL user with only
    SELECT/INSERT/UPDATE/DELETE on specific tables. For Neon: pass the
    admin URL (e.g. neondb_owner) via --url.
    """
    if arg_url:
        return arg_url
    v = os.environ.get("APP_DB_WRITE_URL")
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("APP_DB_WRITE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    # Final fallback: local OS-user socket connection (superuser on dev machines).
    return "postgresql:///fundamental_app"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply pending Postgres migrations from db/migrations/.",
    )
    parser.add_argument(
        "--url",
        help="Postgres URL (default: APP_DB_URL env or .env.local or postgresql:///fundamental_app).",
    )
    parser.add_argument(
        "--baseline", action="store_true",
        help="Record all existing migrations as applied without running them. One-time setup.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show what would be applied; don't run anything.",
    )
    parser.add_argument(
        "--status", action="store_true",
        help="Show applied/pending state and exit. Exit code 0 if up-to-date, 1 if pending.",
    )
    args = parser.parse_args()

    url = resolve_url(args.url)
    # Mask password for the connection-info print
    masked = re.sub(r"://([^:/@]+):[^@]+@", r"://\1:****@", url)
    print(f"Target: {masked}")

    try:
        with psycopg.connect(url, autocommit=False) as conn:
            if args.status:
                return cmd_status(conn)
            if args.baseline:
                return cmd_baseline(conn)
            return cmd_apply(conn, dry_run=args.dry_run)
    except psycopg.OperationalError as e:
        print(f"✗ Connection failed: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
