#!/usr/bin/env python3
"""
fetch-corporate-actions-iapi.py — rich corporate actions from indianapi.in.

Unlike the BSE fetcher (recent dividends only), indianapi returns full history
across all types in one call: dividends, splits, bonus, rights, AND board
meetings (which carry results/dividend dates). It accepts our NSE symbol
directly as `stock_name`, so no symbol↔name mapping is needed.

Endpoint:  GET https://stock.indianapi.in/corporate_actions?stock_name=<SYM>
  → {"dividends":{header,data}, "splits":…, "bonus":…, "rights":…,
     "board_meetings":{header:["Date","Agenda"], data:[...]}}
Auth:      header from .env.local — INDIANAPI_KEY (name) + INDIANAPI_KEY_VALUE.

BUDGET: Hobby plan = 5,000 req/month, 1 req/sec. One call per stock → a full
~2,160-symbol refresh is ~43% of the month. So run MONTHLY (its own workflow).
Use --limit while testing to spend only a few calls.

RESUMABLE: symbols are processed least-recently-fetched first (tracked in
app.corporate_action_fetch). A run that hits --max-minutes or a timeout stops
cleanly with progress committed, and the next run continues where it left off
instead of restarting at "A" — so the full universe gets covered across runs
and never re-spends quota on symbols already done this cycle.

THROTTLE: adaptive. The 1 req/sec limit needs ≥1s *between call starts*; since
each call already takes ~2s, we only sleep the remainder up to --min-spacing
(no wasted fixed sleep).

USAGE:
  etl/.venv/bin/python scripts/fetch-corporate-actions-iapi.py --limit 15
  etl/.venv/bin/python scripts/fetch-corporate-actions-iapi.py --max-minutes 110
  etl/.venv/bin/python scripts/fetch-corporate-actions-iapi.py            # full
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError

import psycopg

REPO = Path(__file__).resolve().parent.parent
BASE = "https://stock.indianapi.in/corporate_actions"

# Cap the noisiest sections so the table stays lean (splits/bonus/rights are
# rare → keep all).
MAX_DIVIDENDS = 16
MAX_BOARD = 6
RS_RE = re.compile(r"Rs\.?\s*([0-9]+(?:\.[0-9]+)?)", re.I)


def env(name: str, required: bool = True) -> str | None:
    v = os.environ.get(name)
    if v:
        return v
    p = REPO / ".env.local"
    if p.exists():
        for line in p.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    if required:
        raise SystemExit(f"{name} not set — add to .env.local or pass as env var")
    return None


def get(stock_name: str, headers: dict, timeout: int = 25) -> dict | None:
    url = f"{BASE}?stock_name={urllib.parse.quote(stock_name)}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8", "replace"))


def parse_date(s: str):
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%d %b %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime((s or "").strip(), fmt).date()
        except (ValueError, AttributeError):
            continue
    return None


def col(header: list, *keywords: str) -> int:
    """Index of the first header cell containing any keyword (case-insensitive)."""
    for i, h in enumerate(header or []):
        hl = str(h).lower()
        if any(k in hl for k in keywords):
            return i
    return -1


def section_rows(payload: dict, key: str):
    sec = payload.get(key)
    if not isinstance(sec, dict):
        return [], []
    return sec.get("header") or [], sec.get("data") or []


def build_actions(sym: str, payload: dict) -> list[tuple]:
    """→ list of (symbol, action_type, ex_date, purpose, amount, details_json)."""
    out: list[tuple] = []

    def add(atype, ex, purpose, amount, raw):
        if ex is None or not purpose:
            return
        out.append((sym, atype, ex, purpose[:300], amount, json.dumps(raw)))

    # Dividends — header: Record Date, Ex-Date, Dividend Percentage, Details
    h, rows = section_rows(payload, "dividends")
    ex_i, det_i, pct_i = col(h, "ex-date", "ex date"), col(h, "detail"), col(h, "percent")
    for row in rows[:MAX_DIVIDENDS]:
        ex = parse_date(row[ex_i]) if ex_i >= 0 and ex_i < len(row) else None
        details = str(row[det_i]) if det_i >= 0 and det_i < len(row) else ""
        pct = str(row[pct_i]) if pct_i >= 0 and pct_i < len(row) else ""
        m = RS_RE.search(details)
        amount = float(m.group(1)) if m else None
        kind = "Interim Dividend" if "interim" in details.lower() else \
               "Special Dividend" if "special" in details.lower() else "Final Dividend"
        add("dividend", ex, kind, amount, dict(zip(h, row)))

    # Splits / bonus / rights — header: …, Ex-Date, Ratio[, Premium]
    for key, atype, label in (("splits", "split", "Split"),
                              ("bonus", "bonus", "Bonus"),
                              ("rights", "rights", "Rights")):
        h, rows = section_rows(payload, key)
        ex_i, ratio_i = col(h, "ex-date", "ex date"), col(h, "ratio")
        for row in rows:
            ex = parse_date(row[ex_i]) if ex_i >= 0 and ex_i < len(row) else None
            ratio = str(row[ratio_i]) if ratio_i >= 0 and ratio_i < len(row) else ""
            purpose = f"{label} {ratio}".strip()
            add(atype, ex, purpose, None, dict(zip(h, row)))

    # Board meetings — header: Date, Agenda (keep most recent few)
    h, rows = section_rows(payload, "board_meetings")
    date_i, ag_i = col(h, "date"), col(h, "agenda", "purpose")
    for row in rows[:MAX_BOARD]:
        dt = parse_date(row[date_i]) if date_i >= 0 and date_i < len(row) else None
        agenda = str(row[ag_i]).strip() if ag_i >= 0 and ag_i < len(row) else ""
        # Collapse the boilerplate "<Co> has informed BSE…" into a short label.
        short = "Quarterly Results" if "result" in agenda.lower() else \
                (agenda.split(" to consider")[0][:80] if agenda else "Board Meeting")
        add("board_meeting", dt, short or "Board Meeting", None, {"agenda": agenda[:400]})

    # Dedupe on (action_type, ex_date, purpose) so the per-symbol replace can't
    # violate the (symbol, ex_date, purpose) PK.
    seen, deduped = set(), []
    for t in out:
        k = (t[1], t[2], t[3])
        if k not in seen:
            seen.add(k)
            deduped.append(t)
    return deduped


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch corporate actions from indianapi.in.")
    ap.add_argument("--url", help="Postgres URL (default APP_DB_URL)")
    ap.add_argument("--limit", type=int, help="Only first N symbols (testing — saves quota)")
    ap.add_argument("--min-spacing", type=float, default=1.05,
                    help="Min seconds between call starts (≥1 for the 1 req/s limit)")
    ap.add_argument("--max-minutes", type=float, default=None,
                    help="Stop cleanly after this many minutes (resumable next run)")
    args = ap.parse_args()

    url = args.url or env("APP_DB_URL")
    hname = env("INDIANAPI_KEY")
    hval = env("INDIANAPI_KEY_VALUE")
    headers = {hname: hval, "Accept": "application/json", "User-Agent": "Mozilla/5.0"}

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            # Least-recently-fetched first (never-fetched → NULLS FIRST), so a
            # timed-out run or re-run continues instead of restarting at "A".
            cur.execute(
                """
                SELECT u.symbol
                  FROM app.universe u
                  LEFT JOIN app.corporate_action_fetch f ON f.symbol = u.symbol
                 WHERE u.is_active
                 ORDER BY f.fetched_at ASC NULLS FIRST, u.symbol
                """
            )
            symbols = [r[0] for r in cur.fetchall()]
        if args.limit:
            symbols = symbols[: args.limit]
        budget = f", budget {args.max_minutes:.0f}m" if args.max_minutes else ""
        print(f"Symbols: {len(symbols)} (least-recently-fetched first){budget}",
              file=sys.stderr)

        start = time.monotonic()
        total, ok, calls = 0, 0, 0
        for i, sym in enumerate(symbols, 1):
            if args.max_minutes and (time.monotonic() - start) / 60 >= args.max_minutes:
                print(f"  ⏱ {args.max_minutes:.0f}m budget reached at {i-1}/{len(symbols)} "
                      f"— stopping cleanly (resumes next run).", file=sys.stderr)
                break

            call_t0 = time.monotonic()

            def space():
                """Sleep only the remainder needed to keep ≥min-spacing between starts."""
                dt = time.monotonic() - call_t0
                if dt < args.min_spacing:
                    time.sleep(args.min_spacing - dt)

            try:
                payload = get(sym, headers)
                calls += 1
            except HTTPError as e:
                if e.code == 429:
                    print("  ! 429 rate/quota limit — stopping (partial run saved)", file=sys.stderr)
                    break
                print(f"  ! {sym}: HTTP {e.code}", file=sys.stderr)
                space()
                continue
            except (URLError, TimeoutError, ValueError) as e:
                print(f"  ! {sym}: {type(e).__name__}", file=sys.stderr)
                space()
                continue

            actions = build_actions(sym, payload) if isinstance(payload, dict) else []
            with conn.cursor() as cur:
                # Source-scoped delete: only clear OUR rows so the BSE fetcher's
                # rows (source='bse', recent dividends) survive an indianapi run.
                cur.execute(
                    "DELETE FROM app.corporate_action WHERE symbol = %s AND source = 'indianapi'",
                    (sym,),
                )
                if actions:
                    cur.executemany(
                        """
                        INSERT INTO app.corporate_action
                          (symbol, action_type, ex_date, purpose, amount, details, source, fetched_at)
                        VALUES (%s,%s,%s,%s,%s,%s::jsonb,'indianapi', now())
                        -- If a BSE row has the identical (symbol, ex_date, purpose),
                        -- indianapi (richer) takes it over.
                        ON CONFLICT (symbol, ex_date, purpose) DO UPDATE SET
                          action_type = EXCLUDED.action_type,
                          amount      = EXCLUDED.amount,
                          details     = EXCLUDED.details,
                          source      = 'indianapi',
                          fetched_at  = now()
                        """,
                        actions,
                    )
                # Mark this symbol fetched regardless of whether it had actions,
                # so resumable ordering advances past empty-history stocks too.
                cur.execute(
                    """
                    INSERT INTO app.corporate_action_fetch (symbol, fetched_at)
                    VALUES (%s, now())
                    ON CONFLICT (symbol) DO UPDATE SET fetched_at = now()
                    """,
                    (sym,),
                )
            conn.commit()
            if actions:
                total += len(actions)
                ok += 1
            if i % 100 == 0:
                print(f"  …{i}/{len(symbols)}, {total} actions, {calls} calls", file=sys.stderr)
            space()

    print(f"Done — {total} actions across {ok} symbols; {calls} API calls used.")


if __name__ == "__main__":
    main()
