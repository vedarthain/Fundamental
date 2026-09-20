"""ETL CLI entrypoint."""
from __future__ import annotations

import os
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import psycopg
import typer

from .config import settings
from .db import app_conn
from .log import configure_logging, log
from datetime import date as _date

from .clusters.assigner import assign_all
from .db import golden_conn
from . import nse_equity_master
from .screener.scraper import (
    AuthFailed, NotFound, ScrapeError, fetch_company_export, make_client,
)
from .screener.parser import parse_export, merge_parsed, ParseError
from .screener.persist import (
    backfill_company_name,
    save_raw_export, save_parsed, update_meta_success, update_meta_failure,
    save_dividend_only_meta, save_dividend_only_annual,
)
from .scoring.metrics import compute_metrics_for_symbol, persist_metrics, load_nifty_returns
from .scoring.scorecards import load_db_overrides
from .scoring.scorer import score_snapshot

app = typer.Typer(no_args_is_help=True, add_completion=False)

# (dvr_symbol, ordinary_symbol) — DVR share classes that duplicate a company
# already in the universe under its ordinary symbol. Retired by sync-universe
# §7 only while the parent is still active. See the long note there for why
# this is a list rather than a pattern, and why the duplicate biases valuation
# upward rather than merely wasting a row.
DVR_DUPLICATES: list[tuple[str, str]] = [
    ("FELDVR", "FEL"),
    ("GATECHDVR", "GATECH"),
    ("JISLDVREQS", "JISLJALEQS"),
]


@app.command()
def fetch(
    symbol: str = typer.Argument(..., help="NSE symbol, e.g. RELIANCE"),
    save: bool = typer.Option(True, help="Persist to fundamental_app DB"),
    standalone: bool = typer.Option(False, "--standalone",
        help="Force the standalone variant (denser data for some stocks like SOTL, KHAITAN)"),
):
    """Fetch + parse a single ticker. Useful for manual testing."""
    configure_logging()
    log.info("fetch_start", symbol=symbol, standalone=standalone)
    prefer = "standalone" if standalone else "consolidated"
    info, data = fetch_company_export(symbol, prefer=prefer)
    log.info("fetched", symbol=symbol, variant=info.variant, bytes=len(data))
    parsed = parse_export(data)
    log.info("parsed", symbol=symbol, annual_periods=len(parsed.annual),
             quarterly_periods=len(parsed.quarterly), company_name=parsed.company_name)
    if save:
        with app_conn() as conn:
            fetched_at = save_raw_export(conn, symbol, data)
            ann, qtr = save_parsed(conn, symbol, parsed, fetched_at)
            update_meta_success(conn, symbol, info.export_id, len(data))
            conn.commit()
        log.info("persisted", symbol=symbol, annual_rows=ann, quarterly_rows=qtr)


@app.command("fetch-dividend-only")
def fetch_dividend_only(
    only: Optional[str] = typer.Option(
        None, help="Comma-separated symbols to limit to (default: the whole curated list)"),
    throttle: float = typer.Option(2.0, help="Seconds to pause between symbols"),
    save: bool = typer.Option(True, help="Persist to fundamental_app DB"),
):
    """Scrape dividends for the curated InvIT/REIT register (dividends only).

    These names live OUTSIDE app.universe (so they never enter scoring). For
    each: scrape the same Screener export the equity path uses, write its
    dividend history to app.dividend_only_annual, and upsert its display
    metadata + current-price snapshot to app.dividend_only. Neither table
    FK-references app.universe, and golden is never touched — these symbols
    aren't in the price feed, so LTP comes from the export.

    Units gotcha: Screener leaves 'No. of Equity Shares' blank for some trusts
    (observed for PGINVIT), which would null out DPS. We backfill units from
    market_cap / current_price so per-unit distribution still computes.
    """
    from .dividend_only import DIVIDEND_ONLY, SECTOR

    configure_logging()
    wanted = None
    if only:
        wanted = {s.strip().upper() for s in only.split(",") if s.strip()}
    names = [n for n in DIVIDEND_ONLY if wanted is None or n.symbol in wanted]
    log.info("fetch_dividend_only_start", n=len(names))

    ok = fail = 0
    client = make_client()
    try:
        for i, n in enumerate(names, 1):
            try:
                info, data = fetch_company_export(n.symbol, client=client)
                parsed = parse_export(data)

                # Units fallback: fill missing no_of_equity_shares from
                # market_cap (₹cr → ₹) / current_price so DPS = dividend_amount
                # ÷ units still resolves for trusts that omit the shares row.
                units = None
                if parsed.market_cap and parsed.current_price and parsed.current_price > 0:
                    units = parsed.market_cap * 1e7 / parsed.current_price
                if units:
                    for fields in parsed.annual.values():
                        if fields.get("no_of_equity_shares") is None:
                            fields["no_of_equity_shares"] = units

                log.info("dividend_only_parsed", symbol=n.symbol, variant=info.variant,
                         annual_periods=len(parsed.annual), units=units,
                         current_price=parsed.current_price)
                if save:
                    from datetime import datetime as _dt, timezone as _tz
                    fetched_at = _dt.now(_tz.utc)
                    with app_conn() as conn:
                        # Meta row first — dividend_only_annual FK-references it.
                        save_dividend_only_meta(
                            conn, n.symbol,
                            parsed.company_name or n.company_name,
                            SECTOR, n.industry,
                            parsed.current_price, fetched_at,
                        )
                        rows = save_dividend_only_annual(conn, n.symbol, parsed, fetched_at)
                        conn.commit()
                    log.info("dividend_only_persisted", symbol=n.symbol, annual_rows=rows)
                ok += 1
            except (AuthFailed, NotFound, ScrapeError, ParseError) as e:
                fail += 1
                log.warning("dividend_only_failed", symbol=n.symbol, error=str(e))
            if i < len(names):
                time.sleep(throttle)
    finally:
        client.close()
    log.info("fetch_dividend_only_done", ok=ok, failed=fail, total=len(names))


