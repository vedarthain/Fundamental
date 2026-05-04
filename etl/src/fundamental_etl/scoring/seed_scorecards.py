"""Seed app.cluster_scorecard from the Python SCORECARDS_MATURE config.

Idempotent: only inserts rows for clusters that don't already have one.
Use --force to overwrite (creates a new effective_from row, audit trail preserved).
"""
from __future__ import annotations

import argparse
import json

from ..db import app_conn
from ..log import configure_logging, log
from .scorecards import SCORECARDS_MATURE


def seed(force: bool = False) -> dict[str, int]:
    counts = {"inserted": 0, "skipped": 0, "overwritten": 0}
    with app_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT cluster_id FROM app.cluster_scorecard_active")
            existing = {r["cluster_id"] for r in cur.fetchall()}

            for cid, sc in SCORECARDS_MATURE.items():
                if cid in existing and not force:
                    counts["skipped"] += 1
                    continue
                # serialize loss_maker_val_fallback as list of [name, share] pairs
                fb = [[fname, share] for fname, share in sc.loss_maker_val_fallback]
                cur.execute(
                    """
                    INSERT INTO app.cluster_scorecard
                      (cluster_id, pillar_weights, quality, valuation, momentum,
                       loss_maker_val_fallback, edited_by, notes)
                    VALUES (%s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
                            'seed', 'Initial seed from Python SCORECARDS_MATURE')
                    """,
                    (
                        cid,
                        json.dumps(sc.pillar_weights),
                        json.dumps(sc.quality),
                        json.dumps(sc.valuation),
                        json.dumps(sc.momentum),
                        json.dumps(fb),
                    ),
                )
                if cid in existing:
                    counts["overwritten"] += 1
                else:
                    counts["inserted"] += 1
        conn.commit()
    return counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Overwrite existing rows")
    args = parser.parse_args()
    configure_logging()
    counts = seed(force=args.force)
    log.info("seed_done", **counts)


if __name__ == "__main__":
    main()
