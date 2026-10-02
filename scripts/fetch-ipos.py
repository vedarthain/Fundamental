#!/usr/bin/env python3
"""
fetch-ipos.py — snapshot Upstox's IPO calendar into app.ipo.

WHAT IT PULLS

  GET /v2/ipos?status=<s>&issue_type=<t>   for all 8 combinations of
      status     ∈ {upcoming, open, closed, listed}
      issue_type ∈ {regular, sme}
  then, for the rows that are NOT already listed, GET /v2/ipos/{id} — because
  the list response carries only the headline fields and the things a tracker
  is actually for (lot size, allotment and listing dates, registrar, RHP link,
  investor categories) exist only on the detail response.

  Measured 2026-10-02: 173 rows total, of which 32 are non-listed. So the run
  costs 8 list calls + ~32 detail calls ≈ 40 requests. Fetching details for all
  173 would cost 181 and buy nothing: a listed IPO's timeline is history and its
  subscription figure is frozen.

WHY --listed-details EXISTS AND IS OFF BY DEFAULT

  The first backfill of a fresh table genuinely wants the detail fields for the
  listed rows too (listing_price is on the detail response, and the "how did the
  band compare to the listing" question is the whole point of the retrospective
  cut). That is a one-time 181-call run, not a daily one. Making it a flag keeps
  the daily cost honest instead of hiding a backfill inside the routine path.

THE TOKEN IS THE WHOLE RISK

  Upstox access tokens expire daily at 22:00 UTC (03:30 IST) and there is no
  refresh-token flow — renewal requires a human at /admin/upstox. On 2026-10-02
  the stored token had been dead for nine days and nothing said so.

  Therefore this script's failure mode is deliberate and loud: exit 2, with the
  expiry timestamp in the message. It does NOT write a partial snapshot and does
  NOT touch fetched_at on existing rows, so a dead token leaves yesterday's
  snapshot intact with yesterday's date on it. The UI renders that date. A
  silently-refreshed fetched_at over unchanged data would be the lie.

WHAT KEEPS THIS CURRENT (CLAUDE.md §5)

  Nothing automatic, and that is stated rather than papered over: the token
  cannot be renewed by a cron. What the design guarantees instead is that
  staleness is VISIBLE — every row carries fetched_at, the tracker renders it,
  and --check exits 1 when the newest snapshot is older than --max-age-hours so
  a scheduled job can fail rather than succeed over stale data.

THE PRICE PASS NEEDS NO TOKEN — ON PURPOSE

  "How is it trading now" comes from Upstox's PUBLIC instrument master,
  https://assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz, which
  carries instrument_key, tradingsymbol and last_price for every NSE equity and
  sends no Authorization header. Matched on ISIN, not symbol: 86/86 NSE-listed
  rows matched by ISIN on 2026-10-02, and matching by symbol is the fragile one
  because tradingsymbols get renamed.

  Not golden.price_history, which looks like the right source and is not:
  0 of those 86 symbols exist in golden.stocks (2,981 rows). golden.stocks was
  seeded and is not enriched on a new NSE listing, so a newly-listed IPO is
  always exactly the case it has not caught up with.

  Because the price pass is unauthenticated it runs even when the IPO token is
  dead — a lapsed token degrades the calendar without also blanking the returns.
  Hence --prices-only, which does the price pass and nothing else.

RETENTION — 6 MONTHS, AND THE CLEANUP IS THE POINT

  Upstox only serves ~3 months of listed history (its listed set stopped dead at
  2026-07-06 for both regular and SME, a server-side window, not pagination), so
  the 6-month view is built by ACCUMULATING: once a row is in app.ipo it is ours
  and survives disappearing from the API.

  The counterpart to accumulating is evicting, which is §5's other half — the
  coverage ledger grew forever because it could upsert and not delete. So every
  run prunes listed rows whose listing_date is older than --retain-days (183),
  prints the count, and --no-prune turns it off. Rows with a NULL listing_date
  are NEVER pruned: age unknown is not age exceeded.

USAGE
  # Local snapshot against the prod app DB (the token lives there)
  etl/.venv/bin/python scripts/fetch-ipos.py

  # Refresh only the post-listing prices (works with an expired IPO token)
  etl/.venv/bin/python scripts/fetch-ipos.py --prices-only

  # Fetch + print, write nothing
  etl/.venv/bin/python scripts/fetch-ipos.py --dry-run

  # One-time: also pull detail for the listed rows (listing_price, timelines)
  etl/.venv/bin/python scripts/fetch-ipos.py --listed-details

  # Freshness tripwire for a scheduled caller — no fetching at all
  etl/.venv/bin/python scripts/fetch-ipos.py --check --max-age-hours 36

EXIT CODES
  0  success
  1  fatal (config / network / Upstox error), or --check found a stale snapshot
  2  token missing or expired — a human must re-login at /admin/upstox
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import psycopg

LIST_ENDPOINT = "https://api.upstox.com/v2/ipos"
NSE_MASTER = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz"

# How much listed history app.ipo keeps. Six months, because that is the window
# the tracker offers; Upstox itself only serves ~3, so the back half of it is
# built by this script not deleting what it already has.
RETAIN_DAYS = 183
STATUSES = ("upcoming", "open", "closed", "listed")
ISSUE_TYPES = ("regular", "sme")

# Upstox caps `records` at 30. Pagination is real: listed/regular was 63 rows
# over 3 pages on 2026-10-02, so a single-page fetch would silently truncate.
PAGE_SIZE = 30

# Guard against an endless pagination loop if total_pages ever disagrees with
# what the pages actually return. 20 pages × 30 = 600 rows, far above the ~170
# observed, so hitting this means the API is misbehaving, not that we grew.
MAX_PAGES = 20


def env_url(name: str) -> str:
    v = os.environ.get(name)
    if v:
        return v
    # Mirrors intraday-refresh-ltp.py: fall back to the local app DB so a bare
    # invocation during development does not reach for production by accident.
    return "postgres:///fundamental_app"


# Cloudflare fronts api.upstox.com and rejects urllib's default User-Agent
# ("Python-urllib/3.x") with HTTP 403 error_code 1010, "Access denied — the site
# owner has blocked access based on your browser's signature". Measured
# 2026-10-02: the identical request via curl succeeded, so it is the UA and not
# the token. Same wall as nsearchives in etl/nse_equity_master.py, which is why
# that module carries the same constant.
#
# Worth knowing: this is NOT specific to /v2/ipos. Any urllib-based Upstox
# caller is exposed to it — including scripts/intraday-refresh-ltp.py, which
# sends no UA either.
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def get_json(url: str, token: str) -> dict:
    req = Request(url, headers={
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": _UA,
    })
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def load_token(conn: psycopg.Connection) -> tuple[str | None, datetime | None]:
    with conn.cursor() as cur:
        cur.execute("SELECT access_token, expires_at FROM app.upstox_session WHERE id = 1")
        row = cur.fetchone()
    return (row[0], row[1]) if row else (None, None)


def num(v):
    """Upstox sends subscription as a STRING ("102.47") and prices as floats.

    Returns None for anything that is not a finite number, including the empty
    string and the literal "null" — a non-numeric subscription must read as
    "unknown", never as 0, because 0.0× and "we don't know" look identical on a
    chart and mean opposite things to someone deciding whether to apply.
    """
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def day(v):
    """'2026-10-05' → date. None for null/empty/unparseable."""
    if not v or not isinstance(v, str):
        return None
    try:
        return datetime.strptime(v.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def flatten(row: dict) -> dict:
    """One API object (list row, optionally detail-enriched) → one DB row.

    Detail-only fields come out as None when only the list response was seen,
    and the upsert below is written so a None NEVER overwrites a value already
    stored — see COALESCE in the ON CONFLICT clause. Without that, a daily run
    that skipped the detail call would blank out the lot size and the timeline
    it fetched yesterday.
    """
    tl = row.get("timeline") or {}
    reg = row.get("registrar_info") or {}
    cats = [c.get("category") for c in (row.get("investors") or [])
            if isinstance(c, dict) and c.get("category")]
    return {
        "id": row.get("id"),
        "symbol": row.get("symbol") or None,
        "name": row.get("name") or row.get("id"),
        "status": row.get("status"),
        "isin": row.get("isin") or None,
        "issue_type": row.get("issue_type"),
        "issue_size_cr": num(row.get("issue_size")),
        "industry": row.get("industry") or None,
        "min_price": num(row.get("minimum_price")),
        "max_price": num(row.get("maximum_price")),
        "cut_off_price": num(row.get("cut_off_price")),
        "face_value": num(row.get("face_value")),
        "lot_size": int(row["lot_size"]) if isinstance(row.get("lot_size"), (int, float)) else None,
        "min_quantity": int(row["minimum_quantity"]) if isinstance(row.get("minimum_quantity"), (int, float)) else None,
        "bidding_start": day(row.get("bidding_start_date")) or day(tl.get("application_start_date")),
        "bidding_end": day(row.get("bidding_end_date")) or day(tl.get("application_end_date")),
        "allotment_date": day(tl.get("allotment_date")) or day(tl.get("allotment_start_date")),
        "refund_date": day(tl.get("refund_initiation_date")),
        "listing_date": day(tl.get("listing_date")),
        "mandate_end": day(tl.get("mandate_end_date")),
        "listing_price": num(row.get("listing_price")),
        "listing_exchange": row.get("listing_exchange") or None,
        "total_subscription": num(row.get("total_subscription")),
        "rhp_url": row.get("rhp_url") or None,
        "drhp_url": row.get("drhp_url") or None,
        "registrar": (reg.get("name") or reg.get("registrar") or None),
        "investor_categories": cats or None,
    }


COLS = [
    "id", "symbol", "name", "status", "isin", "issue_type", "issue_size_cr",
    "industry", "min_price", "max_price", "cut_off_price", "face_value",
    "lot_size", "min_quantity", "bidding_start", "bidding_end",
    "allotment_date", "refund_date", "listing_date", "mandate_end",
    "listing_price", "listing_exchange", "total_subscription", "rhp_url",
    "drhp_url", "registrar", "investor_categories",
]

# Columns that must be overwritten unconditionally on conflict: these come off
# the LIST response, so every run has a current value for them, and a stale one
# is wrong (status walks upcoming→open→closed→listed; subscription moves hourly
# while bidding is open).
ALWAYS_SET = {"name", "status", "issue_type"}

# Everything else is COALESCE(new, old): a run that did not fetch the detail
# response sends None for lot_size/timeline/registrar, and None must mean
# "I did not look", never "it is gone". `total_subscription` is in this set
# deliberately — num() returns None for a non-numeric payload, and keeping
# yesterday's real figure beats blanking the column on a bad parse.
PRESERVE = [c for c in COLS if c not in ALWAYS_SET and c != "id"]


def upsert(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    placeholders = ", ".join(f"%({c})s" for c in COLS)
    sets = [f"{c} = EXCLUDED.{c}" for c in sorted(ALWAYS_SET)]
    sets += [f"{c} = COALESCE(EXCLUDED.{c}, app.ipo.{c})" for c in PRESERVE]
    sets.append("fetched_at = now()")
    sql = (
        f"INSERT INTO app.ipo ({', '.join(COLS)}) VALUES ({placeholders}) "
        f"ON CONFLICT (id) DO UPDATE SET {', '.join(sets)}"
    )
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


def fetch_all(token: str, want_listed_details: bool, verbose: bool) -> list[dict]:
    seen: dict[str, dict] = {}
    for status in STATUSES:
        for issue_type in ISSUE_TYPES:
            page = 1
            while page <= MAX_PAGES:
                q = urlencode({"status": status, "issue_type": issue_type,
                               "page_number": page, "records": PAGE_SIZE})
                body = get_json(f"{LIST_ENDPOINT}?{q}", token)
                if body.get("status") != "success":
                    raise RuntimeError(f"ipos {status}/{issue_type} p{page}: {str(body)[:300]}")
                data = body.get("data") or []
                for r in data:
                    if isinstance(r, dict) and r.get("id"):
                        seen[r["id"]] = r
                meta = ((body.get("meta_data") or {}).get("page") or {})
                total = meta.get("total_pages")
                if verbose:
                    print(f"  {status:9s} {issue_type:7s} p{page}/{total or '?'}  +{len(data)}")
                if not data or not isinstance(total, int) or page >= total:
                    break
                page += 1

    # Detail pass. Slug order is stable, so a run that dies partway and is
    # re-run covers the same set rather than a random subset.
    targets = [i for i, r in sorted(seen.items())
               if want_listed_details or r.get("status") != "listed"]
    for n, slug in enumerate(targets, 1):
        try:
            body = get_json(f"{LIST_ENDPOINT}/{slug}", token)
        except (HTTPError, URLError, TimeoutError) as e:
            # One unreachable detail page must not lose the other 172 rows. The
            # list fields are already in hand, and COALESCE on the upsert means
            # the detail columns keep whatever a previous run stored.
            print(f"  !! detail {slug}: {e}", file=sys.stderr)
            continue
        if body.get("status") == "success" and isinstance(body.get("data"), dict):
            seen[slug] = {**seen[slug], **body["data"]}
        if verbose and n % 20 == 0:
            print(f"  detail {n}/{len(targets)}")
        time.sleep(0.12)  # ~8 req/s, far under Upstox's documented ceiling

    return [flatten(r) for r in seen.values() if r.get("id") and r.get("status") and r.get("issue_type")]


def refresh_prices(conn: psycopg.Connection, verbose: bool) -> tuple[int, int]:
    """ISIN → (instrument_key, last_price) off Upstox's public NSE master.

    Returns (priced, wanted). Only rows that HAVE an ISIN and are already listed
    are candidates — an unlisted issue has no scrip to price, and the 20
    upcoming rows have no ISIN either.

    A last_price of 0 in the master means "has not traded", not "worth nothing",
    so it is written as NULL. The DB's ipo_last_price_positive constraint is the
    backstop if that ever regresses here.

    Nothing is deleted when a row goes unmatched: the 55 BSE-only issues will
    never appear in the NSE master, and blanking a price we hold because today's
    file did not mention it would be the same NULL-means-gone bug the upsert's
    COALESCE exists to prevent.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT id, isin FROM app.ipo "
                    "WHERE status = 'listed' AND isin IS NOT NULL")
        want = {isin: ipo_id for ipo_id, isin in cur.fetchall()}
    if not want:
        return (0, 0)

    req = Request(NSE_MASTER, headers={"User-Agent": _UA})
    with urlopen(req, timeout=120) as r:
        raw = gzip.decompress(r.read())
    rows: list[tuple] = []
    seen_at = datetime.now(timezone.utc)
    for rec in csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))):
        if rec.get("instrument_type") != "EQUITY":
            continue
        key = rec.get("instrument_key") or ""
        isin = key.rsplit("|", 1)[-1]
        if isin not in want:
            continue
        px = num(rec.get("last_price"))
        rows.append((key, px if (px is not None and px > 0) else None,
                     seen_at if (px is not None and px > 0) else None,
                     want[isin]))

    if rows:
        with conn.cursor() as cur:
            cur.executemany(
                "UPDATE app.ipo SET instrument_key = %s, "
                "last_price    = COALESCE(%s, app.ipo.last_price), "
                "last_price_at = COALESCE(%s, app.ipo.last_price_at) "
                "WHERE id = %s",
                rows,
            )
    priced = sum(1 for r in rows if r[1] is not None)
    if verbose:
        print(f"prices: matched {len(rows)}/{len(want)} listed ISINs in the NSE "
              f"master, {priced} with a tradeable last_price")
    return (priced, len(want))