@app.command("fetch-nse")
def fetch_nse(
    only: Optional[str] = typer.Option(
        None, help="Comma-separated symbols to gap-fill (e.g. BLUEJET,SASTASUNDR). "
                   "If omitted, auto-detects gap symbols: active, listed, but with "
                   "zero quarterly rows in app.fundamentals_quarterly."),
    save: bool = typer.Option(True, help="Persist quarters to fundamental_app DB"),
    throttle: float = typer.Option(1.5, help="Seconds to pause between symbols (NSE is rate-sensitive)"),
):
    """Gap-fill quarterly results from NSE for symbols Screener can't cover.

    Last-resort authoritative source: NSE's corporate-filings API carries the
    quarters that some recent-IPO exports miss on Screener. Values are converted
    ₹lakh→₹cr to match our schema.

    MUST run from a residential/desktop IP — NSE's Akamai edge 403s datacenter
    and CI hosts. This is a manual, occasional command, not part of the weekly
    automated pipeline.

    STALENESS GUARD (added 2026-09-19). On 2026-09-19 a dry run of this command
    returned a newest quarter of 2024-12-31 for EVERY symbol tried, including
    live large caps (RELIANCE, TCS, INFY, HINDUNILVR, TITAN). The endpoint
    `/api/results-comparision` takes no date window and is, as far as we can
    tell, frozen ~21 months in the past. Had this been run with --save it would
    have overwritten current quarters with 2024 figures across the board, and
    nothing downstream would have objected: save_parsed upserts on
    (symbol, period_end), so old rows land silently alongside new ones and the
    scorer's freshness gate reads the max, not the origin.

    The guard below is therefore not optional politeness — it is the only thing
    standing between a frozen upstream and the warehouse. It refuses to write
    any symbol whose newest fetched quarter is not strictly newer than what we
    already hold. That test is self-referential: it compares the source against
    our own state rather than against a hardcoded cutoff date, so it cannot rot
    as time passes and needs no maintenance when NSE unfreezes.
    """
    from datetime import datetime, timezone
    from .nse.results import fetch_nse_results, make_nse_client, NSEFetchError

    configure_logging()

    if only:
        symbols = [s.strip().upper() for s in only.split(",") if s.strip()]
    else:
        with app_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT u.symbol
                FROM app.universe u
                LEFT JOIN app.fundamentals_quarterly q ON q.symbol = u.symbol
                WHERE u.is_active
                GROUP BY u.symbol
                HAVING COUNT(q.period_end) = 0
                ORDER BY u.symbol
            """)
            symbols = [r["symbol"] for r in cur.fetchall()]

    log.info("fetch_nse_start", n=len(symbols))
    ok = fail = stale = 0
    client = make_nse_client()
    try:
        for i, sym in enumerate(symbols, 1):
            try:
                parsed = fetch_nse_results(sym, client=client)

                # parsed.quarterly is a dict keyed by period_end (a date), not a
                # list of row objects — see nse/results.py.
                fetched_newest = max(parsed.quarterly.keys(), default=None)
                with app_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        "SELECT MAX(period_end) AS held FROM app.fundamentals_quarterly "
                        "WHERE symbol = %s",
                        (sym,),
                    )
                    row = cur.fetchone()
                    held_newest = row["held"] if row else None

                # Nothing came back, or what came back is not newer than what we
                # already have. Either way there is no gap being filled, only a
                # chance to overwrite good data with old data. Refuse.
                if fetched_newest is None or (
                    held_newest is not None and fetched_newest <= held_newest
                ):
                    stale += 1
                    log.warning(
                        "nse_stale_refused", symbol=sym,
                        fetched_newest=str(fetched_newest),
                        held_newest=str(held_newest),
                        reason="fetched data is not newer than what we already hold",
                    )
                    time.sleep(throttle)
                    continue

                if save:
                    with app_conn() as conn:
                        _, qtr = save_parsed(conn, sym, parsed, datetime.now(timezone.utc))
                        conn.commit()
                    log.info("nse_saved", symbol=sym, quarters=qtr,
                             newest=str(fetched_newest))
                else:
                    log.info("nse_dry_run", symbol=sym, quarters=len(parsed.quarterly),
                             newest=str(fetched_newest))
                ok += 1
            except NSEFetchError as e:
                fail += 1
                log.warning("nse_skip", symbol=sym, reason=str(e)[:160])
            except Exception as e:
                fail += 1
                log.error("nse_error", symbol=sym, error=str(e)[:160])
            time.sleep(throttle)
    finally:
        client.close()
    log.info("fetch_nse_done", ok=ok, failed=fail, stale_refused=stale,
             total=len(symbols))
    if stale and ok == 0:
        # Every single symbol came back stale. That is not a per-symbol data
        # quirk, it is the frozen-endpoint signature described in the docstring.
        # Exit non-zero so a human notices instead of reading "done" and assuming
        # the gap-fill worked.
        raise typer.Exit(code=1)


@app.command()
def fetch_many(
    limit: Optional[int] = typer.Option(None, help="Cap the number of symbols processed"),
    only: Optional[str] = typer.Option(None, help="Comma-separated list of symbols (overrides queue)"),
    skip_recent_hours: int = typer.Option(20, help="Skip symbols scraped within this many hours"),
    stop_on_auth_fail: bool = typer.Option(True, help="Halt the run if Screener cookies expire"),
    workers: int = typer.Option(3, help="Concurrent worker threads (3 = 3x sequential)"),
    batch_size: int = typer.Option(50, help="Stocks per batch before the cool-down pause"),
    batch_pause: float = typer.Option(5.0, help="Seconds to pause between batches"),
    max_runtime_min: int = typer.Option(
        0,
        help=(
            "Stop scraping gracefully after N minutes (0 = unlimited) and exit 0, "
            "so a downstream score step still runs even when Screener is throttling. "
            "Remaining symbols resume on the next run via skip_recent_hours."
        ),
    ),
):
    """Backfill / refresh fundamentals for many symbols.

    Default behaviour: pulls all symbols from app.universe that haven't been scraped
    in the last `skip_recent_hours`, throttled by SCREENER_THROTTLE_SECONDS.
    """
    configure_logging()

    if only:
        symbols = [s.strip().upper() for s in only.split(",") if s.strip()]
    else:
        with app_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.symbol
                FROM app.universe u
                LEFT JOIN app.screener_meta m ON m.symbol = u.symbol
                WHERE u.is_active
                  AND (m.last_scraped_at IS NULL
                       OR m.last_scraped_at < NOW() - (%s || ' hours')::interval
                       OR m.last_status <> 'ok')
                -- Failures first. A symbol whose last scrape was NOT 'ok'
                -- (auth_failed / http_error / parse_error) is retried BEFORE
                -- aged-but-healthy names. Without this, a just-failed row sorts
                -- to the back (its last_scraped_at is recent) and, under
                -- --max-runtime-min, can be skipped run after run — leaving the
                -- exact rows that trip cookie_health/freshness perpetually red.
                -- NULLS-first keeps never-scraped names ahead of stale ones.
                ORDER BY (m.last_status IS DISTINCT FROM 'ok') DESC,
                         m.last_scraped_at NULLS FIRST, u.symbol
                """,
                (str(skip_recent_hours),),
            )
            symbols = [r["symbol"] for r in cur.fetchall()]

    if limit:
        symbols = symbols[:limit]

    log.info(
        "backfill_plan",
        total=len(symbols),
        workers=workers,
        throttle_s=settings.screener_throttle_seconds,
        batch_size=batch_size,
        batch_pause_s=batch_pause,
    )
    if not symbols:
        log.info("nothing_to_do")
        return

    # Per-worker httpx.Client via threading.local so each worker thread has
    # its own connection pool + cookie jar. Sharing a client across threads
    # is technically supported by httpx but in practice corrupts state when
    # one worker's cookies invalidate or one path closes the client — any
    # other in-flight worker then sees "Cannot send a request, as the
    # client has been closed". Per-worker clients eliminate that class of
    # error at the cost of slightly more connection setup (negligible vs
    # the 1s throttle).
    tls = threading.local()

    def worker_client() -> "object":
        cli = getattr(tls, "client", None)
        if cli is None:
            cli = make_client()
            tls.client = cli
        return cli

    # Halt flag — flipped by any worker that hits an auth failure (cookie
    # expiry). threading.Event is the cleanest cross-thread signal; further
    # batches are skipped once it's set.
    halt = threading.Event()
    counter_lock = threading.Lock()
    # Track per-status counts so the final summary can show a breakdown
    # like "ok=2102 http_error=37 not_found=12 auth_failed=0". The legacy
    # roll-up keys (ok / fail / warn / done) are kept for the per-batch
    # summary line which uses cumulative deltas.
    counter = {
        "ok": 0, "fail": 0, "warn": 0, "done": 0,
        "by_status": {
            "ok": 0,
            "auth_failed": 0,
            "not_found": 0,
            "parse_error": 0,
            "http_error": 0,
            "unknown": 0,
        },
    }

    def _bump_status(name: str) -> None:
        # Always called inside counter_lock by the caller.
        counter["by_status"][name] = counter["by_status"].get(name, 0) + 1

    # Reference point for "is this export stale?", computed ONCE per run: the
    # newest quarter anyone in the warehouse has reported. See the staleness
    # comment in process() for why this is a live query and not a constant.
    with app_conn() as _conn, _conn.cursor() as _cur:
        _cur.execute("SELECT MAX(period_end) AS d FROM app.fundamentals_quarterly")
        _row = _cur.fetchone()
        market_newest_quarter = _row["d"] if _row else None
    log.info("market_newest_quarter", period_end=str(market_newest_quarter))

    def process(symbol: str, n_total: int) -> None:
        """Fetch + parse + save one symbol. Each worker sleeps the per-call
        throttle AFTER each fetch so its next pickup is naturally spaced.
        With 3 workers @ 1s throttle each, effective rate is ~3 req/s."""
        if halt.is_set():
            return
        client = worker_client()
        try:
            info, data = fetch_company_export(symbol, client=client)
            parsed = parse_export(data)
            # Standalone-quarterly fallback: Screener sometimes ships a
            # consolidated Data Sheet with the Quarters section missing/empty
            # (recent IPOs, companies whose consolidated view lags standalone),
            # which downstream reads as "no latest result" and — worse — lets a
            # stock be scored off stale annuals alone. Pull the standalone export
            # and backfill the missing quarters. Consolidated annuals still win
            # on any overlap; standalone is pure fill.
            #
            # THE TRIGGER USED TO BE `not parsed.quarterly` — presence, not
            # freshness. That tested the wrong thing. An export with five
            # quarters ending 2024-12-31 has quarterly rows, so it never fired,
            # and the symbol was saved with financials ~21 months old. The
            # scorer's freshness gate then dropped it from the scored universe,
            # which is how 23 names ended up in 'gated_stale_financials' —
            # invisible, because the one mechanism that could have repaired them
            # declined to run on the grounds that the data existed.
            #
            # Presence is a degenerate case of staleness, so test staleness and
            # get both. The reference is market_newest_quarter — the newest
            # quarter ANY company in the warehouse has reported — not a literal
            # date. A literal would need editing every quarter and would silently
            # start passing everything the moment someone forgot. Comparing
            # against the market means the bar rises by itself as results come
            # in, and it self-disables correctly: on an empty warehouse the
            # reference is None and only the no-quarters case fires.
            #
            # Two quarters of slack, not one: a company that has genuinely not
            # filed yet is normally one quarter behind the fastest filers during
            # results season, and firing on that would double the scrape for a
            # large slice of the universe every quarter for nothing. Two behind
            # is not a reporting calendar, it is a broken export.
            newest_q = max(parsed.quarterly.keys(), default=None)
            export_is_stale = (
                newest_q is None
                or (market_newest_quarter is not None
                    and (market_newest_quarter - newest_q).days > 185)
            )
            if export_is_stale and info.variant == "consolidated":
                try:
                    s_info, s_data = fetch_company_export(
                        symbol, client=client, prefer="standalone"
                    )
                    parsed = merge_parsed(parsed, parse_export(s_data))
                    log.info("standalone_quarterly_merge", symbol=symbol,
                             quarters=len(parsed.quarterly),
                             was_newest=str(newest_q),
                             now_newest=str(max(parsed.quarterly.keys(), default=None)),
                             market_newest=str(market_newest_quarter))
                except (NotFound, ScrapeError, ParseError) as e:
                    # Fallback is best-effort — a missing standalone view just
                    # means we save what we have (consolidated annuals).
                    log.warning("standalone_fallback_failed", symbol=symbol,
                                error=str(e)[:120])
            with app_conn() as conn:
                fetched_at = save_raw_export(conn, symbol, data)
                ann, qtr = save_parsed(conn, symbol, parsed, fetched_at)
                update_meta_success(conn, symbol, info.export_id, len(data))
                # Repair universe.company_name if it is still the symbol
                # fallback. No-op once the name is real. See persist.py.
                if backfill_company_name(conn, symbol, parsed.company_name):
                    log.info("company_name_filled", symbol=symbol,
                             company_name=parsed.company_name)
                conn.commit()
            with counter_lock:
                counter["ok"] += 1
                counter["done"] += 1
                _bump_status("ok")
            # One concise line per stock — symbol + status. Lets the operator
            # see which names are flowing through without the structured-row
            # verbosity we had earlier (annual=10 quarterly=6 bytes=12345).
            log.info("ok", symbol=symbol)
        except AuthFailed as e:
            with counter_lock:
                counter["fail"] += 1
                counter["done"] += 1
                _bump_status("auth_failed")
            with app_conn() as conn:
                update_meta_failure(conn, symbol, "auth_failed", str(e))
                conn.commit()
            log.error("auth_failed", symbol=symbol, error=str(e))
            if stop_on_auth_fail:
                log.error("halting_run", reason="screener cookies expired — re-extract them")
                halt.set()
        except NotFound:
            # NotFound is "we couldn't reach a company page for this symbol"
            # — usually a delisting / ticker change. Treated as a warning,
            # not a hard failure, since the data simply doesn't exist.
            with counter_lock:
                counter["warn"] += 1
                counter["done"] += 1
                _bump_status("not_found")
            with app_conn() as conn:
                update_meta_failure(conn, symbol, "not_found", "no company page")
                conn.commit()
            log.warning("not_found", symbol=symbol)
        except ParseError as e:
            with counter_lock:
                counter["fail"] += 1
                counter["done"] += 1
                _bump_status("parse_error")
            with app_conn() as conn:
                update_meta_failure(conn, symbol, "parse_error", str(e))
                conn.commit()
            log.error("parse_error", symbol=symbol, error=str(e))
        except ScrapeError as e:
            with counter_lock:
                counter["fail"] += 1
                counter["done"] += 1
                _bump_status("http_error")
            with app_conn() as conn:
                update_meta_failure(conn, symbol, "http_error", str(e))
                conn.commit()
            log.error("scrape_error", symbol=symbol, error=str(e))
        except Exception as e:  # pragma: no cover — surface unexpected
            with counter_lock:
                counter["fail"] += 1
                counter["done"] += 1
                _bump_status("unknown")
            with app_conn() as conn:
                # Persist the actual exception text so we can diagnose later
                # without needing the live terminal output. The full traceback
                # still goes to the structured log via log.exception().
                update_meta_failure(conn, symbol, "unknown", repr(e))
                conn.commit()
            log.exception("unexpected", symbol=symbol)
        finally:
            # Per-worker pacing — sleeps before the executor frees this thread
            # to pick up its next task. Effective rate per worker = 1/throttle.
            time.sleep(settings.screener_throttle_seconds)

    # Second-Ctrl+C escape hatch — workers can be deep in a 60s back-off
    # sleep when the user gives up. First Ctrl+C raises KeyboardInterrupt
    # naturally (handled below); second Ctrl+C calls os._exit so we don't
    # have to wait for the sleep to finish.
    _sigint_count = {"n": 0}
    _prev_handler = signal.getsignal(signal.SIGINT)

    def _sigint_handler(signum, frame):
        _sigint_count["n"] += 1
        if _sigint_count["n"] >= 2:
            log.error("force_exit", reason="second Ctrl+C — bypassing thread join")
            os._exit(130)
        # First press — fall through to the default handler so Python
        # raises KeyboardInterrupt at the next checkpoint.
        if callable(_prev_handler):
            _prev_handler(signum, frame)

    signal.signal(signal.SIGINT, _sigint_handler)

    n_total = len(symbols)
    # Optional wall-clock budget. When set, we stop launching new batches once
    # exceeded and exit cleanly (0) — the partial scrape is fine (fundamentals
    # are quarterly; unscraped symbols keep last run's blobs) and, crucially,
    # the score step downstream still runs instead of being killed with us.
    deadline = (time.monotonic() + max_runtime_min * 60) if max_runtime_min > 0 else None
    try:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            # Process in batches so we can pause between them. The cool-down
            # keeps the rolling average request rate well below the
            # workers/throttle peak — a defensive layer in case Screener
            # rate-limits on sustained bursts.
            batch_no = 0
            for batch_start in range(0, n_total, batch_size):
                if halt.is_set():
                    log.warning("skipping_remaining_batches", reason="halt_set")
                    break
                if deadline is not None and time.monotonic() >= deadline:
                    with counter_lock:
                        done_so_far = counter["done"]
                    log.warning(
                        "time_budget_reached",
                        max_runtime_min=max_runtime_min,
                        done=done_so_far,
                        total=n_total,
                        remaining=n_total - done_so_far,
                        note="stopping gracefully; remaining resume next run via skip_recent_hours",
                    )
                    break
                batch_no += 1
                # Snapshot counters *before* the batch so we can show the
                # per-batch deltas (not just the cumulative totals).
                with counter_lock:
                    before = dict(counter)
                batch = symbols[batch_start:batch_start + batch_size]
                futures = [executor.submit(process, s, n_total) for s in batch]
                # Drain the batch fully before moving to the next — keeps the
                # batch-pause meaningful (no overlapping rounds in flight).
                for fut in as_completed(futures):
                    fut.result()
                # Per-batch summary line: "batch N — 47 ok, 2 failed, 1 warning"
                with counter_lock:
                    delta_ok = counter["ok"] - before["ok"]
                    delta_fail = counter["fail"] - before["fail"]
                    delta_warn = counter["warn"] - before["warn"]
                    done = counter["done"]
                log.info(
                    "batch_done",
                    batch=batch_no,
                    ok=delta_ok,
                    failed=delta_fail,
                    warnings=delta_warn,
                    done=done,
                    total=n_total,
                )
                if halt.is_set():
                    break
                # Cool-down between batches (not after the final one).
                if batch_start + batch_size < n_total:
                    time.sleep(batch_pause)
    except KeyboardInterrupt:
        log.warning("interrupted_by_user")
        halt.set()
        # ThreadPoolExecutor's __exit__ has already been entered; it'll
        # drain workers before this except block returns. Workers see
        # halt.is_set() at the start of process() and bail out quickly.

    log.info(
        "backfill_done",
        ok=counter["ok"],
        failed=counter["fail"],
        warnings=counter["warn"],
        total=n_total,
        # Per-status breakdown so you can see *what kind* of failures happened
        # without querying screener_meta. Includes the zero-count categories
        # so a clean run still shows e.g. auth_failed=0 explicitly.
        **{f"status_{k}": v for k, v in counter["by_status"].items()},
    )

    # Fail LOUD on cookie expiry. Without this the graceful halt exits 0 and the
    # GitHub "Weekly Fetch" badge stays GREEN even though we scraped nothing —
    # the failure was silent for a full weekend once (2026-07-25). A halt driven
    # by auth_failed means the Screener cookies died mid-run: exit non-zero so the
    # workflow itself goes red, instead of relying solely on the 12h freshness
    # watchdog to notice hours later. KeyboardInterrupt (no auth_failed) still
    # exits 0 — a human stopping the run is not a failure.
    if stop_on_auth_fail and counter["by_status"].get("auth_failed", 0) > 0:
        log.error("exit_nonzero", reason="screener cookies expired — run halted, rotate SCREENER_* secrets")
        raise typer.Exit(code=1)


