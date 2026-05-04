"""ETL CLI entrypoint."""
from __future__ import annotations

import time
from typing import Optional

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
from .screener.parser import parse_export, ParseError
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
):
    """Fetch + parse a single ticker. Useful for manual testing."""
    configure_logging()
    log.info("fetch_start", symbol=symbol)
    info, data = fetch_company_export(symbol)
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


@app.command()
def fetch_many(
    limit: Optional[int] = typer.Option(None, help="Cap the number of symbols processed"),
    only: Optional[str] = typer.Option(None, help="Comma-separated list of symbols (overrides queue)"),
    skip_recent_hours: int = typer.Option(20, help="Skip symbols scraped within this many hours"),
    stop_on_auth_fail: bool = typer.Option(True, help="Halt the run if Screener cookies expire"),
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

    log.info("backfill_plan", total=len(symbols), throttle_s=settings.screener_throttle_seconds)
    if not symbols:
        log.info("nothing_to_do")
        return

    client = make_client()
    ok = fail = 0
    try:
        for i, symbol in enumerate(symbols, start=1):
            try:
                info, data = fetch_company_export(symbol, client=client)
                parsed = parse_export(data)
                with app_conn() as conn:
                    fetched_at = save_raw_export(conn, symbol, data)
                    ann, qtr = save_parsed(conn, symbol, parsed, fetched_at)
                    update_meta_success(conn, symbol, info.export_id, len(data))
                    conn.commit()
                ok += 1
                log.info("ok", i=i, n=len(symbols), symbol=symbol,
                         annual=ann, quarterly=qtr, bytes=len(data))
            except AuthFailed as e:
                fail += 1
                with app_conn() as conn:
                    update_meta_failure(conn, symbol, "auth_failed", str(e))
                    conn.commit()
                log.error("auth_failed", symbol=symbol, error=str(e))
                if stop_on_auth_fail:
                    log.error("halting_run", reason="screener cookies expired — re-extract them")
                    break
            except NotFound as e:
                fail += 1
                with app_conn() as conn:
                    update_meta_failure(conn, symbol, "not_found", str(e))
                    conn.commit()
                log.warning("not_found", symbol=symbol)
            except ParseError as e:
                fail += 1
                with app_conn() as conn:
                    update_meta_failure(conn, symbol, "parse_error", str(e))
                    conn.commit()
                log.error("parse_error", symbol=symbol, error=str(e))
            except ScrapeError as e:
                fail += 1
                with app_conn() as conn:
                    update_meta_failure(conn, symbol, "http_error", str(e))
                    conn.commit()
                log.error("scrape_error", symbol=symbol, error=str(e))
            except Exception as e:  # pragma: no cover — surface unexpected
                fail += 1
                with app_conn() as conn:
                    update_meta_failure(conn, symbol, "unknown", repr(e))
                    conn.commit()
                log.exception("unexpected", symbol=symbol)

            if i < len(symbols):
                time.sleep(settings.screener_throttle_seconds)
    finally:
        client.close()

    log.info("backfill_done", ok=ok, failed=fail, total=len(symbols))


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
                try:
                    cm, meta, status = compute_metrics_for_symbol(
                        ac, gc, s["symbol"], s["cluster_id"], s["maturity_tier"], nifty,
                        scorecard_overrides=overrides,
                    )
                    persist_metrics(ac, s["symbol"], snap, cm, meta, s["maturity_tier"], status)
                    ok += 1
                    if i % 100 == 0:
                        ac.commit()
                        log.info("progress", done=i, n=len(stocks), ok=ok, failed=fail)
                except Exception as e:
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


@app.command("score")
def score_cmd(snapshot: str = typer.Option(None, help="YYYY-MM-DD; defaults to today")):
    """Run the percentile + composite scorer for a snapshot date."""
    configure_logging()
    snap = _date.fromisoformat(snapshot) if snapshot else _date.today()
    log.info("score_start", snapshot=snap.isoformat())
    with app_conn() as conn:
        counts = score_snapshot(conn, snap)
        conn.commit()
    log.info("score_done", **counts)


if __name__ == "__main__":
    app()
