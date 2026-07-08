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
from .screener.scraper import (
    AuthFailed, NotFound, ScrapeError, fetch_company_export, make_client,
)
from .screener.parser import parse_export, merge_parsed, ParseError
from .screener.persist import (
    save_raw_export, save_parsed, update_meta_success, update_meta_failure,
)
from .scoring.metrics import compute_metrics_for_symbol, persist_metrics, load_nifty_returns
from .scoring.scorecards import load_db_overrides
from .scoring.scorer import score_snapshot

app = typer.Typer(no_args_is_help=True, add_completion=False)


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
    ok = fail = 0
    client = make_nse_client()
    try:
        for i, sym in enumerate(symbols, 1):
            try:
                parsed = fetch_nse_results(sym, client=client)
                if save:
                    with app_conn() as conn:
                        _, qtr = save_parsed(conn, sym, parsed, datetime.now(timezone.utc))
                        conn.commit()
                    log.info("nse_saved", symbol=sym, quarters=qtr)
                else:
                    log.info("nse_dry_run", symbol=sym, quarters=len(parsed.quarterly))
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
    log.info("fetch_nse_done", ok=ok, failed=fail, total=len(symbols))


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
                ORDER BY m.last_scraped_at NULLS FIRST, u.symbol
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
            # stock be scored off stale annuals alone. If the primary
            # (consolidated) parse has no quarterly rows, pull the standalone
            # export and backfill the missing quarters. Consolidated annuals
            # still win on any overlap; standalone is pure fill.
            if not parsed.quarterly and info.variant == "consolidated":
                try:
                    s_info, s_data = fetch_company_export(
                        symbol, client=client, prefer="standalone"
                    )
                    parsed = merge_parsed(parsed, parse_export(s_data))
                    log.info("standalone_quarterly_merge", symbol=symbol,
                             quarters=len(parsed.quarterly))
                except (NotFound, ScrapeError, ParseError) as e:
                    # Fallback is best-effort — a missing standalone view just
                    # means we save what we have (consolidated annuals).
                    log.warning("standalone_fallback_failed", symbol=symbol,
                                error=str(e)[:120])
            with app_conn() as conn:
                fetched_at = save_raw_export(conn, symbol, data)
                ann, qtr = save_parsed(conn, symbol, parsed, fetched_at)
                update_meta_success(conn, symbol, info.export_id, len(data))
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
        log.info("plan", n=len(stocks))

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


def _load_corp_actions(golden_c, symbols) -> dict:
    """Bulk-load corporate actions for a set of bare symbols.

    Returns {bare_symbol: [(ex_date, split_factor), ...]} ascending by ex_date.
    split_factor is the on-ex-date price multiplier (1:5 split ≈ 0.2, 1:2
    bonus ≈ 0.667) — the same field metrics.load_split_factors uses. One
    query for the whole universe instead of a per-symbol roundtrip.
    """
    sym_ns = [f"{s}.NS" for s in symbols]
    out: dict = {}
    if not sym_ns:
        return out
    with golden_c.cursor() as cur:
        cur.execute("""
            SELECT REPLACE(symbol, '.NS', '') AS symbol, ex_date, split_factor
              FROM golden.corporate_actions
             WHERE symbol = ANY(%s)
               AND split_factor IS NOT NULL AND split_factor > 0
             ORDER BY ex_date ASC
        """, (sym_ns,))
        for r in cur.fetchall():
            out.setdefault(r["symbol"], []).append((r["ex_date"], float(r["split_factor"])))
    return out