@app.command("repair")
def repair_cmd(
    min_years: int = typer.Option(8, help="Stocks with fewer years of data in the last 10 years are candidates"),
    min_age_years: int = typer.Option(5, help="Skip stocks listed more recently than this (likely real new listings)"),
    limit: int = typer.Option(0, help="Cap candidates processed (0 = all)"),
    dry_run: bool = typer.Option(False, help="Print candidates without re-fetching"),
    throttle: float = typer.Option(2.0, help="Seconds between requests"),
):
    """Detect stocks with sparse/gappy fundamentals data despite being listed for years,
    re-fetch them using Screener's STANDALONE view (often denser than consolidated for
    older Indian companies), then re-compute metrics + score.
    """
    configure_logging()
    log.info("repair_start", min_years=min_years, min_age_years=min_age_years, dry_run=dry_run)

    with app_conn() as ac:
        with ac.cursor() as cur:
            cur.execute("""
                SELECT u.symbol, u.company_name,
                       EXTRACT(YEAR FROM age(CURRENT_DATE, u.listing_date))::int AS years_listed,
                       COUNT(DISTINCT fa.period_end) FILTER (
                         WHERE fa.period_end >= CURRENT_DATE - INTERVAL '10 years'
                       )::int AS recent_years
                FROM app.universe u
                LEFT JOIN app.fundamentals_annual fa USING (symbol)
                WHERE u.is_active AND u.listing_date IS NOT NULL
                GROUP BY u.symbol, u.company_name, u.listing_date
                HAVING EXTRACT(YEAR FROM age(CURRENT_DATE, u.listing_date)) >= %s
                   AND COUNT(DISTINCT fa.period_end) FILTER (
                         WHERE fa.period_end >= CURRENT_DATE - INTERVAL '10 years'
                       ) < %s
                ORDER BY 4 ASC, 3 DESC
            """, (min_age_years, min_years))
            candidates = cur.fetchall()

    if limit > 0:
        candidates = candidates[:limit]

    log.info("candidates_identified", count=len(candidates))
    if dry_run:
        for c in candidates[:30]:
            log.info("candidate", symbol=c["symbol"], years_listed=c["years_listed"], recent_years=c["recent_years"])
        return

    if not candidates:
        log.info("nothing_to_repair")
        return

    counts = {"ok": 0, "still_sparse": 0, "no_data": 0, "error": 0, "improved": 0}
    syms_improved: list[str] = []

    client = make_client()
    try:
        for i, c in enumerate(candidates, 1):
            sym = c["symbol"]
            try:
                info, data = fetch_company_export(sym, client=client, prefer="standalone")
                parsed = parse_export(data)
                with app_conn() as conn:
                    fetched_at = save_raw_export(conn, sym, data)
                    ann_n, qtr_n = save_parsed(conn, sym, parsed, fetched_at)
                    update_meta_success(conn, sym, info.export_id, len(data))
                    conn.commit()
                # Did it actually fix anything?
                with app_conn() as conn, conn.cursor() as cur:
                    cur.execute("""
                        SELECT COUNT(DISTINCT period_end)::int AS n
                        FROM app.fundamentals_annual
                        WHERE symbol = %s AND period_end >= CURRENT_DATE - INTERVAL '10 years'
                    """, (sym,))
                    new_recent = cur.fetchone()["n"]
                if new_recent >= min_years:
                    counts["improved"] += 1
                    syms_improved.append(sym)
                elif new_recent == 0:
                    counts["no_data"] += 1
                else:
                    counts["still_sparse"] += 1
                counts["ok"] += 1
                log.info("repaired",
                         i=i, n=len(candidates), symbol=sym,
                         was=c["recent_years"], now=new_recent)
            except (AuthFailed,) as e:
                log.error("auth_failed_halt", symbol=sym, error=str(e)[:120])
                break
            except Exception as e:
                counts["error"] += 1
                log.error("error", symbol=sym, error=str(e)[:120])

            if i < len(candidates):
                time.sleep(throttle)
    finally:
        client.close()

    log.info("repair_done", **counts)
    log.info("improved_symbols_sample", sample=syms_improved[:20])

    if syms_improved:
        log.info("running_compute_metrics_for_improved", count=len(syms_improved))
        only_csv = ",".join(syms_improved)
        # Re-use the existing compute-metrics and score commands by invoking their internals
        # Lightweight: shell out via a fresh CLI run to keep code reuse trivial.
        import subprocess, sys as _sys
        subprocess.run([_sys.executable, "-m", "fundamental_etl.cli", "compute-metrics", "--only", only_csv], check=False)
        subprocess.run([_sys.executable, "-m", "fundamental_etl.cli", "score"], check=False)
        log.info("rescore_done")


