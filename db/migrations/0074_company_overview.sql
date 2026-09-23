-- 0074 — app.company_overview: the structured "what this company does" table.
--
-- WHY THIS TABLE EXISTS
--
-- web/src/lib/businessSummary.ts mines yfinance prose with regexes to produce
-- the About panel's chips. Measured on AASTHA, the panel renders:
--
--     "and trades in cotton yarns" | "bales for knitting" | "weaving applications in India"
--
-- which is one sentence comma-split, and "India only — Domestic operations"
-- for a company whose own summary says "The company also exports its products."
-- (The exports regex at businessSummary.ts:246 requires `exports ... TO <region>`
-- and AASTHA's sentence has no destination, so it matches nothing and the card
-- falls through to the domestic branch.) That is not a cosmetic defect: the site
-- states the opposite of its source.
--
-- The fix is not a better regex. Prose that was written for humans does not
-- decompose reliably, and each new pattern bought one company and broke another
-- — three successive extractor rewrites each traded one failure for a new one.
--
-- SO: extract once, store the result, render the stored rows. This table is
-- that store.
--
-- WHAT KEEPS IT CURRENT (CLAUDE.md section 5)
--
-- source_sha256 is the fingerprint of the exact input text the rows were built
-- from. The generator skips any symbol whose fingerprint is unchanged and
-- rebuilds any whose input moved. Without it this is a seed-once table and
-- therefore the next bug in this codebase's oldest failure mode. It is also
-- what makes a staleness check possible at all:
--
--     SELECT count(*) FROM app.company_overview o JOIN app.universe u USING (symbol)
--      WHERE o.source_sha256 <> encode(sha256(<current input>::bytea), 'hex');
--
-- rows is jsonb rather than a row-per-label table because the labels are a
-- fixed, ordered spine owned by the generator prompt, not user data — there is
-- nothing to join, filter or aggregate on, and array order IS the render order.
-- A label CHECK is deliberately NOT added: it would have to be edited in
-- lockstep with the prompt, and a mismatch would fail the write rather than
-- surface the drift. The generator audits label drift instead (measured: 0-1
-- per 100 companies) and unknown labels render fine.
--
-- NOT NULL on model/source/source_sha256 is the point of the table: a row must
-- always be able to answer "where did this come from and can I regenerate it".

CREATE TABLE IF NOT EXISTS app.company_overview (
    symbol         text PRIMARY KEY
                        REFERENCES app.universe(symbol) ON DELETE CASCADE,
    -- [{"label": "Core business", "value": "..."}, ...] — order is render order.
    rows           jsonb       NOT NULL,
    -- Which text the rows were extracted FROM: 'screener_keypoints' | 'yfinance'.
    -- Not "which scraper ran" — which corpus, so a later run can tell whether
    -- switching a company from yfinance to Key Points is an upgrade.
    source         text        NOT NULL,
    model          text        NOT NULL,
    source_sha256  text        NOT NULL,
    generated_at   timestamptz NOT NULL DEFAULT now(),
    -- The newest fiscal year named anywhere in `rows`, as a 4-digit FY-end year
    -- (FY24 -> 2024). NULL when the text names no fiscal year at all.
    --
    -- WHY THIS COLUMN EXISTS — it is the only staleness signal that exists.
    --
    -- source_sha256 answers "did the source text change". It cannot answer
    -- "did the source text stop changing while the world moved on", and that
    -- is the failure actually observed: 20MICRONS' Key Points page says
    -- "Paints 51% in FY24" because a human last edited it in FY24 and walked
    -- away. Its fingerprint is stable forever, so the generator prints
    -- "unchanged — skipped" and counts that as success, indefinitely. That is
    -- a check that cannot fail (CLAUDE.md section 5), and it shipped.
    --
    -- Screener offers nothing better: the wiki fragment at
    -- /wiki/company/{id}/commentary/v2/ contains no <time>, no datetime
    -- attribute and no date string anywhere in its ~8KB (measured on
    -- 20MICRONS). The FY token embedded in the prose is all there is.
    --
    -- The DQ check this enables, and which fails TODAY on 20MICRONS:
    --   SELECT symbol, latest_fy FROM app.company_overview
    --    WHERE latest_fy IS NOT NULL AND latest_fy <= <current FY end> - 2;
    latest_fy      smallint,

    CONSTRAINT company_overview_rows_is_array CHECK (jsonb_typeof(rows) = 'array'),
    -- Guards a parse bug, not user input: 24 (the FY token) must never be
    -- stored where 2024 (the year) belongs.
    CONSTRAINT company_overview_latest_fy_sane
        CHECK (latest_fy IS NULL OR latest_fy BETWEEN 1990 AND 2100),
    -- An empty array is a successful extraction that found nothing, which is a
    -- different state from "never generated" (no row). Both are legal; the
    -- reader must not confuse them, so neither is silently rewritten here.
    CONSTRAINT company_overview_source_known  CHECK (source IN ('screener_keypoints', 'yfinance'))
);

-- Staleness sweeps and "what did we generate today" queries both scan by time.
CREATE INDEX IF NOT EXISTS company_overview_generated_at_idx
    ON app.company_overview (generated_at DESC);