def _adjust_close(price, price_date, actions):
    """Back-adjust a historical close onto the current (post-split) scale.

    golden.price_history is RAW: on a split/bonus ex_date the close steps
    down by the split factor. Comparing a pre-ex close to a post-ex close
    (as every N-day return does) reads that cosmetic step as a real crash —
    e.g. KOTAKBANK's 1:5 split showed as −82% instead of ~−11%. We multiply
    the close by the product of split_factors for every ex_date STRICTLY
    AFTER its bar, matching metrics.load_price_history's semantics.
    """
    if price is None or price_date is None or not actions:
        return price
    factor = 1.0
    for ex_date, sf in actions:
        if ex_date > price_date:
            factor *= sf
    return price * factor


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
                (SELECT close::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                  ORDER BY p.date DESC LIMIT 1) AS p_now,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                  ORDER BY p.date DESC LIMIT 1) AS d_now,
                (SELECT close::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '7 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_w1,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '7 days'
                  ORDER BY p.date DESC LIMIT 1) AS d_w1,
                (SELECT close::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '30 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_m1,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '30 days'
                  ORDER BY p.date DESC LIMIT 1) AS d_m1,
                (SELECT close::float FROM golden.price_history p
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

    # Corporate-action adjustment: back-adjust every close onto the current
    # scale before computing returns, so a split/bonus ex_date inside a window
    # isn't read as a real move (see _adjust_close).
    corp_actions = _load_corp_actions(golden_c, list(sym_meta))

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
        acts = corp_actions.get(sym)
        p_now = _adjust_close(row["p_now"], row.get("d_now"), acts)
        bucket = cluster_acc.setdefault(cluster_id, {h: (0.0, 0.0) for h in horizons})
        for h in horizons:
            p_past = _adjust_close(row.get(f"p_{h}"), row.get(f"d_{h}"), acts)
            if p_past is None or p_past <= 0:
                continue
            ret = p_now / p_past - 1.0
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
                (SELECT close::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                  ORDER BY p.date DESC LIMIT 1) AS p_now,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                  ORDER BY p.date DESC LIMIT 1) AS d_now,
                (SELECT close::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '7 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_w1,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '7 days'
                  ORDER BY p.date DESC LIMIT 1) AS d_w1,
                (SELECT close::float FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '30 days'
                  ORDER BY p.date DESC LIMIT 1) AS p_m1,
                (SELECT date FROM golden.price_history p
                  WHERE p.symbol = s.symbol AND p.interval = '1d' AND p.close IS NOT NULL
                    AND p.date <= (SELECT d FROM latest_d) - INTERVAL '30 days'
                  ORDER BY p.date DESC LIMIT 1) AS d_m1,
                (SELECT close::float FROM golden.price_history p
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

    # Back-adjust closes for splits/bonuses before computing returns (see
    # _adjust_close) so an ex_date inside a window isn't read as a real move.
    corp_actions = _load_corp_actions(golden_c, [r["symbol"] for r in score_rows])

    # ── 3. Compute per-stock returns + assemble rows ─────────────────────
    def _ret(now, past):
        if now is None or past is None or past <= 0:
            return None
        return now / past - 1.0

    rows = []
    for r in score_rows:
        p = prices.get(r["symbol"])
        acts = corp_actions.get(r["symbol"])
        p_now = _adjust_close(p["p_now"], p.get("d_now"), acts) if p else None
        rows.append((
            snap, r["cluster_id"], r["symbol"], r["company_name"],
            r["market_cap_cr"], r["current_price"],
            r["composite_pct"], r["quality_pct"], r["valuation_pct"], r["momentum_pct"],
            r["maturity_tier"],
            _ret(p_now, _adjust_close(p["p_w1"], p.get("d_w1"), acts)) if p else None,
            _ret(p_now, _adjust_close(p["p_m1"], p.get("d_m1"), acts)) if p else None,
            _ret(p_now, _adjust_close(p["p_y1"], p.get("d_y1"), acts)) if p else None,
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
                ret_1w, ret_1m, ret_1y
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s,
                %s, %s, %s, %s,
                %s,
                %s, %s, %s
            )
            """,
            rows,
        )
        return cur.rowcount


@app.command("score")
def score_cmd(snapshot: str = typer.Option(None, help="YYYY-MM-DD; defaults to today")):
    """Run the percentile + composite scorer for a snapshot date.

    Also refreshes app.cluster_composite_cache so the /sectors page serves
    pre-computed data on the next request (avoids recomputing PERCENT_RANK
    windows on every web hit).
    """
    configure_logging()
    snap = _date.fromisoformat(snapshot) if snapshot else _date.today()
    log.info("score_start", snapshot=snap.isoformat())
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
            from .dq import run_assertions, summarize
            results = run_assertions(conn)
            passed, failed = summarize(results)
            for r in results:
                if not r.passed:
                    log.warning("dq_check_failed", name=r.name,
                                actual=r.actual_pct, threshold=r.threshold_pct,
                                populated=r.populated, total=r.total)
            log.info("dq_checks_done", passed=passed, failed=failed, total=len(results))
        except Exception as e:
            # DQ checks failing to RUN is itself a warning, not a hard error.
            log.warning("dq_checks_errored", error=str(e)[:200])
    log.info("score_done", **counts)


if __name__ == "__main__":
    app()