@app.command("sync-universe")
def sync_universe_cmd(
    min_price_days: int = typer.Option(
        30, help="A symbol counts as live-on-NSE if golden has a .NS daily bar "
                 "within this many days. 30 tolerates a fresh IPO's first sparse weeks."),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Report the diff and write nothing."),
    deactivate: bool = typer.Option(
        False, "--deactivate", help="Also flip is_active=false for universe names that "
               "have gone dark on NSE (no .NS bar within --deactivate-days) AND are "
               "absent from NSE's EQUITY_L master. Both clauses are required: silence "
               "in our price lake cannot distinguish a delisting from an ingest gap, "
               "and retirement is a one-way door (there is no reactivation path). If "
               "EQUITY_L can't be fetched, nothing is retired. Off by default — run "
               "this deliberately (e.g. the monthly cron)."),
    deactivate_days: int = typer.Option(
        60, help="Retire a universe name only after it's had NO .NS daily bar for this "
                 "many days. Deliberately longer than --min-price-days so onboarding is "
                 "fast (30d) while retirement is slow (60d) — a name dark 30–60 days "
                 "sits in a buffer: neither re-onboarded nor retired. Only used with "
                 "--deactivate."),
    include_funds: bool = typer.Option(
        False, "--include-funds", help="Onboard ETFs / mutual-fund units too. Off by "
               "default: NSE trades ETFs in the EQ series and Upstox tags them "
               "instrument_type='EQ', so the only reliable company-vs-fund signal is the "
               "ISIN prefix (INF=fund, INE=company). We exclude INF-ISIN symbols so the "
               "scored universe stays operating-companies-only. golden still holds every "
               "scrip regardless — this filter is app-universe scope, not the raw lake."),
    retire_funds: bool = typer.Option(
        False, "--retire-funds", help="One-off cleanup: flip is_active=false for EXISTING "
               "active universe members whose ISIN is a fund/ETF (INF prefix). Use to "
               "purge ETFs that were onboarded before the INF filter existed."),
    retire_non_equity: bool = typer.Option(
        False, "--retire-non-equity", help="Retire EXISTING active members that are absent "
               "from NSE's EQUITY_L master AND have zero rows in app.fundamentals_annual "
               "(ETFs and rights entitlements that carry no ISIN, so the INF filter can't "
               "see them). The zero-fundamentals half of the test is what keeps delisted "
               "real companies — which are also absent from EQUITY_L — out of the retire "
               "set; those are only ever REPORTED."),
    skip_equity_master: bool = typer.Option(
        False, "--skip-equity-master", help="Don't consult NSE's EQUITY_L.csv at all. "
               "Onboards on the ISIN filter alone, as before this check existed."),
):
    """Reconcile app.universe against golden's live NSE listing master.

    golden ingests the NSE Bhavcopy daily (data_source='nse_bhav'), so a new
    IPO lands in golden.price_history / golden.stocks within a day of listing —
    we don't parse the bhavcopy ourselves. This command diffs that master
    against app.universe and INSERTS the new NSE-listed equities, so the weekly
    Screener fetch → compute → score chain absorbs them automatically on its
    next run (a day-1 IPO enters as a low-maturity name and its score fills in
    as Screener history accrues).

    Live-on-NSE is defined by a recent .NS daily bar — NOT golden.stocks'
    series/exchange metadata, which is inconsistent on exactly the dual-listed
    megacaps (RELIANCE/TCS/INFY/HDFCBANK/ICICIBANK) we most need to keep.
    Identity (name/sector/isin/listing_date) is enriched from golden.stocks
    where present, else the bare symbol stands in until fetch-business-info runs.
    """
    configure_logging()
    log.info("sync_universe_start", min_price_days=min_price_days,
             deactivate=deactivate, deactivate_days=deactivate_days, dry_run=dry_run)

    # ── 1. golden: live NSE symbols (recent .NS bar) + best identity row ──
    # One pass over the wider of the two windows: keep each symbol's most-recent
    # .NS bar date so we can classify onboarding (≤ min_price_days) and
    # retirement (> deactivate_days) from the same fetch.
    window = max(min_price_days, deactivate_days if deactivate else min_price_days)
    with golden_conn() as gc, gc.cursor() as cur:
        cur.execute("""
            WITH live AS (
                SELECT REPLACE(symbol, '.NS', '') AS sym, MAX(date) AS last_bar
                  FROM golden.price_history
                 WHERE symbol LIKE '%%.NS' AND interval = '1d'
                   AND date >= CURRENT_DATE - %s
                 GROUP BY 1
            )
            SELECT DISTINCT ON (l.sym)
                   l.sym, l.last_bar,
                   s.company_name, s.sector, s.industry, s.isin, s.listing_date
              FROM live l
              LEFT JOIN golden.stocks s
                     ON (s.nse_symbol = l.sym OR REPLACE(s.symbol, '.NS', '') = l.sym)
                    AND (s.exchange = 'NSE' OR s.nse_symbol IS NOT NULL)
             ORDER BY l.sym, (s.exchange = 'NSE') DESC NULLS LAST, s.created_at DESC NULLS LAST
        """, (window,))
        live = {r["sym"]: r for r in cur.fetchall()}

        # ── 1b. Earliest bar per symbol — UNWINDOWED on purpose ──────────────
        # The query above is date-filtered, so its MIN would only ever report
        # "the first bar in the last 30 days", which is not a measure of
        # anything. This is a separate full scan (measured ~7s on Neon over
        # 2,964 symbols) because the whole point of the column is depth of
        # history: an NSE Emerge → mainboard migration resets listing_date but
        # leaves years of bars behind, and that difference is only visible
        # against the entire table.
        cur.execute("""
            SELECT REPLACE(symbol, '.NS', '') AS sym, MIN(date) AS first_bar
              FROM golden.price_history
             WHERE symbol LIKE '%%.NS' AND interval = '1d'
             GROUP BY 1
        """)
        first_bar = {r["sym"]: r["first_bar"] for r in cur.fetchall()}

    if not live:
        log.warning("sync_universe_no_live_symbols")
        print("No live NSE symbols found in golden — aborting (nothing written).")
        return

    # Onboarding uses the tight window; a symbol only counts as "live for
    # onboarding" if its last bar is within min_price_days.
    from datetime import timedelta
    onboard_cutoff = _date.today() - timedelta(days=min_price_days)
    deact_cutoff = _date.today() - timedelta(days=deactivate_days)
    live_onboard = {s for s, r in live.items() if r["last_bar"] >= onboard_cutoff}
    # "Still trading" for retirement purposes = a bar within deactivate_days.
    live_for_retire = {s for s, r in live.items() if r["last_bar"] >= deact_cutoff}

    # ── 2. app: current universe membership ──────────────────────────────
    with app_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT symbol, is_active FROM app.universe")
            existing = {r["symbol"]: r["is_active"] for r in cur.fetchall()}

        new_syms = sorted(live_onboard - set(existing))
        # Retire only names with NO bar inside the (longer) deactivate window.
        gone = sorted(s for s, act in existing.items() if act and s not in live_for_retire)

        # ── 2b. ETF / mutual-fund exclusion (ISIN prefix) ────────────────────
        # NSE trades ETFs in the EQ series and Upstox tags them
        # instrument_type='EQ', so neither the bhavcopy series nor Upstox's type
        # tells a fund apart from a company. The reliable discriminator is the
        # ISIN prefix: 'INF' = mutual-fund/ETF unit, 'INE' = company equity. We
        # source each candidate's ISIN from golden's identity row, falling back
        # to app.upstox_instrument. A candidate with NO ISIN anywhere (a
        # just-listed name Upstox hasn't indexed yet) is treated as a company and
        # onboarded — better to admit a rare stray fund than to drop a fresh IPO;
        # --retire-funds later purges any that turn out to be INF once known.
        def _isin_map(symbols: list[str], seed: dict[str, str | None]) -> dict[str, str | None]:
            out = {s: (seed.get(s) or None) for s in symbols}
            missing = [s for s, v in out.items() if not v]
            if missing:
                with conn.cursor() as c2:
                    c2.execute(
                        "SELECT symbol, isin FROM app.upstox_instrument WHERE symbol = ANY(%s)",
                        (missing,),
                    )
                    for r in c2.fetchall():
                        if r["isin"]:
                            out[r["symbol"]] = r["isin"]
            return out

        excluded_funds: list[str] = []
        if not include_funds and new_syms:
            seed = {s: live[s]["isin"] for s in new_syms}
            isin_by = _isin_map(new_syms, seed)
            excluded_funds = sorted(
                s for s, v in isin_by.items() if v and v.upper().startswith("INF"))
            if excluded_funds:
                drop = set(excluded_funds)
                new_syms = [s for s in new_syms if s not in drop]

        # ── 2c. NSE EQUITY_L master — the second, ISIN-independent signal ────
        # The INF-ISIN filter above deliberately admits a candidate with NO ISIN
        # anywhere, so a day-1 IPO is never dropped. ETFs and rights
        # entitlements with no ISIN slip through that same door (40 of them had,
        # by the time we looked). Membership in NSE's own listed-equity master
        # is the independent test: ETFs and -RE lines are absent from that file
        # entirely, while a genuine day-1 IPO is in it.
        #
        # Failure is NOT fatal and NOT silent. If the file can't be fetched we
        # log loudly and fall back to ISIN-only onboarding: delaying the
        # exclusion of a stray ETF by a week costs nothing, whereas aborting
        # weekly-fetch would block the scrape for every real name.
        master: dict[str, dict] = {}
        master_ok = False
        if not skip_equity_master:
            try:
                master = nse_equity_master.fetch()
                master_ok = True
            except nse_equity_master.EquityMasterError as e:
                log.error("equity_master_unavailable", error=str(e))
                print(f"!! EQUITY_L.csv unavailable ({e})")
                print("!! Falling back to ISIN-only filtering for this run.")

        # ── 2c. Narrow the retire set to a CONJUNCTION ────────────────────────
        #
        # Retirement now requires BOTH:
        #   (a) no .NS daily bar for --deactivate-days (60), AND
        #   (b) absence from NSE's EQUITY_L.csv master.
        #
        # WHY. Silence in golden is ambiguous. "The company stopped trading" and
        # "our ingest stopped receiving it" produce an identical signal — no
        # bars — and clause (a) alone cannot tell them apart. It guesses, and
        # the guess is a ONE-WAY DOOR: sync-universe onboards with
        # ON CONFLICT (symbol) DO NOTHING and has no reactivation path anywhere,
        # so a row flipped inactive stays inactive no matter how much fresh
        # price history arrives afterwards. A single bad ingest week would
        # permanently delete live companies from the scored universe, silently.
        #
        # EQUITY_L is the independent second opinion, and it is decisive rather
        # than corroborating: it is NSE's own register of what is listed, so a
        # symbol present in it is listed by definition, whatever our price lake
        # does or doesn't hold. Requiring both means a feed outage on its own
        # can no longer retire anything.
        #
        # This was verified against the 13 names clause (a) had already retired
        # (JBCHEPHARM, GSPL, CIGNITITEC, GUJGASLTD, WIMPLAST …). Every one is
        # absent from EQUITY_L — all 13 genuinely delisted, zero feed gaps. So
        # the conjunction is not a correction of past behaviour; it removes a
        # latent failure mode without changing a single decision made so far.
        #
        # WHEN EQUITY_L IS UNAVAILABLE, RETIRE NOTHING. The fetch is a network
        # call to nsearchives and can fail. On failure we cannot evaluate (b),
        # and an unevaluated clause in a conjunction is not a pass — treating it
        # as one would collapse this straight back to the single-signal rule on
        # exactly the days the network is already misbehaving. Deferring costs a
        # week; retiring a live company costs it permanently.
        #
        # Mirrors --retire-non-equity, which has always been a conjunction
        # (absent from EQUITY_L AND zero fundamentals). The delisted-but-real
        # names are unaffected: they still trade, so clause (a) never fires for
        # them, and they remain reported-only as before.
        if gone:
            if not master_ok:
                print(f"\n!! Retirement SKIPPED for {len(gone)} dark name(s): "
                      f"EQUITY_L.csv unavailable, so 'still listed on NSE' could "
                      f"not be checked. Nothing retired this run.")
                log.warning("retire_deferred_no_master", n=len(gone),
                            symbols=gone[:20])
                gone = []
            else:
                still_listed = sorted(s for s in gone if s in master)
                if still_listed:
                    print(f"\n!! {len(still_listed)} name(s) dark >{deactivate_days}d "
                          f"but STILL LISTED in EQUITY_L — not retired, ingest gap "
                          f"suspected: {', '.join(still_listed[:20])}")
                    log.warning("dark_but_listed", n=len(still_listed),
                                symbols=still_listed[:20])
                gone = sorted(s for s in gone if s not in master)

        def _fundamental_counts(symbols: list[str]) -> dict[str, int]:
            """symbol → annual-fundamental row count, ZERO-FILLED.

            Zero-filling is load-bearing: non_equity() reads a missing key as 0,
            so handing it a sparse map would widen the retire set to every
            symbol the query happened not to return.
            """
            if not symbols:
                return {}
            with conn.cursor() as c3:
                c3.execute(
                    "SELECT symbol, count(*) AS n FROM app.fundamentals_annual "
                    "WHERE symbol = ANY(%s) GROUP BY symbol", (symbols,))
                have = {r["symbol"]: r["n"] for r in c3.fetchall()}
            return {s: have.get(s, 0) for s in symbols}

        excluded_non_equity: list[str] = []
        if master_ok and not include_funds and new_syms:
            # The SAME conjunction used for retirement, not bare absence. A
            # candidate absent from EQUITY_L that already carries scraped
            # fundamentals is a delisted real company returning to the tape
            # (RAJVIR did exactly this), and bare absence would silently refuse
            # to onboard it. A genuine ETF or -RE line has no fundamentals, so
            # the conjunction still catches it; a day-1 IPO also has none but is
            # present in EQUITY_L, so it passes on the first clause.
            excluded_non_equity = nse_equity_master.non_equity(
                master, new_syms, _fundamental_counts(new_syms))
            if excluded_non_equity:
                drop = set(excluded_non_equity)
                new_syms = [s for s in new_syms if s not in drop]

        print(f"golden live NSE symbols (≤{min_price_days}d): {len(live_onboard)}")
        print(f"app.universe rows:       {len(existing)}")
        print(f"ETF/fund excluded (INF): {len(excluded_funds)}"
              f"{'  (use --include-funds to keep)' if excluded_funds else ''}")
        print(f"not in NSE EQUITY_L:     {len(excluded_non_equity)}"
              f"{'  ' + ', '.join(excluded_non_equity[:10]) if excluded_non_equity else ''}")
        print(f"NEW to onboard:          {len(new_syms)}")
        # len(gone) is post-conjunction (see §2c): dark AND absent from
        # EQUITY_L. The label says both so this line can't be read as the raw
        # dark count, which is what it used to be.
        print(f"gone-dark (>{deactivate_days}d) AND delisted per EQUITY_L: {len(gone)}"
              f"{'  (use --deactivate to retire)' if gone and not deactivate else ''}")
        for s in new_syms[:40]:
            nm = (live[s]["company_name"] or s)
            print(f"  + {s:16} {nm}")
        if len(new_syms) > 40:
            print(f"  … and {len(new_syms) - 40} more")

        # ── 2d. Existing active members measured against the same master ─────
        # Two disjoint populations, and the whole point of this block is that
        # they must never be conflated:
        #   non_equity        absent + zero fundamentals → safe to retire
        #   delisted_but_real absent + HAS fundamentals  → report only, ever
        non_equity_syms: list[str] = []
        delisted: list[str] = []
        if master_ok:
            active_syms = sorted(s for s, act in existing.items() if act)
            counts = _fundamental_counts(active_syms)
            non_equity_syms = nse_equity_master.non_equity(master, active_syms, counts)
            delisted = nse_equity_master.delisted_but_real(master, active_syms, counts)

            print(f"\nActive members absent from EQUITY_L: "
                  f"{len(non_equity_syms) + len(delisted)}")
            print(f"  non-equity (0 fundamentals)  : {len(non_equity_syms)}"
                  f"{'  (use --retire-non-equity)' if non_equity_syms and not retire_non_equity else ''}")
            for s in non_equity_syms[:60]:
                print(f"    - {s}")
            if len(non_equity_syms) > 60:
                print(f"    … and {len(non_equity_syms) - 60} more")
            print(f"  DELISTED but real (has fundamentals): {len(delisted)}"
                  f"   — reported only, never retired here")
            for s in delisted:
                print(f"    ~ {s:16} {counts[s]} yrs of fundamentals")

        # ── 2e. How many listing_date holes EQUITY_L can fill (see §3c) ──────
        # Counted here rather than inferred from the UPDATE's rowcount so that
        # --dry-run can report it too. Only rows where ours is NULL and NSE has
        # a date — §3c never overwrites, so this is the exact write set.
        listing_gap = 0
        if master_ok and master:
            datedet = [s for s, m in master.items() if m.get("listing_date")]
            with conn.cursor() as c4:
                c4.execute(
                    "SELECT count(*) AS n FROM app.universe "
                    "WHERE listing_date IS NULL AND symbol = ANY(%s)", (datedet,))
                listing_gap = c4.fetchone()["n"]
            print(f"\nlisting_date holes EQUITY_L can fill: {listing_gap}")

        if dry_run:
            print("\n--dry-run: no rows written.")
            log.info("sync_universe_dry_run", new=len(new_syms), gone=len(gone),
                     non_equity=len(non_equity_syms), delisted=len(delisted),
                     listing_gap=listing_gap)
            return

        # ── 3. INSERT new rows (identity from golden; name falls back to symbol) ──
        inserted = 0
        if new_syms:
            payload = [(
                s,
                (live[s]["company_name"] or s),
                live[s]["sector"], live[s]["industry"],
                live[s]["isin"], live[s]["listing_date"],
                first_bar.get(s),
            ) for s in new_syms]
            with conn.cursor() as cur:
                cur.executemany("""
                    INSERT INTO app.universe
                        (symbol, company_name, sector, industry, isin, listing_date,
                         first_bar_date, is_active, synced_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, true, now())
                    ON CONFLICT (symbol) DO NOTHING
                """, payload)
                inserted = cur.rowcount
                # Append to the immutable membership log — one 'added' event per
                # NEW row. RETURNING from the INSERT above would be cleaner but
                # executemany doesn't surface it reliably across rows; new_syms
                # is exactly the set we just inserted (ON CONFLICT only skips
                # pre-existing symbols, which by construction aren't in new_syms).
                cur.executemany(
                    "INSERT INTO app.universe_event (symbol, event, company_name, source) "
                    "VALUES (%s, 'added', %s, 'sync')",
                    [(s, (live[s]["company_name"] or s)) for s in new_syms],
                )
            conn.commit()

        # ── 3b. Refresh first_bar_date for EVERY row, not just new ones ───────
        # Not an insert-time-only field. golden backfills history for existing
        # symbols (the 2026-04-20 batch of ~105 veterans did exactly that), so a
        # symbol's earliest bar can move BACKWARD long after onboarding. Writing
        # it once at insert would freeze the wrong answer permanently, which is
        # the same "seeded once, never maintained" failure that left
        # golden.stocks with NULL sectors for five months.
        #
        # Guarded with IS DISTINCT FROM so an unchanged run writes zero rows and
        # the count below is a real signal rather than always equal to 2,600.
        bar_updated = 0
        if first_bar:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE app.universe u
                       SET first_bar_date = v.first_bar
                      FROM (SELECT * FROM unnest(%s::text[], %s::date[])
                              AS t(sym, first_bar)) v
                     WHERE u.symbol = v.sym
                       AND u.first_bar_date IS DISTINCT FROM v.first_bar
                """, (list(first_bar.keys()), list(first_bar.values())))
                bar_updated = cur.rowcount
            conn.commit()
        if bar_updated:
            print(f"first_bar_date refreshed on {bar_updated} row(s).")

        # ── 3c. Backfill listing_date from EQUITY_L where golden has none ─────
        # sync-universe takes listing_date from golden.stocks, and golden.stocks
        # is the "seeded once, never maintained" table: it carries a listing_date
        # for the ~2,158 symbols present at the original seed and NULL for every
        # one added since (refresh-ltp.py inserts skeleton rows to satisfy the
        # price_history FK and fills nothing else). Measured 2026-09-20: of the
        # 444 symbols onboarded that month, listing_date was populated for
        # exactly ZERO.
        #
        # That is not cosmetic. hasScoreableHistory (web/src/lib/score.ts) treats
        # a NULL listing_date as SCOREABLE — a deliberate escape hatch, because
        # first_bar_date is bounded by when golden began ingesting a symbol
        # rather than when it began trading, and trusting it alone would badge
        # hundreds of long-established names as IPOs. The cost of that escape
        # hatch is that a genuine day-1 IPO onboards with no listing_date and is
        # therefore shown a full percentile on three months of price history,
        # with no IPO chip — precisely the INNOVISION failure the gate exists to
        # prevent. Up to 71 active names were in that state when this was added.
        #
        # We already hold the answer: EQUITY_L.csv carries DATE OF LISTING and is
        # downloaded and parsed on every run (§2c) purely for its membership.
        # This writes the field we were already throwing away.
        #
        # WHY `IS NULL` AND NOT AN UNCONDITIONAL UPDATE. EQUITY_L records the
        # MAINBOARD listing date. For a company that graduated from NSE Emerge,
        # that date is the migration, not the listing: KOTYARK reads 2026-03-12
        # in EQUITY_L while holding daily bars back to 2021-11-17. 339 active
        # names have first_bar_date < listing_date. Overwriting a good golden
        # date with EQUITY_L's would re-introduce exactly the error the
        # first_bar_date work just removed. So this only ever FILLS A HOLE; it
        # cannot change an answer that already exists. Combined with the
        # earlier-of-the-two rule in observedFrom(), an SME migration that gets
        # its date from here is still rescued by its first bar.
        listing_filled = 0
        if master_ok and master:
            pairs = [(s, m["listing_date"]) for s, m in master.items()
                     if m.get("listing_date")]
            if pairs:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE app.universe u
                           SET listing_date = v.listing_date
                          FROM (SELECT * FROM unnest(%s::text[], %s::date[])
                                  AS t(sym, listing_date)) v
                         WHERE u.symbol = v.sym
                           AND u.listing_date IS NULL
                    """, ([p[0] for p in pairs], [p[1] for p in pairs]))
                    listing_filled = cur.rowcount
                conn.commit()
        if listing_filled:
            print(f"listing_date backfilled from EQUITY_L on {listing_filled} row(s).")

        # ── 4. Optionally retire names that have gone dark on NSE ─────────────
        retired = 0
        if deactivate and gone:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE app.universe SET is_active = false, synced_at = now() "
                    "WHERE symbol = ANY(%s) AND is_active "
                    "RETURNING symbol, company_name",
                    (gone,),
                )
                retired_rows = cur.fetchall()
                retired = len(retired_rows)
                # Log each retirement in the immutable membership history.
                if retired_rows:
                    cur.executemany(
                        "INSERT INTO app.universe_event (symbol, event, company_name, source) "
                        "VALUES (%s, 'removed', %s, 'sync')",
                        [(r["symbol"], r["company_name"]) for r in retired_rows],
                    )
            conn.commit()

        # ── 5. Optional one-off: retire EXISTING active members that are funds ──
        # Purges ETFs/mutual-fund units (INF ISIN) that were onboarded before the
        # INF filter existed. ISIN from app.universe first, else upstox_instrument.
        fund_retired = 0
        if retire_funds:
            with conn.cursor() as cur:
                cur.execute("SELECT symbol, isin FROM app.universe WHERE is_active")
                seed = {r["symbol"]: r["isin"] for r in cur.fetchall()}
            active_syms = sorted(seed.keys())
            isin_by = _isin_map(active_syms, seed)
            fund_syms = sorted(
                s for s, v in isin_by.items() if v and v.upper().startswith("INF"))
            if fund_syms:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE app.universe SET is_active = false, synced_at = now() "
                        "WHERE symbol = ANY(%s) AND is_active "
                        "RETURNING symbol, company_name",
                        (fund_syms,),
                    )
                    fr = cur.fetchall()
                    fund_retired = len(fr)
                    if fr:
                        cur.executemany(
                            "INSERT INTO app.universe_event (symbol, event, company_name, source) "
                            "VALUES (%s, 'removed', %s, 'fund')",
                            [(r["symbol"], r["company_name"]) for r in fr],
                        )
                conn.commit()
            print(f"Fund cleanup: retired {fund_retired} existing ETF/fund member(s).")

        # ── 6. Optional: retire existing members that aren't listed equities ──
        # Source 'non_equity' (not 'fund') in the event log so the two cleanups
        # stay distinguishable in app.universe_event afterwards — they were
        # decided by different evidence.
        non_equity_retired = 0
        if retire_non_equity and non_equity_syms:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE app.universe SET is_active = false, synced_at = now() "
                    "WHERE symbol = ANY(%s) AND is_active "
                    "RETURNING symbol, company_name",
                    (non_equity_syms,),
                )
                ner = cur.fetchall()
                non_equity_retired = len(ner)
                if ner:
                    cur.executemany(
                        "INSERT INTO app.universe_event (symbol, event, company_name, source) "
                        "VALUES (%s, 'removed', %s, 'non_equity')",
                        [(r["symbol"], r["company_name"]) for r in ner],
                    )
            conn.commit()
            print(f"Non-equity cleanup: retired {non_equity_retired} member(s) "
                  f"absent from EQUITY_L with zero fundamentals.")
        elif retire_non_equity and not master_ok:
            print("--retire-non-equity skipped: EQUITY_L.csv was unavailable.")

        # ── 7. Always: retire DVR share classes whose ordinary share is active ─
        #
        # A DVR (differential voting rights) listing is not a company. It is a
        # SECOND SHARE CLASS of a company that is already in the universe under
        # its ordinary symbol, and it carries the parent's financials because
        # that is the only set of financials that exists. Scoring it puts one
        # business into a cluster twice.
        #
        # This is not hypothetical and it is not cosmetic. GATECHDVR scored
        # composite 100 / valuation 100 in bfsi_nbfc (180 members) while its
        # own ordinary share GATECH scored 64 / 56 — same company, same
        # earnings, top of the cluster on the duplicate row. The mechanism is
        # structural rather than a data error: a DVR trades at a standing
        # discount to the ordinary share (that is the entire point of the
        # instrument — less voting power, cheaper entry), so the parent's
        # earnings divided by the discounted price always look cheap. Every DVR
        # that carries its parent's fundamentals will bias valuation-rich, so
        # this would have kept recurring for as long as the row existed.
        #
        # WHY A LIST AND NOT A PATTERN. The three live names do not share a
        # derivable relationship to their parents:
        #     FELDVR     → FEL           (symbol prefix works)
        #     GATECHDVR  → GATECH        (symbol prefix works)
        #     JISLDVREQS → JISLJALEQS    (prefix gives JISLEQS — wrong)
        # and company_name matches for JISL/GATECH but not FEL ("FUTURE
        # ENTERPRISES-DVR" vs "FUTURE ENTERPRISES LTD"). Any heuristic broad
        # enough to catch all three is broad enough to retire a real company
        # whose symbol happens to contain DVR. SEBI barred fresh DVR issuance by
        # listed companies in 2019, so this population is closed and shrinking —
        # a list is the honest encoding of a finite set.
        #
        # WHY THE PARENT MUST BE ACTIVE. Retiring is only correct because the
        # business stays in the universe under the ordinary symbol. If a parent
        # were ever retired, the DVR would become the only row for that company
        # and dropping it would lose coverage rather than de-duplicate it. So
        # the guard is a join, not a bare symbol list — if the parent is gone,
        # the DVR is left alone and the ledger will say so.
        dvr_retired = 0
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE app.universe d
                   SET is_active = false, synced_at = now()
                  FROM (SELECT * FROM unnest(%s::text[], %s::text[])
                          AS t(dvr, parent)) v
                  JOIN app.universe p ON p.symbol = v.parent AND p.is_active
                 WHERE d.symbol = v.dvr AND d.is_active
             RETURNING d.symbol, d.company_name
                """,
                ([d for d, _ in DVR_DUPLICATES], [p for _, p in DVR_DUPLICATES]),
            )
            dr = cur.fetchall()
            dvr_retired = len(dr)
            if dr:
                cur.executemany(
                    "INSERT INTO app.universe_event (symbol, event, company_name, source) "
                    "VALUES (%s, 'removed', %s, 'dvr_duplicate')",
                    [(r["symbol"], r["company_name"]) for r in dr],
                )
                # PURGE THE SCORES, don't just deactivate.
                #
                # is_active=false is NOT sufficient to remove a name from the
                # site. app.scores_latest is DISTINCT ON (symbol) over all of
                # app.scores with no is_active predicate, so a retired symbol
                # keeps returning its final score forever — GATECHDVR was still
                # served at composite 100 after this UPDATE committed.
                #
                # The obvious fix — add `is_active` to the view — is WRONG here.
                # Delisted-but-real companies (EDUCOMP, ORTEL, QUINTEGRA …) are
                # deliberately kept visible; filtering the view would silently
                # take all 17 of them off the site too. The distinction is not
                # "active" but WHY the name was retired, and a view over
                # app.scores cannot see that.
                #
                # So the purge is scoped to the DVR rows only. Deleting them
                # loses no information by construction: a DVR's fundamentals ARE
                # the parent's, and the parent keeps its full score history under
                # the ordinary symbol. This is the one retirement reason where
                # the scored row is a duplicate rather than a record.
                syms = [r["symbol"] for r in dr]
                cur.execute("DELETE FROM app.scores WHERE symbol = ANY(%s)", (syms,))
                scores_purged = cur.rowcount
                cur.execute("DELETE FROM app.cluster_assignment WHERE symbol = ANY(%s)",
                            (syms,))
                log.info("dvr_scores_purged", symbols=syms,
                         score_rows=scores_purged, cluster_rows=cur.rowcount)
        conn.commit()
        if dvr_retired:
            print(f"DVR cleanup: retired {dvr_retired} duplicate share class(es) "
                  f"whose ordinary share is already in the universe.")

    log.info("sync_universe_done", inserted=inserted, retired=retired,
             dvr_retired=dvr_retired,
             excluded_funds=len(excluded_funds), fund_retired=fund_retired,
             excluded_non_equity=len(excluded_non_equity),
             non_equity_retired=non_equity_retired, delisted_reported=len(delisted),
             first_bar_updated=bar_updated, listing_date_filled=listing_filled,
             new_detected=len(new_syms), gone_detected=len(gone))
    print(f"\nInserted {inserted} new symbol(s); retired {retired}.")
    if inserted:
        print("Next: fetch-many --only … → compute-metrics → assign-clusters → score "
              "(or just let the weekly fetch+compute cron absorb them).")


@app.command("assign-clusters")
def assign_clusters_cmd():
    """Assign cluster_id + maturity_tier for every active stock."""
    configure_logging()
    log.info("assign_start")
    with app_conn() as conn:
        counts = assign_all(conn)
        conn.commit()
    log.info("assign_done",
             assigned=counts["assigned"],
             unclassified=counts["unclassified"],
             by_tier=counts["by_tier"])
    # Print top clusters by count
    top = sorted(counts["by_cluster"].items(), key=lambda kv: -kv[1])[:15]
    for cid, n in top:
        print(f"  {cid:30s} {n:>5d}")


@app.command("compute-metrics")
def compute_metrics_cmd(
    snapshot: str = typer.Option(None, help="YYYY-MM-DD; defaults to today"),
    only: str = typer.Option(None, help="Comma-separated symbols to limit to"),
):
    """Compute the metrics_snapshot for every active stock (or a subset)."""
    configure_logging()
    snap = _date.fromisoformat(snapshot) if snapshot else _date.today()
    log.info("compute_metrics_start", snapshot=snap.isoformat())

    with app_conn() as ac:
        with ac.cursor() as cur:
            if only:
                syms = [s.strip().upper() for s in only.split(",") if s.strip()]
                cur.execute("""
                    SELECT u.symbol, ca.cluster_id, u.maturity_tier
                    FROM app.universe u
                    JOIN app.cluster_assignment ca USING (symbol)
                    WHERE u.symbol = ANY(%s) AND u.maturity_tier IN ('veteran','mature','mid','new')
                """, (syms,))
            else:
                cur.execute("""
                    SELECT u.symbol, ca.cluster_id, u.maturity_tier
                    FROM app.universe u
                    JOIN app.cluster_assignment ca USING (symbol)
                    WHERE u.is_active AND u.maturity_tier IN ('veteran','mature','mid','new')
                    ORDER BY u.symbol
                """)
            stocks = cur.fetchall()

            # Report what the plan LEFT OUT, not just what it took on.
            # `n=2145` is indistinguishable from `n=2145` whether the universe
            # holds 2,150 names or 2,634 — and for five months it held 2,634,
            # with 484 silently dropped for having no cluster. A count of
            # survivors cannot surface that; a count of the excluded can. Both
            # exclusions are computed against the SAME predicate pair the
            # SELECT above uses, so the three numbers always reconcile.
            excl: dict[str, int] = {}
            if not only:
                cur.execute("""
                    SELECT
                      count(*) FILTER (WHERE ca.symbol IS NULL)       AS no_cluster,
                      count(*) FILTER (WHERE ca.symbol IS NOT NULL
                                         AND (u.maturity_tier IS NULL
                                              OR u.maturity_tier NOT IN
                                                 ('veteran','mature','mid','new'))) AS bad_tier,
                      count(*)                                        AS active_total
                    FROM app.universe u
                    LEFT JOIN app.cluster_assignment ca USING (symbol)
                    WHERE u.is_active
                """)
                r = cur.fetchone()
                excl = {"excluded": r["active_total"] - len(stocks),
                        "no_cluster": r["no_cluster"],
                        "bad_tier": r["bad_tier"],
                        "active_total": r["active_total"]}
        log.info("plan", n=len(stocks), **excl)

        overrides = load_db_overrides(ac)
        log.info("scorecard_overrides_loaded", count=len(overrides))

        with golden_conn() as gc:
            nifty = load_nifty_returns(gc)
            log.info("nifty_returns", **{k: round(v, 4) if v is not None else None for k, v in nifty.items()})

            ok = fail = 0
            for i, s in enumerate(stocks, 1):
                # Batched commit every 100 — keeps the run fast over a
                # cross-region link (per-symbol commit tripled wall time and
                # blew the CI timeout). Error handling distinguishes two
                # classes:
                #
                #   • A pure Python/data error for ONE symbol does NOT abort
                #     the DB transaction, so we log + skip + continue (a few
                #     symbols legitimately lack data). Original behaviour.
                #
                #   • A Postgres error (deadlock, etc.) ABORTS the whole
                #     transaction — every later statement would fail with
                #     "current transaction is aborted". Rather than cascade
                #     thousands of those (the bug that wiped a manual run), we
                #     roll back and fail the run loudly. A deadlock only
                #     happens under concurrent writes, so the fix is to run
                #     this with the intraday pingers paused, then re-run.
                try:
                    cm, meta, status = compute_metrics_for_symbol(
                        ac, gc, s["symbol"], s["cluster_id"], s["maturity_tier"], nifty,
                        scorecard_overrides=overrides, snapshot_date=snap,
                    )
                    persist_metrics(ac, s["symbol"], snap, cm, meta, s["maturity_tier"], status)
                    ok += 1
                    if i % 100 == 0:
                        ac.commit()
                        log.info("progress", done=i, n=len(stocks), ok=ok, failed=fail)
                except psycopg.Error as e:
                    ac.rollback()
                    log.error("metrics_db_fatal", symbol=s["symbol"], error=str(e)[:200],
                              hint="DB transaction aborted (likely a deadlock from a concurrent "
                                   "writer). Pause the intraday pingers and re-run.")
                    raise SystemExit(1)
                except Exception as e:
                    # Data error for this symbol only — txn intact, skip it.
                    fail += 1
                    log.error("metrics_error", symbol=s["symbol"], error=str(e)[:200])
            ac.commit()

    log.info("compute_metrics_done", ok=ok, failed=fail)


@app.command("fetch-business-info")
def fetch_business_info_cmd(
    only: str = typer.Option(None, help="Comma-separated symbols to limit to"),
    refresh: bool = typer.Option(False, help="Re-fetch even if already populated"),
    throttle: float = typer.Option(1.5, help="Seconds between yfinance calls"),
):
    """Pull company business summary + website from public disclosures via yfinance."""
    from .business_info import fetch_many
    configure_logging()
    syms = [s.strip().upper() for s in only.split(",")] if only else None
    counts = fetch_many(only=syms, skip_existing=not refresh, throttle_s=throttle)
    log.info("done", **counts)


@app.command("fetch-officers")
def fetch_officers_cmd(
    only: str = typer.Option(None, help="Comma-separated symbols to limit to"),
    refresh: bool = typer.Option(False, help="Re-fetch even if already populated"),
    throttle: float = typer.Option(1.5, help="Seconds between yfinance calls"),
):
    """Pull CEO / MD + key officers list from yfinance companyOfficers."""
    from .officers import fetch_many
    configure_logging()
    syms = [s.strip().upper() for s in only.split(",")] if only else None
    counts = fetch_many(only=syms, skip_existing=not refresh, throttle_s=throttle)
    log.info("done", **counts)


@app.command("fetch-classification")
def fetch_classification_cmd(
    only: str = typer.Option(None, help="Comma-separated symbols to limit to"),
    refresh: bool = typer.Option(False, help="Re-fetch even if already populated"),
    throttle: float = typer.Option(1.5, help="Seconds between Screener page GETs"),
):
    """Fill universe.sector/industry from Screener's NSE classification breadcrumb.

    sync-universe can only enrich a new listing by LEFT JOINing golden.stocks,
    and golden.stocks has not been enriched since its original seed — so every
    symbol onboarded since arrives with NULL sector/industry and never gets a
    cluster.  This is the recurring job that fills them.  Default scope is the
    rows that are actually missing, so it is a no-op once caught up and safe to
    run on every weekly cycle.
    """
    from .classification import fetch_many
    configure_logging()
    syms = [s.strip().upper() for s in only.split(",")] if only else None
    counts = fetch_many(only=syms, skip_existing=not refresh, throttle_s=throttle)
    log.info("done", **counts)

    # Fail LOUD, for the same reason fetch-many does (see the note at its exit).
    # This step's whole job is to keep new listings from falling out of scoring.
    # When it silently does nothing, nothing looks wrong for weeks: the workflow
    # is green, the site is up, and symbols quietly accumulate with no sector, no
    # cluster, and no score. That is not hypothetical — it is exactly how 484
    # symbols went unscored for five months.
    #
    # Two distinct alarms, because they need different responses:
    #   auth_failed  cookies are dead → rotate SCREENER_* secrets.
    #   all errored  Screener changed its markup, or is blocking us → read the
    #                scrape_error lines. Guarded on attempted>0 so a caught-up
    #                no-op run (the normal weekly case, 0 targets) still exits 0.
    attempted = counts["ok"] + counts["partial"] + counts["no_data"] + counts["error"]
    if counts.get("auth_failed", 0) > 0:
        log.error("exit_nonzero",
                  reason="screener cookies expired — classification halted, rotate SCREENER_* secrets")
        raise typer.Exit(code=1)
    if attempted > 0 and counts["error"] == attempted:
        log.error("exit_nonzero",
                  reason=f"all {attempted} classification target(s) errored — nothing was written")
        raise typer.Exit(code=1)


@app.command("fetch-shareholding")
def fetch_shareholding_cmd(
    only: str = typer.Option(None, help="Comma-separated symbols to limit to"),
    refresh: bool = typer.Option(False, help="Re-fetch even if already populated"),
    throttle: float = typer.Option(1.5, help="Seconds between Screener page GETs"),
):
    """Scrape quarterly shareholding pattern from Screener company page HTML."""
    from .shareholding import fetch_many
    configure_logging()
    syms = [s.strip().upper() for s in only.split(",")] if only else None
    counts = fetch_many(only=syms, skip_existing=not refresh, throttle_s=throttle)
    log.info("done", **counts)


def _refresh_cluster_cache(conn, snap: "_date") -> int:
    """Refresh app.cluster_composite_cache for the given snapshot date.

    Deletes the old rows for that snapshot, re-inserts from the live
    cluster_composite view, and returns the row count written.  Called
    automatically at the end of score_cmd so /sectors always reads
    pre-computed data.
    """
    with conn.cursor() as cur:
        cur.execute("DELETE FROM app.cluster_composite_cache WHERE snapshot_date = %s", (snap,))
        cur.execute("""
            INSERT INTO app.cluster_composite_cache (
                cluster_id, snapshot_date, n_stocks, industry_name, meta_cluster_id,
                sector_name, avg_roe_3y, avg_roce_3y, avg_op_margin_3y, avg_np_cagr_5y,
                avg_rev_cagr_5y, avg_pe_ttm, avg_pb, avg_ret_12m_rel,
                roe_pct, roce_pct, opm_pct, np_pct, rev_pct, pe_pct, pb_pct, mom_pct,
                quality_aggr_pct, valuation_aggr_pct, momentum_aggr_pct, composite_aggr_pct,
                refreshed_at
            )
            SELECT
                cluster_id, snapshot_date, n_stocks, industry_name, meta_cluster_id,
                sector_name, avg_roe_3y, avg_roce_3y, avg_op_margin_3y, avg_np_cagr_5y,
                avg_rev_cagr_5y, avg_pe_ttm, avg_pb, avg_ret_12m_rel,
                roe_pct, roce_pct, opm_pct, np_pct, rev_pct, pe_pct, pb_pct, mom_pct,
                quality_aggr_pct, valuation_aggr_pct, momentum_aggr_pct, composite_aggr_pct,
                now()
            FROM app.cluster_composite
            WHERE snapshot_date = %s
        """, (snap,))
        return cur.rowcount


# Per-horizon plausibility caps on a computed return (as a fraction: 2.0 = +200%).
# Even after switching to adj_close, golden's price_history has a handful of names
# whose split adjustment is internally inconsistent — the 1y-ago adj_close sits on
# a different scale than today's, implying physically impossible moves (TVSMOTOR
# read +3358%, CUPID +3525%). That's an upstream golden data-quality defect we
# can't repair here; the least-wrong thing is to refuse to publish an absurd
# number rather than render one bad vendor bar as a headline return. Caps are set
# well above any real move over the window (India's daily circuit is ±20%), so a
# genuine multi-bagger micro-cap still passes; only data errors get nulled.
# Longer horizons need much looser caps: a real multi-bagger over 5-10 years (or
# "since inception") is a legitimate +1000%..+10000% and must survive, while a
# split-scale defect over the same window is the only thing we're trying to nuke.
#
# Over multi-year windows real Indian multibaggers dwarf these short-horizon
# bounds — split-adjusted, BAJFINANCE is a genuine ~14,700x since 2002, TITAN
# ~969x, RELIANCE ~359x. A cap tight enough to catch a 1Y defect would null
# every one of those, defeating the purpose of the 5Y/10Y/ALL pills. So the
# long caps are set only to reject the physically-absurd (negative-price
# artifacts, million-x scale breaks), not to second-guess a real compounder.
_RET_CAP = {
    "w1": 2.0,
    "m1": 3.0,
    "m6": 4.0,
    "y1": 5.0,
    "y2": 10.0,
    "y5": 40.0,
    "y10": 150.0,
    "all": 30000.0,
}


def _sane_ret(ret: "float | None", horizon: str) -> "float | None":
    """Return `ret` unless it exceeds the horizon's plausibility cap → None."""
    if ret is None:
        return None
    cap = _RET_CAP.get(horizon)
    if cap is not None and abs(ret) > cap:
        return None
    return ret


