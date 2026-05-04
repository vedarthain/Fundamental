"""Percentile + composite score computation.

For each (cluster_id, maturity_tier) bucket on a snapshot_date:
  1. Pull every stock's metrics from app.metrics_snapshot
  2. For each formula in the cluster's tier-variant scorecard, compute percentile rank
     within the bucket (direction-aware: lower-better metrics are inverted)
  3. Loss-maker handling: if pe_ttm is null, splice in fallback formulas at pe_ttm's weight
  4. Weighted blend per pillar → quality_pct, valuation_pct, momentum_pct
  5. composite = pillar-weighted blend → re-percentile within bucket → composite_pct
  6. Persist sub-percentiles for explainability

Fallback for thin (cluster, tier) buckets (<10 peers): percentile against (meta_cluster, tier);
flag score_status='partial-meta-cluster'.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Optional

import psycopg

from .formulas import REGISTRY as FORMULAS
from .scorecards import Scorecard, get_scorecard, get_scorecard_from, load_db_overrides

MIN_PEERS = 10


def _percentile_rank(values: list[Optional[float]], higher_is_better: bool) -> list[Optional[int]]:
    """Return percentile (0-100) for each value, ignoring nulls. Direction-aware.

    Convention: percentile=100 means BEST in the peer set (top), percentile=1 means worst.
    For higher_is_better=True, the largest value gets 100.
    For higher_is_better=False (e.g. P/E, debt/equity — lower is better), the smallest value gets 100.
    """
    indexed = [(i, v) for i, v in enumerate(values) if v is not None]
    if not indexed:
        return [None] * len(values)
    # Sort so that the BEST value lands at rank_pos=0 (gets pct=100).
    # higher_is_better → sort DESCENDING (largest first)
    # !higher_is_better → sort ASCENDING (smallest first)
    indexed.sort(key=lambda iv: iv[1], reverse=higher_is_better)
    n = len(indexed)
    pcts: dict[int, int] = {}
    for rank_pos, (i, _v) in enumerate(indexed):
        pcts[i] = int(round(100 * (n - rank_pos) / n))
    return [pcts.get(i) for i in range(len(values))]


def _splice_loss_maker_fallback(
    valuation_weights: dict[str, float],
    fallbacks: list[tuple[str, float]],
    metrics_per_stock: list[dict[str, Optional[float]]],
) -> list[dict[str, float]]:
    """For each stock in the bucket, if pe_ttm is null, replace its weight with the fallback weights.

    Returns a per-stock weights dict (not a single shared dict) so each stock can carry its own
    valuation weights blueprint.
    """
    out = []
    for s_metrics in metrics_per_stock:
        w = dict(valuation_weights)
        if "pe_ttm" in w and s_metrics.get("pe_ttm") is None:
            pe_w = w.pop("pe_ttm")
            for fname, share in fallbacks:
                if s_metrics.get(fname) is not None:
                    w[fname] = w.get(fname, 0) + pe_w * share
            # If even the fallback is null, the weight is just lost (renormalized later)
        out.append(w)
    return out


def _renorm(weights: dict[str, float]) -> dict[str, float]:
    s = sum(weights.values())
    if s <= 0:
        return weights
    return {k: v / s for k, v in weights.items()}


def _weighted_pillar_score(
    component_pcts: dict[str, Optional[int]],
    weights: dict[str, float],
) -> Optional[float]:
    """Renormalize across non-null components, then weighted sum."""
    valid = {k: w for k, w in weights.items() if component_pcts.get(k) is not None}
    if not valid:
        return None
    s = sum(valid.values())
    if s <= 0:
        return None
    score = sum(component_pcts[k] * (w / s) for k, w in valid.items())
    return score


def _bucket_key(cluster_id: str, tier: str) -> str:
    return f"{cluster_id}|{tier}"


def score_snapshot(conn: psycopg.Connection, snapshot_date: date) -> dict[str, int]:
    """Run the full scoring pass for a given snapshot_date.

    Reads from app.metrics_snapshot, writes to app.scores. Returns counts.
    """
    # Step 1: load all (symbol, cluster, tier, metrics) for this snapshot
    with conn.cursor() as cur:
        cur.execute("""
            SELECT m.symbol, ca.cluster_id, m.maturity_tier, m.cluster_metrics, m.score_status,
                   c.meta_cluster_id
            FROM app.metrics_snapshot m
            JOIN app.cluster_assignment ca USING (symbol)
            JOIN app.cluster c ON c.id = ca.cluster_id
            WHERE m.snapshot_date = %s
              AND m.maturity_tier IN ('veteran','mature','mid','new')
              AND m.score_status <> 'insufficient_data'
        """, (snapshot_date,))
        rows = cur.fetchall()

    # Group by (cluster, tier) and (cluster, *) and (meta_cluster, tier)
    buckets: dict[str, list[dict]] = defaultdict(list)
    cluster_all_tiers: dict[str, list[dict]] = defaultdict(list)
    meta_buckets: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        buckets[_bucket_key(r["cluster_id"], r["maturity_tier"])].append(r)
        cluster_all_tiers[r["cluster_id"]].append(r)
        meta_buckets[_bucket_key(r["meta_cluster_id"], r["maturity_tier"])].append(r)

    # Load DB-backed scorecard overrides once (loader takes ~ms)
    overrides = load_db_overrides(conn)

    # Step 2-5: score each bucket
    counts = {"scored": 0, "partial_cluster_all": 0, "partial_meta": 0, "buckets": 0}
    for bkey, bucket_rows in buckets.items():
        cluster_id, tier = bkey.split("|")
        sc = get_scorecard_from(overrides, cluster_id, tier)
        # Tiered fallback: (cluster, tier) → (cluster, all-tiers) → (meta_cluster, tier)
        if len(bucket_rows) >= MIN_PEERS:
            peer_rows = bucket_rows
            partial_status = None
        elif len(cluster_all_tiers[cluster_id]) >= MIN_PEERS:
            peer_rows = cluster_all_tiers[cluster_id]
            partial_status = "partial-cluster-mixed-tiers"
            counts["partial_cluster_all"] += len(bucket_rows)
        else:
            meta_id = bucket_rows[0]["meta_cluster_id"]
            peer_rows = meta_buckets[_bucket_key(meta_id, tier)]
            partial_status = "partial-meta-cluster"
            counts["partial_meta"] += len(bucket_rows)

        _score_bucket(conn, snapshot_date, cluster_id, tier, sc, bucket_rows, peer_rows, partial_status)
        counts["scored"] += len(bucket_rows)
        counts["buckets"] += 1

    return counts


def _score_bucket(
    conn: psycopg.Connection,
    snapshot_date: date,
    cluster_id: str,
    tier: str,
    sc: Scorecard,
    target_rows: list[dict],   # the stocks we score
    peer_rows: list[dict],      # the peer set used for percentile (= target_rows usually)
) -> None:
    raise NotImplementedError  # placeholder so test-import doesn't blow up


def _score_bucket(  # noqa: F811 — single real definition
    conn: psycopg.Connection,
    snapshot_date: date,
    cluster_id: str,
    tier: str,
    sc: Scorecard,
    target_rows: list[dict],
    peer_rows: list[dict],
    partial_status: Optional[str],
) -> None:
    # All formulas needed (before splicing loss-maker fallback)
    all_formulas = set(sc.quality) | set(sc.valuation) | set(sc.momentum)
    # Also compute fallbacks so we can splice them
    all_formulas |= {fname for fname, _ in sc.loss_maker_val_fallback}

    # Materialize peer values per formula
    peer_metrics_list: list[dict] = [r["cluster_metrics"] or {} for r in peer_rows]
    target_metrics_list: list[dict] = [r["cluster_metrics"] or {} for r in target_rows]

    # Build a percentile map: formula -> {symbol: pct}
    formula_pcts: dict[str, dict[str, Optional[int]]] = {}
    for fname in all_formulas:
        fn = FORMULAS.get(fname)
        if fn is None:
            continue
        higher = bool(getattr(fn, "higher_is_better", True))
        peer_vals = [m.get(fname) for m in peer_metrics_list]
        peer_pcts = _percentile_rank(peer_vals, higher_is_better=higher)
        # Map peer percentiles by symbol (for target lookup)
        peer_lookup = {peer_rows[i]["symbol"]: peer_pcts[i] for i in range(len(peer_rows))}
        # Targets that aren't in peer set need their value inserted; for now, when bucket==peer,
        # target_rows is a subset of peer_rows so this is just a lookup.
        formula_pcts[fname] = peer_lookup

    # Pre-compute splicing for valuation per target stock
    val_weights_per_target = _splice_loss_maker_fallback(
        sc.valuation, sc.loss_maker_val_fallback, target_metrics_list
    )

    # For composite re-percentile, collect all targets' composite raw scores first
    composite_raw: list[Optional[float]] = []
    persisted_rows: list[dict[str, Any]] = []

    for idx, r in enumerate(target_rows):
        symbol = r["symbol"]

        def _gather(weights: dict[str, float]) -> dict[str, Optional[int]]:
            return {k: formula_pcts.get(k, {}).get(symbol) for k in weights}

        q_pcts = _gather(sc.quality)
        v_pcts = _gather(val_weights_per_target[idx])
        m_pcts = _gather(sc.momentum)

        q_score = _weighted_pillar_score(q_pcts, sc.quality)
        v_score = _weighted_pillar_score(v_pcts, val_weights_per_target[idx])
        m_score = _weighted_pillar_score(m_pcts, sc.momentum)

        # Composite: weighted by pillar weights, renormalize across non-null pillars
        pillar_weights = {"q": sc.pillar_weights["q"], "v": sc.pillar_weights["v"], "m": sc.pillar_weights["m"]}
        pillar_scores = {"q": q_score, "v": v_score, "m": m_score}
        valid_w = {k: w for k, w in pillar_weights.items() if pillar_scores.get(k) is not None}
        if valid_w:
            tot = sum(valid_w.values())
            comp = sum(pillar_scores[k] * (w / tot) for k, w in valid_w.items())
        else:
            comp = None

        composite_raw.append(comp)
        persisted_rows.append({
            "symbol": symbol,
            "cluster_id": cluster_id,
            "tier": tier,
            "q": int(round(q_score)) if q_score is not None else None,
            "v": int(round(v_score)) if v_score is not None else None,
            "m": int(round(m_score)) if m_score is not None else None,
            "q_components": q_pcts,
            "v_components": v_pcts,
            "m_components": m_pcts,
            "composite_raw": comp,
        })

    # Re-percentile composite within target bucket
    composite_pcts = _percentile_rank(composite_raw, higher_is_better=True)

    # Persist
    with conn.cursor() as cur:
        for i, p in enumerate(persisted_rows):
            cur.execute("""
                INSERT INTO app.scores
                  (symbol, snapshot_date, cluster_id, maturity_tier,
                   quality_pct, valuation_pct, momentum_pct, composite_pct,
                   quality_components, valuation_components, momentum_components, score_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s)
                ON CONFLICT (symbol, snapshot_date) DO UPDATE SET
                  cluster_id = EXCLUDED.cluster_id,
                  maturity_tier = EXCLUDED.maturity_tier,
                  quality_pct = EXCLUDED.quality_pct,
                  valuation_pct = EXCLUDED.valuation_pct,
                  momentum_pct = EXCLUDED.momentum_pct,
                  composite_pct = EXCLUDED.composite_pct,
                  quality_components = EXCLUDED.quality_components,
                  valuation_components = EXCLUDED.valuation_components,
                  momentum_components = EXCLUDED.momentum_components,
                  score_status = EXCLUDED.score_status
            """, (
                p["symbol"], snapshot_date, p["cluster_id"], p["tier"],
                p["q"], p["v"], p["m"], composite_pcts[i],
                psycopg.types.json.Json({k: v for k, v in p["q_components"].items()}),
                psycopg.types.json.Json({k: v for k, v in p["v_components"].items()}),
                psycopg.types.json.Json({k: v for k, v in p["m_components"].items()}),
                partial_status or "full",
            ))
