"""Import the theme taxonomy and its membership into app.theme*.

Idempotent by construction: themes upsert on (source, slug), membership for a
theme is replaced wholesale inside one transaction, and the alias queue only
ever gains rows — a human decision is never overwritten by a later run.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..db import app_conn
import structlog
from . import resolve as R
from .source import Category, SourceStock, client, crawl, fetch_categories

log = structlog.get_logger()

# The source's own id ordering separates its original sector taxonomy from
# everything bolted on later. ids <= this are conventional sectors that our
# cluster tree already expresses; above it are the narrative themes (Drone,
# Data Center, Green Hydrogen) that it cannot. We import both — the user asked
# for the whole catalogue — but tag them so the UI can lead with themes.
SECTOR_ID_CEILING = 50


@dataclass
class ImportStats:
    themes: int = 0
    members: int = 0
    exact: int = 0
    alias: int = 0
    queued: int = 0
    ambiguous: int = 0
    empty_themes: int = 0


def run(throttle: float = 0.4, dry_run: bool = False) -> ImportStats:
    st = ImportStats()

    with client() as c:
        cats: list[Category] = fetch_categories(c)
        log.info("theme_catalogue", categories=len(cats))
        crawled: dict[str, list[SourceStock]] = crawl(c, cats, throttle=throttle, log=log)

    with app_conn() as conn:
        cur = conn.cursor()

        # Identity index + decisions already made by a human.
        cur.execute(
            "SELECT symbol, company_name FROM app.universe WHERE is_active"
        )
        idx = R.build_index([(r["symbol"], r["company_name"]) for r in cur.fetchall()])

        cur.execute(
            "SELECT source_name, symbol FROM app.theme_alias WHERE status = 'approved'"
        )
        approved = {r["source_name"]: r["symbol"] for r in cur.fetchall()}

        cur.execute("SELECT source_name FROM app.theme_alias")
        known = {r["source_name"] for r in cur.fetchall()}

        for order, cat in enumerate(cats):
            stocks = crawled.get(cat.slug, [])
            if not stocks:
                st.empty_themes += 1

            kind = "sector" if cat.source_id <= SECTOR_ID_CEILING else "theme"
            cur.execute(
                """
                INSERT INTO app.theme (source, source_id, slug, label, kind,
                                       display_order, is_active, refreshed_at)
                VALUES ('financialexpress', %s, %s, %s, %s, %s, TRUE, NOW())
                ON CONFLICT (source, slug) DO UPDATE
                   SET source_id     = EXCLUDED.source_id,
                       label         = EXCLUDED.label,
                       kind          = EXCLUDED.kind,
                       display_order = EXCLUDED.display_order,
                       is_active     = TRUE,
                       refreshed_at  = NOW()
                RETURNING id
                """,
                (cat.source_id, cat.slug, cat.label, kind, order),
            )
            theme_id = cur.fetchone()["id"]
            st.themes += 1

            rows: list[tuple[int, str, str, str]] = []
            seen_syms: set[str] = set()
            for s in stocks:
                sym = approved.get(s.name)
                method = "alias"
                if sym is None:
                    sym = R.resolve(s.name, idx)
                    method = "exact"
                if sym is None:
                    # Park it. `known` guards the human decision: once a name is
                    # in the queue — pending, approved or rejected — a later run
                    # must not reset it.
                    if s.name not in known:
                        cur.execute(
                            """
                            INSERT INTO app.theme_alias (source_name, status, suggestion, note)
                            VALUES (%s, 'pending', %s, %s)
                            ON CONFLICT (source_name) DO NOTHING
                            """,
                            (s.name, R.suggest(s.name, idx), f"first seen in {cat.slug}"),
                        )
                        known.add(s.name)
                        st.queued += 1
                    continue
                # Two upstream names can resolve to one symbol (a rename in
                # flight). PK is (theme_id, symbol), so keep the first.
                if sym in seen_syms:
                    continue
                seen_syms.add(sym)
                rows.append((theme_id, sym, s.name, method))
                st.exact += method == "exact"
                st.alias += method == "alias"

            # Replace membership wholesale rather than diffing: a stock dropped
            # upstream must disappear here, and a diff that only ever adds is
            # how a theme page slowly fills with companies that left it.
            cur.execute("DELETE FROM app.theme_member WHERE theme_id = %s", (theme_id,))
            cur.executemany(
                """
                INSERT INTO app.theme_member (theme_id, symbol, source_name, match_method)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (theme_id, symbol) DO NOTHING
                """,
                rows,
            )
            st.members += len(rows)

        # Anything we did not see this run is gone upstream. Deactivate, never
        # delete — see the migration header.
        cur.execute(
            """
            UPDATE app.theme SET is_active = FALSE
             WHERE source = 'financialexpress'
               AND slug <> ALL(%s)
               AND is_active
            """,
            ([c.slug for c in cats],),
        )

        if dry_run:
            conn.rollback()
            log.warning("theme_import_dry_run_rollback")
        else:
            conn.commit()

    log.info(
        "theme_import_done",
        themes=st.themes, members=st.members, exact=st.exact,
        alias=st.alias, queued=st.queued, empty=st.empty_themes,
    )
    return st