def _refresh_cluster_returns(app_c, golden_c, snap: "_date") -> int:
    """Compute market-cap-weighted 1W / 1M / 1Y cluster returns and write
    them to app.cluster_composite_cache.

    Cross-DB step: pulls (symbol → cluster, market cap) from app DB and
    (symbol → prices at 4 horizons) from golden DB, joins in Python.
    Without this, /sectors had to do the per-symbol price query live on
    every uncached request — 3-4s on cold golden_db.

    Returns the number of cluster rows updated.
    """
    # ── 1. Per-symbol cluster + market cap (app DB) ──────────────────────
    with app_c.cursor() as cur:
        cur.execute("""
            SELECT u.symbol,
                   ca.cluster_id,
                   COALESCE(sm.market_cap_cr, 0)::float AS mcap
              FROM app.universe u
              JOIN app.cluster_assignment ca USING (symbol)
         LEFT JOIN app.screener_meta sm USING (symbol)
             WHERE u.is_active
        """)
        sym_meta = {r["symbol"]: (r["cluster_id"], r["mcap"] or 0.0) for r in cur.fetchall()}

    if not sym_meta:
        return 0

    # ── 2. Per-symbol prices at 4 horizons (golden DB) ───────────────────
    #
    # Correlated subqueries: per-symbol "most recent close on or before
    # X days ago".  Slower than a single-scan version (~5-10s vs ~1s) but
    # CORRECT in all cases — including when refresh-ltp hasn't filled
    # today's row for every symbol yet, or when individual symbols have
    # data gaps around our target dates.  This runs once per week during
    # the score ETL, so the slower query is fine; the web page reads from
    # the materialised cache and never sees this cost.
    #
    # syms is scoped to universe symbols only (passed in from Python) so
    # we don't waste work on the 3000+ non-universe symbols in golden.
    sym_ns_list = [f"{s}.NS" for s in sym_meta]
    with golden_c.cursor() as cur:
        cur.execute("""
            WITH latest_d AS (
                SELECT MAX(date) AS d FROM golden.price_history
                 WHERE interval = '1d' AND close IS NOT NULL
            ),
            syms AS (SELECT unnest(%s::text[]) AS symbol)
            SELECT
                REPLACE(s.symbol, '.NS', '') AS symbol,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                  ORDER BY p.date DESC LIMIT 1) AS p_now,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                  ORDER BY p.date DESC LIMIT 1) AS d_now,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '7 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_w1,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '7 days'
                  ORDER BY p.date DESC LIMIT 1) AS d_w1,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '30 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_m1,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '30 days'
                  ORDER BY p.date DESC LIMIT 1) AS d_m1,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '365 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_y1,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '365 days'
                  ORDER BY p.date DESC LIMIT 1) AS d_y1
            FROM syms s
        """, (sym_ns_list,))
        prices = {r["symbol"]: r for r in cur.fetchall()}

    # Returns use golden's split/bonus-ADJUSTED close (adj_close, selected
    # above) directly, so an ex_date inside a window isn't read as a real move.
    # This is the same series the price chart reads. (We previously back-adjusted
    # raw close via golden.corporate_actions, but that table was incomplete for
    # some names — e.g. ANGELONE's 1Y read +1119% instead of +20%.)

    # ── 3. Aggregate per cluster (market-cap-weighted) ───────────────────
    #
    # For each horizon h, cluster_ret[h] = Σ(mcap * (p_now/p_h - 1)) / Σ(mcap)
    # only for symbols where both p_now and p_h are present and p_h > 0.
    # Clusters with no qualifying symbol at a horizon get NULL — preserves
    # "we don't know" instead of fabricating zero.
    cluster_acc: dict[str, dict[str, tuple[float, float]]] = {}
    # cluster_acc[cluster_id][horizon] = (sum_weighted_returns, sum_mcaps)

    horizons = ("w1", "m1", "y1")
    for sym, (cluster_id, mcap) in sym_meta.items():
        row = prices.get(sym)
        if row is None or row["p_now"] is None or mcap <= 0:
            continue
        p_now = row["p_now"]
        bucket = cluster_acc.setdefault(cluster_id, {h: (0.0, 0.0) for h in horizons})
        for h in horizons:
            p_past = row.get(f"p_{h}")
            if p_past is None or p_past <= 0:
                continue
            ret = _sane_ret(p_now / p_past - 1.0, h)
            if ret is None:  # implausible → drop this symbol from the cluster avg
                continue
            sw, sm = bucket[h]
            bucket[h] = (sw + mcap * ret, sm + mcap)

    # ── 4. UPDATE cluster_composite_cache rows ───────────────────────────
    updates = []
    for cluster_id, hmap in cluster_acc.items():
        def _wavg(h: str) -> "float | None":
            sw, sm = hmap[h]
            return (sw / sm) if sm > 0 else None
        updates.append((
            _wavg("w1"), _wavg("m1"), _wavg("y1"),
            cluster_id, snap,
        ))

    if not updates:
        return 0

    with app_c.cursor() as cur:
        cur.executemany(
            """
            UPDATE app.cluster_composite_cache
               SET ret_1w = %s, ret_1m = %s, ret_1y = %s
             WHERE cluster_id = %s AND snapshot_date = %s
            """,
            updates,
        )
        return cur.rowcount


