-- app.ipo — snapshot of Upstox's IPO calendar.
--
-- WHY A TABLE AND NOT A LIVE CALL AT REQUEST TIME
--
-- GET /v2/ipos needs a USER OAuth bearer token, and an Upstox access token
-- dies every day at 22:00 UTC (03:30 IST) with no refresh-token flow — the
-- only way to get a new one is a human visiting /admin/upstox and completing
-- the login. Measured 2026-10-02: the stored token had been expired for nine
-- days and nothing reported it, which is also why app.stock_intraday had no
-- ticks since 2026-09-23.
--
-- So a page that calls Upstox per request renders EMPTY every morning after
-- 03:30 IST until someone logs in. Snapshotting instead means the page
-- degrades to "this is the calendar as of <date>", which is a true statement
-- about stale data rather than a false statement about there being no IPOs.
-- `fetched_at` is on every row for exactly that reason and the UI must render
-- it — a stale snapshot with no visible date is CLAUDE.md §5's "seeded once,
-- nothing maintains it" wearing a fresh coat of paint.
--
-- WHY `id` IS THE UPSTOX SLUG AND NOT THE SYMBOL
--
-- Measured on the 2026-10-02 payload: of 20 upcoming regular IPOs, the ones
-- that have not filed a final RHP carry symbol = NULL, isin = NULL,
-- issue_size = NULL and both price-band fields NULL (Parle Products, for
-- instance). Keying on symbol would drop them, and "the IPO you have not
-- heard the price of yet" is the row a tracker exists to show. The slug
-- ("parle-products-limited-ipo") is present on every row and is what
-- /v2/ipos/{id} takes, so it is the natural key.
--
-- WHY STATUS IS NOT A FOREIGN KEY TO ANYTHING
--
-- An IPO walks upcoming → open → closed → listed, and Upstox moves it by
-- re-serving the same slug under a different `status`. The upsert therefore
-- overwrites status in place; there is no history table, because the timeline
-- columns already carry the dates that history would be reconstructed from.

CREATE TABLE IF NOT EXISTS app.ipo (
  id                  text PRIMARY KEY,          -- Upstox slug, e.g. "parle-products-limited-ipo"
  symbol              text,                      -- NULL until the RHP is filed
  name                text NOT NULL,
  status              text NOT NULL,             -- upcoming | open | closed | listed
  isin                text,
  issue_type          text NOT NULL,             -- regular | sme
  issue_size_cr       numeric,                   -- Upstox's `issue_size`, in ₹ crore
  industry            text,
  min_price           numeric,
  max_price           numeric,
  cut_off_price       numeric,
  face_value          numeric,
  lot_size            integer,
  min_quantity        integer,
  bidding_start       date,
  bidding_end         date,
  allotment_date      date,
  refund_date         date,
  listing_date        date,
  mandate_end         date,
  listing_price       numeric,                   -- populated only after listing
  listing_exchange    text,                      -- "BSE,NSE"
  total_subscription  numeric,                   -- times subscribed; live while open
  rhp_url             text,
  drhp_url            text,
  registrar           text,
  investor_categories text[],                    -- IND / EMP / HNI / QIB …
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ipo_status_known CHECK (status IN ('upcoming','open','closed','listed')),
  CONSTRAINT ipo_issue_type_known CHECK (issue_type IN ('regular','sme')),
  -- A band with the floor above the ceiling is a parse error, not an IPO.
  CONSTRAINT ipo_band_ordered CHECK (
    min_price IS NULL OR max_price IS NULL OR min_price <= max_price
  )
);

-- The tracker's default view is "what is open or coming", ordered by date.
CREATE INDEX IF NOT EXISTS ipo_status_bidding_idx
  ON app.ipo (status, bidding_start DESC NULLS LAST);

-- "What listed recently, and how did the band compare" — the retrospective cut.
CREATE INDEX IF NOT EXISTS ipo_listing_date_idx
  ON app.ipo (listing_date DESC NULLS LAST);
