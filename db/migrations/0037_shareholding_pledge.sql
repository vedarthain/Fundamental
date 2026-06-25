-- 0037 — add pledge_pct to shareholding_pattern
-- Screener reports "Pledged %" as a row in the shareholding table for companies
-- where promoters have pledged shares as collateral. We surface this as a red-flag
-- governance signal on the stock page.
-- NULL = no pledge data available (either company has no pledges or Screener doesn't
-- report it). 0.0 = explicitly zero pledging confirmed from the scrape.

ALTER TABLE app.shareholding_pattern
  ADD COLUMN IF NOT EXISTS pledge_pct numeric(5,2);

COMMENT ON COLUMN app.shareholding_pattern.pledge_pct IS
  'Promoter-pledged shares as % of total shares; NULL = not reported by Screener';