def _refresh_stocks_panel_cache(app_c, golden_c, snap: "_date") -> int:
    """Populate app.cluster_stocks_panel_cache for the given snapshot.

    One row per (snapshot_date, cluster_id, symbol) — pre-joined identity,
    score, market cap, current price, maturity tier, and 3-horizon price
    returns.  The /sectors page reads this entire table in one query and
    ships it to the client; every interaction (industry switch, tier
    filter, sector tab) becomes a client-side React state change with
    zero server round-trips.

    Returns the number of rows written.
    """
    # ── 1. All scored stock identity + score + meta rows (app DB) ────────
    with app_c.cursor() as cur:
        cur.execute("""
            SELECT
                s.symbol,
                s.cluster_id,
                u.company_name,
                sm.market_cap_cr::float                AS market_cap_cr,
                sm.current_price::float                AS current_price,
                s.composite_pct::float                 AS composite_pct,
                s.quality_pct::float                   AS quality_pct,
                s.valuation_pct::float                 AS valuation_pct,
                s.momentum_pct::float                  AS momentum_pct,
                s.maturity_tier
              FROM app.scores s
              JOIN app.universe u USING (symbol)
         LEFT JOIN app.screener_meta sm USING (symbol)
             WHERE s.snapshot_date = %s
        """, (snap,))
        score_rows = cur.fetchall()

    if not score_rows:
        return 0

    # ── 2. Per-symbol prices at 4 horizons (golden DB) ───────────────────
    #
    # Same correlated-subquery shape as _refresh_cluster_returns — slow but
    # correct under data gaps.  Scoped to the symbols we just pulled so we
    # don't waste work on the 3,000+ non-universe symbols in golden.
    sym_ns_list = [f"{r['symbol']}.NS" for r in score_rows]
    with golden_c.cursor() as cur:
        cur.execute("""
            WITH latest_d AS (
                SELECT MAX(date) AS d FROM golden.price_history
                 WHERE interval = '1d' AND close IS NOT NULL
            ),
            syms AS (SELECT unnest(%s::text[]) AS symbol)
            SELECT
                REPLACE(s.symbol, '.NS', '') AS symbol,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                  ORDER BY p.date DESC LIMIT 1) AS p_now,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                  ORDER BY p.date DESC LIMIT 1) AS d_now,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '7 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_w1,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '7 days'
                  ORDER BY p.date DESC LIMIT 1) AS d_w1,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '30 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_m1,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '30 days'
                  ORDER BY p.date DESC LIMIT 1) AS d_m1,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '365 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_y1,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '365 days'
                  ORDER BY p.date DESC LIMIT 1) AS d_y1,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '182 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_m6,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '730 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_y2,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '1825 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_y5,
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '3652 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_y10,
                -- Earliest adjusted-close bar golden has for the symbol → the
                -- "since inception (as far as we can see)" anchor for ret_all.
                (SELECT COALESCE(adj_close, close)::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                  ORDER BY p.date ASC LIMIT 1) AS p_all
            FROM syms s
        """, (sym_ns_list,))
        prices = {r["symbol"]: r for r in cur.fetchall()}

    # Returns use golden's split/bonus-ADJUSTED close (adj_close, selected in
    # the query above) directly — the same series the price chart reads — so an
    # ex_date inside a window isn't read as a real move. (We previously
    # back-adjusted raw close via golden.corporate_actions, but that table was
    # incomplete for some names — e.g. ANGELONE's 1Y read +1119% instead of +20%.)

    # ── 3. Compute per-stock returns + assemble rows ─────────────────────
    # _ret is horizon-aware so it can drop physically-impossible moves that
    # come from golden's occasional split-scale defects (see _sane_ret / _RET_CAP).
    def _ret(now, past, horizon):
        if now is None or past is None or past <= 0:
            return None
        return _sane_ret(now / past - 1.0, horizon)

    rows = []
    for r in score_rows:
        p = prices.get(r["symbol"])
        p_now = p["p_now"] if p else None
        rows.append((
            snap, r["cluster_id"], r["symbol"], r["company_name"],
            r["market_cap_cr"], r["current_price"],
            r["composite_pct"], r["quality_pct"], r["valuation_pct"], r["momentum_pct"],
            r["maturity_tier"],
            _ret(p_now, p["p_w1"], "w1") if p else None,
            _ret(p_now, p["p_m1"], "m1") if p else None,
            _ret(p_now, p["p_y1"], "y1") if p else None,
            _ret(p_now, p["p_m6"], "m6") if p else None,
            _ret(p_now, p["p_y2"], "y2") if p else None,
            _ret(p_now, p["p_y5"], "y5") if p else None,
            _ret(p_now, p["p_y10"], "y10") if p else None,
            _ret(p_now, p["p_all"], "all") if p else None,
        ))

    # ── 4. DELETE this snapshot's old rows + bulk INSERT ─────────────────
    with app_c.cursor() as cur:
        cur.execute(
            "DELETE FROM app.cluster_stocks_panel_cache WHERE snapshot_date = %s",
            (snap,),
        )
        cur.executemany(
            """
            INSERT INTO app.cluster_stocks_panel_cache (
                snapshot_date, cluster_id, symbol, company_name,
                market_cap_cr, current_price,
                composite_pct, quality_pct, valuation_pct, momentum_pct,
                maturity_tier,
                ret_1w, ret_1m, ret_1y,
                ret_6m, ret_2y, ret_5y, ret_10y, ret_all
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s,
                %s, %s, %s, %s,
                %s,
                %s, %s, %s,
                %s, %s, %s, %s, %s
            )
            """,
            rows,
        )
        return cur.rowcount


