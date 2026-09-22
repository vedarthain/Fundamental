-- app.universe.business_summary_source — which well a description came out of.
--
-- WHY THIS EXISTS
--
-- business_summary has had exactly one source since it was created: yfinance's
-- longBusinessSummary, which is the company's own filed self-description. It
-- covers 2,142 of 2,593 active symbols and runs 500–2,000 characters. The
-- remaining 451 symbols are blank and, because nothing ever re-ran the fetch,
-- were going to stay blank.
--
-- Screener.in has a description for all of them — tested live on 12 of the 451
-- blanks, 12 hits. But it is a DIFFERENT KIND OF TEXT, and storing it in the
-- same column without a label would be a quiet lie:
--
--     CENTUM  yfinance  1,953 chars  the company's filed description
--     ABAN    screener     87 chars  "Incorporated in 1986, Aban Offshore is
--                                     in the business of offshore drilling
--                                     services"
--
-- One is a disclosure. The other is an editor's one-liner. Both are true;
-- they are not interchangeable, and the difference is invisible once the text
-- is in a text column.
--
-- WHAT BREAKS WITHOUT THE LABEL
--
-- web/src/lib/businessSummary.ts mines this prose for segment chips, markets,
-- former names and HQ. Every one of those extractors needs several sentences.
-- Run it over an 87-character blurb and it yields a tagline and empty arrays —
-- so the watchlist panel would render a company card that looks like we found
-- nothing to say about the business, when in fact we never had the kind of
-- text those extractors read. The parser has to be able to ASK which source it
-- is holding, and a length heuristic is a guess where a fact is available.
--
-- It also keeps the two refresh cadences honest. A filed description changes
-- when the company rewrites its filing; a Screener blurb changes when an
-- editor edits it. Mixing them under one fetched_at would make both timestamps
-- mean nothing in particular.
--
-- BLAST RADIUS
--
-- Nil on the read side, checked not assumed. Consumers of business_summary:
--   web/src/lib/businessSummary.ts          — takes the text as an argument
--   web/src/components/BusinessVisual.tsx   — names its columns
--   web/src/app/watchlist/WatchlistClient.tsx — names its columns
--   web/src/app/api/stock/profile/route.ts  — names its columns
-- No SELECT * among them. A new nullable column is invisible to all four.
--
-- BACKFILL
--
-- One statement, below, and it is safe precisely because the column is new:
-- every row that currently HAS a summary got it from the 2026-05-04 yfinance
-- run and from nothing else, so stamping those 'yfinance' is a statement of
-- fact rather than an assumption. Rows with no summary stay NULL. After this,
-- NULL means "no summary at all", never "summary of unknown origin" — the
-- fetcher writes the source in the same UPDATE as the text.

SET search_path = app, public;

ALTER TABLE app.universe
    ADD COLUMN IF NOT EXISTS business_summary_source text;

COMMENT ON COLUMN app.universe.business_summary_source IS
'Where business_summary came from: ''yfinance'' = longBusinessSummary, the
company''s own filed self-description, typically 500-2000 chars and rich enough
for lib/businessSummary.ts to parse. ''screener'' = Screener.in company-profile
blurb, typically under 350 chars, a single editorial sentence — a fallback used
only where yfinance returned nothing. NULL means business_summary IS NULL.';

-- Every existing summary predates the fallback, so this is the one moment the
-- backfill can be stated as fact. Guarded by IS NULL so a re-run cannot
-- relabel a row the fetcher has since written.
UPDATE app.universe
   SET business_summary_source = 'yfinance'
 WHERE business_summary IS NOT NULL
   AND business_summary_source IS NULL;

ALTER TABLE app.universe
    DROP CONSTRAINT IF EXISTS universe_business_summary_source_chk;
ALTER TABLE app.universe
    ADD CONSTRAINT universe_business_summary_source_chk
    CHECK (business_summary_source IS NULL
           OR business_summary_source IN ('yfinance', 'screener'));

-- No index. Nothing filters on this column; it is read alongside the row it
-- labels. An index here would be decoration.

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.universe TO fundamental_app;
    END IF;
END $$;
