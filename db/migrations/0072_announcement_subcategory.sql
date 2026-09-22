-- app.announcement.subcategory — the field BSE has been sending us all along
-- and the fetcher was dropping on the floor.
--
-- WHY THIS EXISTS
--
-- BSE's AnnSubCategoryGetData response carries TWO taxonomy fields. We stored
-- the coarse one and discarded the useful one:
--
--     CATEGORYNAME  "Company Update"                      ← stored as .category
--     SUBCATNAME    "Award of Order / Receipt of Order"   ← thrown away
--
-- The consequence is visible in the table's own distribution — 51,236 of
-- 80,338 rows sit in an undifferentiated "Company Update" bucket:
--
--     Company Update          51236
--     Board Meeting            7356
--     AGM/EGM                  6833
--     Insider Trading / SAST   4399
--     Result                   3415
--
-- Everything that distinguishes an order win from a newspaper advert is
-- inside that bucket, unlabelled. Finding order announcements by regexing
-- `title` returns 59 rows across 36 symbols; NSE's equivalent explicit
-- category returns 410 across 154 symbols in a SHORTER window. That gap is
-- not a coverage gap — we already hold the filings. It is a field we asked
-- for, received, and did not write down.
--
-- WHY A COLUMN AND NOT A SECOND FEED
--
-- The alternative on the table was adding an NSE corporate-announcements
-- fetcher purely to get the category label. That would have been a second
-- source, a second anti-bot dance, a second thing to keep current, and a
-- second place for the universe to disagree with itself — to obtain data
-- already arriving daily in a response we parse.
--
-- BLAST RADIUS
--
-- Nil on the read side, checked rather than assumed. Both consumers name
-- their columns explicitly; neither does SELECT *:
--   web/src/app/api/opportunities/route.ts:481
--   web/src/app/stock/[symbol]/page.tsx:540
-- A new nullable column is invisible to both.
--
-- BACKFILL
--
-- None here, deliberately. scripts/fetch-announcements.py re-fetches a
-- rolling 30-day window daily and upserts on NEWSID, so the last 30 days
-- self-populate within one run. Rows older than that keep subcategory NULL
-- for good — which is honest. Anything reading this column must treat NULL
-- as "not known", never as "no subcategory", or it re-creates the exact
-- class of silent wrongness this migration is fixing.

SET search_path = app, public;

ALTER TABLE app.announcement
    ADD COLUMN IF NOT EXISTS subcategory text;

COMMENT ON COLUMN app.announcement.subcategory IS
'BSE SUBCATNAME — the fine-grained filing type (e.g. "Award of Order /
Receipt of Order", "Earnings Call Transcript", "Change in Management") that
CATEGORYNAME collapses into "Company Update". NULL means the row predates
this column, NOT that the filing has no subcategory.';

-- Partial: two thirds of the table will carry a subcategory once the rolling
-- window turns over, and every intended query filters on it being present.
-- Indexing the NULLs would pay for rows no query will ever ask for.
CREATE INDEX IF NOT EXISTS announcement_subcat_dt_idx
    ON app.announcement (subcategory, published_at DESC)
    WHERE subcategory IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.announcement TO fundamental_app;
    END IF;
END $$;