@app.command("score")
def score_cmd(
    snapshot: str = typer.Option(None, help="YYYY-MM-DD; defaults to today"),
    fail_on_dq: bool = typer.Option(
        True,
        help="Exit non-zero if a DQ or coverage assertion fails. The scores are "
             "still written and committed either way — this only controls the "
             "exit code. Keep it on in CI; a failed assertion that exits 0 is "
             "how the last coverage hole stayed invisible."),
):
    """Run the percentile + composite scorer for a snapshot date.

    Also refreshes app.cluster_composite_cache so the /sectors page serves
    pre-computed data on the next request (avoids recomputing PERCENT_RANK
    windows on every web hit).
    """
    configure_logging()
    snap = _date.fromisoformat(snapshot) if snapshot else _date.today()
    log.info("score_start", snapshot=snap.isoformat())

    # Initialised here, not inside the try blocks below. Both check blocks are
    # best-effort and swallow their exceptions, so if one dies before assigning
    # these the exit gate must still find a defined (and empty) list rather than
    # raise NameError and turn a survivable DQ hiccup into a crash.
    dq_failed_names: list[str] = []
    cov_failed_names: list[str] = []

    # Freshness gate — refuse to score off a stale price feed. A bhav-copy
    # import that silently no-op'd leaves golden's newest bar stuck; scoring
    # would then compute momentum/returns off stale closes and publish them as
    # fresh. Abort HERE, before app.scores is touched, so we never overwrite
    # good scores with stale-data ones. Only enforced for a live "today" run —
    # an explicit historical --snapshot is a backfill where "days behind today"
    # is meaningless and must not be blocked. A golden CONNECTION error is not
    # the stale-data case this guards; it degrades to a warning (the downstream
    # returns refresh already handles golden being unavailable gracefully).
    if snapshot is None or snap == _date.today():
        from .dq import run_golden_assertions
        try:
            with golden_conn() as gc:
                gresults = run_golden_assertions(gc)
        except Exception as e:
            log.warning("score_golden_freshness_check_errored", error=str(e)[:200])
            gresults = []
        stale = next(
            (r for r in gresults
             if r.name == "golden.price_feed_days_behind" and not r.passed),
            None,
        )
        if stale is not None:
            log.error(
                "score_aborted_stale_price_feed",
                days_behind=int(stale.actual_pct),
                max_allowed=int(stale.threshold_pct),
            )
            raise typer.Exit(code=1)
        # Coverage / sentinel failures are logged but don't abort — they flag a
        # partial or garbage import (a data-quality signal), not the poisoning
        # stale-feed case the abort exists for.
        for r in gresults:
            if not r.passed:
                log.warning(
                    "dq_check_failed", name=r.name, actual=r.actual_pct,
                    threshold=r.threshold_pct, populated=r.populated, total=r.total,
                )

    with app_conn() as conn:
        counts = score_snapshot(conn, snap)
        conn.commit()
        # Refresh the materialized cache so /sectors never runs the expensive
        # PERCENT_RANK() view live.  Runs in the same connection, committed
        # together so a partial failure leaves the cache unchanged.
        try:
            cache_rows = _refresh_cluster_cache(conn, snap)
            conn.commit()
            log.info("cluster_cache_refreshed", rows=cache_rows, snapshot=snap.isoformat())
        except Exception as e:
            log.warning("cluster_cache_refresh_failed", error=str(e)[:200])
            # Non-fatal: old cache is still valid; /sectors falls back gracefully.
            conn.rollback()

        # Populate the price-return columns (cross-DB step — needs golden).
        # Eliminates the live golden_db query that previously made /sectors
        # take 3-4s on cold start.
        try:
            with golden_conn() as gc:
                ret_rows = _refresh_cluster_returns(conn, gc, snap)
            conn.commit()
            log.info("cluster_returns_refreshed", rows=ret_rows, snapshot=snap.isoformat())
        except Exception as e:
            log.warning("cluster_returns_refresh_failed", error=str(e)[:200])
            conn.rollback()

        # Populate the per-stock panel cache so /sectors can ship the full
        # 2,150-row dataset to the client in one fetch and make industry
        # clicks / tier filters / sector tabs zero-cost client-side state.
        try:
            with golden_conn() as gc:
                panel_rows = _refresh_stocks_panel_cache(conn, gc, snap)
            conn.commit()
            log.info("stocks_panel_cache_refreshed", rows=panel_rows, snapshot=snap.isoformat())
        except Exception as e:
            log.warning("stocks_panel_cache_refresh_failed", error=str(e)[:200])
            conn.rollback()

        # Data-quality assertions — catch the class of regression we saw with
        # the operating_profit-NULL bug (parser change silently zeroed a
        # column across 19,873 rows).  Each failure is logged as a warning
        # so the operator notices on the next score run.  Doesn't block.
        try:
            from .dq import run_assertions, run_golden_assertions, summarize
            results = run_assertions(conn)
            # Golden EOD price-feed freshness/coverage — catches the "bhav copy
            # imported but 0 stocks updated" silent no-op that every app.* check
            # above would miss. Best-effort: a golden hiccup here is its own
            # warning, not a reason to drop the app-side results.
            try:
                with golden_conn() as gc:
                    results = results + run_golden_assertions(gc)
            except Exception as e:
                log.warning("dq_golden_checks_errored", error=str(e)[:200])
            passed, failed = summarize(results)
            for r in results:
                if not r.passed:
                    log.warning("dq_check_failed", name=r.name,
                                actual=r.actual_pct, threshold=r.threshold_pct,
                                populated=r.populated, total=r.total)
            log.info("dq_checks_done", passed=passed, failed=failed, total=len(results))
            dq_failed_names = [r.name for r in results if not r.passed]
        except Exception as e:
            # DQ checks failing to RUN is itself a warning, not a hard error.
            log.warning("dq_checks_errored", error=str(e)[:200])

        # Coverage ledger — the accounting pass. Every active symbol is filed
        # into exactly one bucket and the partition is asserted, so a symbol
        # cannot fall out of the pipeline unnoticed the way 472 never-scraped
        # names did for months. See coverage.py for why this replaces the
        # hand-tuned row-count thresholds rather than adding to them.
        #
        # This runs LAST, after scores and metrics have landed, because it
        # classifies the end state of this snapshot. It is best-effort in the
        # same sense as the DQ block — an accounting failure must not roll back
        # a good scoring run — but unlike DQ it prints the full table every
        # time, pass or fail, because the bucket movement IS the report.
        try:
            from .coverage import (
                write_ledger, check_partition, check_no_problems,
                check_no_regression, delta_report, format_report,
            )
            bucket_counts = write_ledger(conn, snap)
            conn.commit()
            rows, prev = delta_report(conn, snap)
            for line in format_report(rows, prev, snap).splitlines():
                log.info("coverage", line=line)
            cov = (check_partition(conn, snap)
                   + check_no_problems(conn, snap)
                   + check_no_regression(conn, snap))
            for r in cov:
                (log.info if r.passed else log.warning)(
                    "coverage_check", name=r.name, passed=r.passed, detail=r.message)
            log.info("coverage_done",
                     failed=sum(1 for r in cov if not r.passed),
                     total=len(cov), **bucket_counts)
            cov_failed_names = [r.name for r in cov if not r.passed]
        except Exception as e:
            log.warning("coverage_ledger_errored", error=str(e)[:200])
            conn.rollback()
    log.info("score_done", **counts)

    # Exit non-zero when an assertion failed — but only HERE, after every write
    # has committed.
    #
    # The old behaviour logged each failure as a warning and exited 0. The
    # reasoning was sound and is preserved: a DQ failure must never roll back a
    # good scoring run. But "don't roll back" got conflated with "don't report",
    # and the result was a workflow that went green while telling us 81.4%
    # coverage against a 90% threshold. Nobody reads a green job's logs. That is
    # the whole mechanism by which a measured, correctly-reported failure stayed
    # invisible.
    #
    # Splitting the two concerns costs nothing: the data is already saved and
    # committed by this point, so the exit code is pure signal. The run keeps
    # its results AND the badge turns red.
    if fail_on_dq and (dq_failed_names or cov_failed_names):
        log.error("exit_nonzero", reason="data-quality assertions failed after a completed run",
                  dq_failed=dq_failed_names, coverage_failed=cov_failed_names)
        raise typer.Exit(code=1)