def prune(conn: psycopg.Connection, retain_days: int, verbose: bool) -> int:
    """Evict listed issues older than the retention window.

    Shows the count before deleting, per CLAUDE.md. `listing_date IS NULL` is
    deliberately excluded from the predicate rather than treated as ancient —
    unknown age is not exceeded age, and a NULL listing_date on a listed row
    means the detail pass has not run for it yet.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*), min(listing_date), max(listing_date) FROM app.ipo "
            "WHERE status = 'listed' AND listing_date IS NOT NULL "
            "  AND listing_date < current_date - %s::int",
            (retain_days,),
        )
        n, lo, hi = cur.fetchone()
        if not n:
            if verbose:
                print(f"prune: 0 listed rows older than {retain_days} days")
            return 0
        print(f"prune: deleting {n} listed row(s) listed {lo}..{hi}, "
              f"older than {retain_days} days")
        cur.execute(
            "DELETE FROM app.ipo "
            " WHERE status = 'listed' AND listing_date IS NOT NULL "
            "   AND listing_date < current_date - %s::int",
            (retain_days,),
        )
    return n


def check_freshness(conn: psycopg.Connection, max_age_hours: float) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT max(fetched_at), count(*) FROM app.ipo")
        newest, n = cur.fetchone()
    if not newest:
        print("app.ipo is EMPTY — never snapshotted", file=sys.stderr)
        return 1
    age_h = (datetime.now(timezone.utc) - newest).total_seconds() / 3600
    print(f"app.ipo: {n} rows, newest fetched_at {newest.isoformat()} ({age_h:.1f}h old)")
    if age_h > max_age_hours:
        print(f"STALE — older than {max_age_hours}h. Re-login at /admin/upstox, "
              f"then re-run this script.", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="fetch and print, write nothing")
    ap.add_argument("--listed-details", action="store_true",
                    help="also pull /ipos/{id} for already-listed rows (one-time backfill)")
    ap.add_argument("--check", action="store_true",
                    help="only assert the stored snapshot is fresh; no Upstox calls")
    ap.add_argument("--max-age-hours", type=float, default=36.0)
    ap.add_argument("--prices-only", action="store_true",
                    help="refresh post-listing prices from the public NSE "
                         "master and exit; needs no Upstox token")
    ap.add_argument("--retain-days", type=int, default=RETAIN_DAYS,
                    help=f"keep listed issues this recent (default {RETAIN_DAYS})")
    ap.add_argument("--no-prune", action="store_true",
                    help="skip the retention delete")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    url = env_url("APP_DB_URL")
    with psycopg.connect(url) as conn:
        if args.check:
            return check_freshness(conn, args.max_age_hours)

        if args.prices_only:
            try:
                refresh_prices(conn, not args.quiet)
            except (HTTPError, URLError, TimeoutError, OSError) as e:
                print(f"NSE instrument master unreachable: {e}", file=sys.stderr)
                return 1
            conn.commit()
            return 0

        token, expires = load_token(conn)
        if not token:
            print("no upstox access_token in app.upstox_session — a human must "
                  "log in at /admin/upstox", file=sys.stderr)
            return 2
        if expires and expires <= datetime.now(timezone.utc):
            print(f"upstox token expired at {expires.isoformat()} — a human must "
                  f"re-login at /admin/upstox. Leaving the existing snapshot and "
                  f"its fetched_at untouched.", file=sys.stderr)
            return 2

        try:
            rows = fetch_all(token, args.listed_details, not args.quiet)
        except HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300] if hasattr(e, "read") else ""
            if e.code in (401, 403):
                print(f"Upstox rejected the token (HTTP {e.code}) — re-login at "
                      f"/admin/upstox. {detail}", file=sys.stderr)
                return 2
            print(f"Upstox HTTP {e.code}: {detail}", file=sys.stderr)
            return 1
        except (URLError, TimeoutError) as e:
            print(f"Upstox unreachable: {e}", file=sys.stderr)
            return 1

        by_status: dict[str, int] = {}
        for r in rows:
            by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        print(f"fetched {len(rows)} IPOs: " +
              " ".join(f"{k}={v}" for k, v in sorted(by_status.items())))

        if args.dry_run:
            for r in sorted(rows, key=lambda r: (r["status"], r["name"])):
                band = (f"{r['min_price']:.0f}-{r['max_price']:.0f}"
                        if r["min_price"] and r["max_price"] else "band TBA")
                print(f"  {r['status']:9s} {r['issue_type']:7s} "
                      f"{(r['symbol'] or '—'):12s} {band:>12s} "
                      f"sub={r['total_subscription'] if r['total_subscription'] is not None else '—'} "
                      f"{r['name']}")
            print("DRY RUN — nothing written.")
            return 0

        n = upsert(conn, rows)
        print(f"upserted {n} rows into app.ipo")

        # Prices and the prune run AFTER the upsert and inside the same
        # transaction. Order matters: a row that became 'listed' on this run
        # should get a price on this run, and the prune must see the statuses
        # this run established rather than yesterday's.
        #
        # A failure in the price pass must not lose the snapshot, which is the
        # expensive part (~40 authenticated calls). So it is caught and reported
        # rather than raised.
        try:
            refresh_prices(conn, not args.quiet)
        except (HTTPError, URLError, TimeoutError, OSError) as e:
            print(f"  !! price pass skipped, NSE master unreachable: {e}",
                  file=sys.stderr)

        if not args.no_prune:
            prune(conn, args.retain_days, not args.quiet)

        conn.commit()
        return 0


if __name__ == "__main__":
    sys.exit(main())
