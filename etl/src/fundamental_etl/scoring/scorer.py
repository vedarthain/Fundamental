"""Percentile + composite score computation.

For each (cluster_id, maturity_tier) bucket on a snapshot_date:
  1. Pull every stock's metrics from app.metrics_snapshot
  2. For each formula in the cluster's tier-variant scorecard, compute percentile rank
     against the appropriate pool (see "Two-pool strategy" below)
  3. Loss-maker handling: if pe_ttm is null, splice in fallback formulas at pe_ttm's weight
  4. Weighted blend per pillar → quality_pct, valuation_pct, momentum_pct
     - Quality + Valuation pillars are shrunk toward 50 for thin peer pools (see SHRINK_N)
  5. composite = pillar-weighted blend → re-percentile within target bucket → composite_pct
     - composite_pct is also shrunk toward 50 when the target bucket is thin
  6. Persist sub-percentiles for explainability

Two-pool strategy
-----------------
- Quality and Valuation are peer-relative concepts. A P/E of 25 means different things
  in pharma vs cement; ROE of 18% lands differently in banks vs FMCG. These pillars
  use the peer bucket (cluster, tier) with fallback to mixed-tiers when thin.
- Momentum is absolute. A 25% trailing return is 25% regardless of who the peers are.
  Percentiling momentum within a 4-stock cluster amplifies noise: a single 5% rally
  flips ranks and shifts the momentum pillar by ~33pts. So momentum formulas are
  percentiled against the **entire scored universe**, not the peer bucket.

Shrinkage
---------
For Q/V pillar scores and for the composite re-percentile, we shrink toward 50
when the relevant peer count is below SHRINK_N. This preserves rank ordering but
compresses the magnitude so a 4-stock cluster doesn't claim "100 vs 0" precision.
At n >= SHRINK_N the shrinkage factor is 1.0 (no effect).

Fallback for thin (cluster, tier) buckets (<MIN_PEERS): percentile against
(cluster, all-tiers); flag score_status='partial-cluster-mixed-tiers'. The
historical 'partial-meta-cluster' fallback was removed — comparing a stock to
incomparable businesses in the same sector produced false-precision scores worse
than the alternative of "ranked against 4 actual peers, badge as thin bucket".
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Optional

import psycopg

from .formulas import REGISTRY as FORMULAS
from .scorecards import Scorecard, get_scorecard, get_scorecard_from, load_db_overrides

MIN_PEERS = 10
# Below this peer count, Q/V pillar scores and composite_pct are shrunk toward
# 50 — the closer n is to 1, the more aggressive the pull. At n >= SHRINK_N the
# shrinkage factor is 1.0 (no effect).
SHRINK_N = 10


def _shrink_toward_50(pct: Optional[int], n: int) -> Optional[int]:
    """Damp a percentile toward 50 when the peer pool is small.

    Shrinkage factor: λ = max(0, min(1, (n - 1) / (SHRINK_N - 1))).
    - n >= SHRINK_N → λ = 1 → no change.
    - n = SHRINK_N // 2 → λ ≈ 0.5 → magnitudes halved.
    - n <= 1 → λ = 0 → all scores collapse to 50 (no peer information).

    Rank ordering is preserved (linear in pct). What changes is magnitude:
    a 4-stock cluster outputs roughly [33, 44, 56, 67] instead of [0, 33, 67, 100].
    """
    if pct is None:
        return None
    if n >= SHRINK_N:
        return pct
    if n <= 1:
        return 50
    lam = (n - 1) / (SHRINK_N - 1)
    return int(round(50 + (pct - 50) * lam))


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
              AND m.score_status NOT IN ('insufficient_data', 'stale_data')
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

    # Build the universe-wide momentum percentile pool. Momentum formulas are
    # the same set across (nearly) every scorecard (UNIVERSAL_MOMENTUM), but
    # we collect from each scorecard to be safe in case a cluster overrides.
    momentum_formulas: set[str] = set()
    for r in rows:
        sc = get_scorecard_from(overrides, r["cluster_id"], r["maturity_tier"])
        momentum_formulas.update(sc.momentum.keys())

    universe_metrics = [(r["symbol"], r["cluster_metrics"] or {}) for r in rows]
    universe_momentum_pcts: dict[str, dict[str, Optional[int]]] = {}
    for fname in momentum_formulas:
        fn = FORMULAS.get(fname)
        if fn is None:
            continue
        higher = bool(getattr(fn, "higher_is_better", True))
        vals = [m.get(fname) for _, m in universe_metrics]
        pcts = _percentile_rank(vals, higher_is_better=higher)
        universe_momentum_pcts[fname] = {
            universe_metrics[i][0]: pcts[i] for i in range(len(universe_metrics))
        }

    # Step 2-5: score each bucket. Fallback chain is now only (cluster, tier) →
    # (cluster, all-tiers). Meta-cluster fallback was removed — comparing a
    # stock to incomparable businesses in the same sector produced false-
    # precision scores. Thin buckets now rank within their actual peer set and
    # carry the "partial-cluster-mixed-tiers" status (badged in the UI).
    counts = {"scored": 0, "partial_cluster_all": 0, "partial_meta": 0, "buckets": 0}
    for bkey, bucket_rows in buckets.items():
        cluster_id, tier = bkey.split("|")
        sc = get_scorecard_from(overrides, cluster_id, tier)
        if len(bucket_rows) >= MIN_PEERS:
            peer_rows = bucket_rows
            partial_status = None
        else:
            peer_rows = cluster_all_tiers[cluster_id]
            partial_status = "partial-cluster-mixed-tiers"
            counts["partial_cluster_all"] += len(bucket_rows)

        _score_bucket(
            conn, snapshot_date, cluster_id, tier, sc,
            bucket_rows, peer_rows, partial_status, universe_momentum_pcts,
        )
        counts["scored"] += len(bucket_rows)
        counts["buckets"] += 1

    # Authoritative cleanup: app.scores for a snapshot must contain EXACTLY the
    # symbols eligible for scoring this run. The insert above only upserts the
    # eligible set — it never removes a symbol that was scored in a PRIOR run but
    # is now excluded (e.g. newly gated to stale_data/insufficient_data). Without
    # this delete, such a symbol keeps its old composite row in the current
    # snapshot and the web layer shows a stale, withheld-worthy score. `rows` is
    # the eligible set (the SELECT already filters out excluded statuses), so we
    # drop any scores row for this snapshot whose symbol isn't in it.
    eligible = [r["symbol"] for r in rows]
    # Guard: never run the delete with an empty eligible set — that would wipe
    # the entire snapshot's scores. An empty `rows` means the metrics step
    # produced nothing (upstream failure), in which case we leave existing
    # scores untouched rather than nuke them.
    if eligible:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM app.scores WHERE snapshot_date = %s AND NOT (symbol = ANY(%s))",
                (snapshot_date, eligible),
            )
            counts["removed_ineligible"] = cur.rowcount
    else:
        counts["removed_ineligible"] = 0

    return counts


def _score_bucket(
    conn: psycopg.Connection,
    snapshot_date: date,
    cluster_id: str,
    tier: str,
    sc: Scorecard,
    target_rows: list[dict],
    peer_rows: list[dict],
    partial_status: Optional[str],
    universe_momentum_pcts: dict[str, dict[str, Optional[int]]],
) -> None:
    # Quality + valuation formulas are percentiled within the peer bucket
    # (cluster, tier) with fallback to mixed-tier cluster. Momentum formulas
    # come from the pre-computed universe-wide pool. Loss-maker fallback only
    # ever applies to valuation, so include those names too.
    qv_formulas = set(sc.quality) | set(sc.valuation)
    qv_formulas |= {fname for fname, _ in sc.loss_maker_val_fallback}
    momentum_set = set(sc.momentum)

    # Materialize peer values for the Q+V percentile pool
    peer_metrics_list: list[dict] = [r["cluster_metrics"] or {} for r in peer_rows]
    target_metrics_list: list[dict] = [r["cluster_metrics"] or {} for r in target_rows]

    # Build per-formula percentile map.
    # - Q/V: rank within peer_rows (cluster pool)
    # - M: look up from universe_momentum_pcts (universe pool)
    formula_pcts: dict[str, dict[str, Optional[int]]] = {}
    for fname in qv_formulas:
        fn = FORMULAS.get(fname)
        if fn is None:
            continue
        higher = bool(getattr(fn, "higher_is_better", True))
        peer_vals = [m.get(fname) for m in peer_metrics_list]
        peer_pcts = _percentile_rank(peer_vals, higher_is_better=higher)
        formula_pcts[fname] = {
            peer_rows[i]["symbol"]: peer_pcts[i] for i in range(len(peer_rows))
        }
    for fname in momentum_set:
        formula_pcts[fname] = universe_momentum_pcts.get(fname, {})

    # Pre-compute splicing for valuation per target stock
    val_weights_per_target = _splice_loss_maker_fallback(
        sc.valuation, sc.loss_maker_val_fallback, target_metrics_list
    )

    # For composite re-percentile, collect all targets' composite raw scores first
    composite_raw: list[Optional[float]] = []
    persisted_rows: list[dict[str, Any]] = []

    # Shrinkage applies to Q + V because they rely on the peer pool.
    # Momentum is exempt (its pool is the whole universe; shrinkage isn't needed).
    qv_pool_n = len(peer_rows)
    target_n = len(target_rows)  # for composite_pct shrinkage (re-percentile pool)

    for idx, r in enumerate(target_rows):
        symbol = r["symbol"]

        def _gather(weights: dict[str, float]) -> dict[str, Optional[int]]:
            return {k: formula_pcts.get(k, {}).get(symbol) for k in weights}

        q_pcts = _gather(sc.quality)
        v_pcts = _gather(val_weights_per_target[idx])
        m_pcts = _gather(sc.momentum)

        q_score_raw = _weighted_pillar_score(q_pcts, sc.quality)
        v_score_raw = _weighted_pillar_score(v_pcts, val_weights_per_target[idx])
        m_score = _weighted_pillar_score(m_pcts, sc.momentum)

        # Apply thin-bucket shrinkage to Q and V (M comes from universe pool).
        # _shrink_toward_50 accepts None and ints; pillar scores are floats here
        # but the shrinkage math is identical, so round → shrink → store int.
        q_score = (
            _shrink_toward_50(int(round(q_score_raw)), qv_pool_n)
            if q_score_raw is not None else None
        )
        v_score = (
            _shrink_toward_50(int(round(v_score_raw)), qv_pool_n)
            if v_score_raw is not None else None
        )

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
            "q": q_score,
            "v": v_score,
            "m": int(round(m_score)) if m_score is not None else None,
            "q_components": q_pcts,
            "v_components": v_pcts,
            "m_components": m_pcts,
            "composite_raw": comp,
        })

    # Re-percentile composite within target bucket, then shrink if the bucket
    # is thin. Without shrinkage, a 4-stock bucket would publish (0, 33, 67, 100)
    # — falsely precise. After shrinkage, roughly (33, 44, 56, 67).
    composite_pcts_raw = _percentile_rank(composite_raw, higher_is_better=True)
    composite_pcts = [_shrink_toward_50(p, target_n) for p in composite_pcts_raw]

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
