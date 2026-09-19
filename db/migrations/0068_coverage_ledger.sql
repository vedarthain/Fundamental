-- 0068_coverage_ledger.sql
--
-- One row per active symbol per weekly snapshot, recording where that symbol
-- ENDED UP in the pipeline. Not a metrics table — an accounting table.
--
-- WHY THIS EXISTS
--
-- Every coverage check we had before this measured the survivors. The canonical
-- example, from dq.py:
--
--     FROM app.screener_meta sm JOIN app.universe u USING (symbol)
--
-- an INNER JOIN onto the very table whose absence is the bug. 472 symbols that
-- had never been scraped had no screener_meta row, so they were filtered out
-- before the percentage was computed. The check reported 99.8% coverage every
-- week while true coverage was 81.8%. A completeness check cannot fail if the
-- rows it is looking for are excluded by its own FROM clause.
--
-- The second failure mode was hardcoded expectations. check-freshness.py asserted
-- `scored >= 2000` with a docstring reading "full universe ~2,150". That was true
-- the day it was written. sync-universe-monthly then grew the universe to 2,622
-- and the floor never moved, so 2,122 scored rows cleared it every single run.
-- A constant that describes the past goes blind as the system grows, and it goes
-- blind silently — a stale threshold does not error, it just keeps saying green.
--
-- THE FIX IS A PARTITION, NOT A THRESHOLD
--
-- Every active symbol lands in exactly one status. The buckets are exhaustive
-- and mutually exclusive, so the only invariant worth asserting is:
--
--     count(ledger at snapshot) == count(app.universe WHERE is_active)
--     count(ledger WHERE status = 'unclassified') == 0
--
-- There is no number to tune and nothing to re-audit when the universe grows.
-- A symbol cannot silently vanish, because there is no "other" — anything the
-- classifier does not recognise lands in 'unclassified', which is asserted to
-- be zero. The 472 would have surfaced as 'never_attempted' in week one.
--
-- Alerting is then on MOVEMENT between snapshots, not on level. "never_attempted
-- went 0 -> 472" needs no ceiling, so there is no ceiling to get wrong. Contrast
-- the old screener_export_stale_financials assertion, which was given a ceiling
-- of 40 against a baseline of 25: it converted an alert into a thermostat and a
-- permanent 25-stock hole became, by construction, normal.
--
-- RETENTION
--
-- One row per symbol per week is ~2,600 rows/week, ~135k rows/year. Trivial, and
-- the history is the point: it is what makes the week-over-week delta possible,
-- and it answers "when did this symbol stop being scored" without guesswork.

CREATE TABLE IF NOT EXISTS app.coverage_ledger (
    snapshot_date  date        NOT NULL,
    symbol         text        NOT NULL,

    -- The bucket. Deliberately a text column with a CHECK rather than an enum:
    -- adding a status should be a one-line migration, but an UNKNOWN status must
    -- fail loudly at write time rather than being accepted and quietly ignored
    -- by every downstream GROUP BY.
    status         text        NOT NULL,

    -- Human-readable "why", carried so the weekly report can name the reason
    -- without re-deriving it (e.g. "newest period_end 2024-03-31, 29 months
    -- stale"). Nullable: 'scored' needs no explanation.
    detail         text,

    recorded_at    timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (snapshot_date, symbol),

    CONSTRAINT coverage_ledger_status_known CHECK (status IN (
        -- Terminal success: a row exists in app.scores for this snapshot.
        'scored',
        -- Deliberately withheld. The pipeline saw these and chose not to score
        -- them; the site renders "scores withheld". Correct behaviour, but the
        -- cohort size must stay visible or it becomes an unexplained gap.
        'gated_stale_financials',
        'gated_insufficient_history',
        -- Scrape was attempted and is failing. screener_meta row exists with a
        -- non-ok status (auth_failed / http_error / parse_error / not_found).
        'fetch_failing',
        -- Scrape has NEVER been attempted: no screener_meta row at all. This is
        -- the bucket that was structurally invisible to every previous check.
        'never_attempted',
        -- Scraped fine, but did not reach the metrics step for this snapshot —
        -- e.g. no cluster assignment, so the peer-relative scores are undefined.
        'no_metrics',
        -- The residual. Asserted to be zero. If this is ever non-empty the
        -- classifier has drifted from the pipeline and needs a new bucket.
        'unclassified'
    ))
);

-- The weekly report groups by (snapshot_date, status); the delta joins two
-- adjacent snapshots. Both are served by this one index.
CREATE INDEX IF NOT EXISTS coverage_ledger_snapshot_status_idx
    ON app.coverage_ledger (snapshot_date, status);

-- "When did SYMBOL stop being scored" — a per-symbol history scan.
CREATE INDEX IF NOT EXISTS coverage_ledger_symbol_idx
    ON app.coverage_ledger (symbol, snapshot_date DESC);