@app.command("coverage")
def coverage_cmd(
    snapshot: Optional[str] = typer.Option(
        None, help="Snapshot date (YYYY-MM-DD). Defaults to the latest scored snapshot."),
    write: bool = typer.Option(
        False, "--write",
        help="Recompute and persist the ledger for this snapshot before reporting. "
             "Off by default so the report is a pure read."),
    fail_on_problem: bool = typer.Option(
        True,
        help="Exit non-zero if any problem bucket is non-empty or the partition "
             "does not reconcile. Keep this on in CI — a coverage hole that exits "
             "0 is how the last one stayed invisible for five months."),
):
    """Report where every active symbol ended up, and assert the partition.

    The replacement for --snapshot-min-rows and friends. Contains no tunable
    thresholds: the assertions are 'the buckets sum to the universe', 'nothing
    is unclassified', and 'the problem buckets are empty'. None of those rot as
    the universe grows, which is the specific way every previous check failed.
    """
    from .coverage import (
        write_ledger, check_partition, check_no_problems,
        check_no_regression, delta_report, format_report,
    )
    configure_logging()

    with app_conn() as conn:
        if snapshot:
            snap = _date.fromisoformat(snapshot)
        else:
            with conn.cursor() as cur:
                cur.execute("SELECT MAX(snapshot_date) AS d FROM app.scores")
                row = cur.fetchone()
                snap = row["d"] if row else None
        if snap is None:
            log.error("no_snapshot_found")
            raise typer.Exit(code=1)

        if write:
            write_ledger(conn, snap)
            conn.commit()

        rows, prev = delta_report(conn, snap)
        print(format_report(rows, prev, snap))
        print()

        results = (check_partition(conn, snap)
                   + check_no_problems(conn, snap)
                   + check_no_regression(conn, snap))
        for r in results:
            print(r.short())

        failed = [r for r in results if not r.passed]
        skipped = [r for r in results if r.skipped]
        print()
        # Skips are counted OUT of "passed" rather than silently into it. A
        # summary line reading "17 passed, 0 failed" when one of the 17 did not
        # run is the same class of comfortable untruth this whole command exists
        # to remove.
        print(f"{len(results) - len(failed) - len(skipped)} passed, "
              f"{len(failed)} failed, {len(skipped)} skipped")
        if failed and fail_on_problem:
            raise typer.Exit(code=1)


@app.command("import-themes")
def import_themes_cmd(
    throttle: float = typer.Option(
        0.4, help="Seconds to pause between theme pages (110 pages ≈ 1 min)"),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Fetch and resolve, then roll back"),
) -> None:
    """Import the external theme taxonomy into app.theme / app.theme_member.

    Membership only — every price, return and score on a theme page comes from
    our own panel cache. Names that do not resolve to exactly one NSE symbol are
    parked in app.theme_alias for review rather than fuzzy-matched; see
    themes/resolve.py for why that line is drawn hard.

    Safe to re-run: themes upsert, membership is replaced per theme, and human
    decisions in theme_alias are never overwritten.
    """
    configure_logging()
    from .themes.importer import run as run_theme_import

    st = run_theme_import(throttle=throttle, dry_run=dry_run)
    if st.queued:
        log.warning("theme_names_awaiting_review", count=st.queued)


if __name__ == "__main__":
    app()
