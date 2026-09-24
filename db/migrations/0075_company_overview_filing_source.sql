-- 0075 — allow app.company_overview.source = 'filing', and record which filing.
--
-- WHY
--
-- Every overview row today is built from Screener's Key Points page. Screener
-- is a secondary source and it goes stale silently: measured on 2026-09-24,
-- 14 stored rows quote a fiscal year at or before FY24, four of them FY22-FY23,
-- and BHARATFORG — a NIFTY 500 constituent — renders a revenue split labelled
-- "(85% in FY24)" on the live site.
--
-- For all 14 the PRIMARY source was already sitting in app.announcement: a
-- BSE-hosted annual report PDF, filed between 2026-06-30 and 2026-09-08, with a
-- working pdf_url and no authentication. BHARATFORG's, filed 2026-07-17, states
-- the FY26 split (Commercial Vehicles 51%, Passenger Vehicles 30%, Industrial
-- 19%) and names segments the stored row does not have at all.
--
-- So the filing is both FRESHER and RICHER than the thing we scrape, and it is
-- free of Screener's 80-per-day key-insights quota. This migration is what lets
-- a row say so.
--
-- WHY A NEW source VALUE RATHER THAN REUSING 'screener_keypoints'
--
-- The two are not interchangeable and the difference must survive into the
-- table, because it decides what a reader may conclude from a row:
--
--   screener_keypoints — a human-edited wiki summarising the company. May lag
--                        the filings by years. No dated anchor.
--   filing             — the company's own Reg. 34(1) annual report as filed to
--                        BSE, with a publication date and a document URL.
--
-- Collapsing them would make it impossible to ask "which rows are primary?" —
-- and that question is the whole point of the change.
--
-- WHAT KEEPS IT CURRENT (CLAUDE.md section 5)
--
-- source_filing_id points at the app.announcement row the text came from, and
-- source_filing_date carries that filing's publication date. Together they make
-- the refresh condition a QUERY rather than a habit: a stored row is superseded
-- the moment a newer annual report exists for the same symbol.
--
--     SELECT o.symbol, o.source_filing_date, max(a.published_at)
--       FROM app.company_overview o
--       JOIN app.announcement a ON a.symbol = o.symbol
--      WHERE o.source = 'filing'
--        AND (a.title ILIKE '%annual report%' OR a.headline ILIKE '%annual report%')
--      GROUP BY o.symbol, o.source_filing_date
--     HAVING max(a.published_at) > o.source_filing_date;
--
-- Without those two columns this is a seed-once table with no way to know it
-- has gone stale except the FY string inside the prose — which is precisely the
-- weak signal that let BHARATFORG sit at FY24 unnoticed.
--
-- The FK is ON DELETE SET NULL, not CASCADE: if the announcement row is ever
-- re-keyed or pruned, the overview text is still valid and still worth showing.
-- Losing the provenance pointer must not delete the content.

ALTER TABLE app.company_overview
  DROP CONSTRAINT IF EXISTS company_overview_source_known;

ALTER TABLE app.company_overview
  ADD CONSTRAINT company_overview_source_known
  CHECK (source = ANY (ARRAY['screener_keypoints'::text, 'yfinance'::text, 'filing'::text]));

ALTER TABLE app.company_overview
  ADD COLUMN IF NOT EXISTS source_filing_id   text,
  ADD COLUMN IF NOT EXISTS source_filing_date timestamptz;

ALTER TABLE app.company_overview
  DROP CONSTRAINT IF EXISTS company_overview_source_filing_fkey;

ALTER TABLE app.company_overview
  ADD CONSTRAINT company_overview_source_filing_fkey
  FOREIGN KEY (source_filing_id) REFERENCES app.announcement(id) ON DELETE SET NULL;

-- A filing-sourced row without a filing pointer is unprovable, and an
-- unprovable row is the thing this migration exists to prevent. Enforce it
-- rather than trust the writer: the writer is a script that will be edited.
ALTER TABLE app.company_overview
  DROP CONSTRAINT IF EXISTS company_overview_filing_has_provenance;

ALTER TABLE app.company_overview
  ADD CONSTRAINT company_overview_filing_has_provenance
  CHECK (source <> 'filing' OR (source_filing_id IS NOT NULL AND source_filing_date IS NOT NULL));

CREATE INDEX IF NOT EXISTS company_overview_filing_date_idx
  ON app.company_overview (source_filing_date DESC)
  WHERE source = 'filing';
