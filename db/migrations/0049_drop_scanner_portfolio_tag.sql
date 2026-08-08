-- 0049 — drop app.user_scanner_portfolio (the short-lived manual "P" tag).
--
-- 0048 added a manual, Favourites-style portfolio tag: a per-user set the user
-- built by clicking a "P" toggle on the Scanner's Graph tab. That direction was
-- reversed before it saw real use — the "P" marker now auto-derives from the
-- user's REAL holdings (app.portfolio_holding), so the marker lights on its own
-- and the count comes straight from the portfolio with nothing to click.
--
-- The manual store (table + /api/scanner-portfolio + portfolioTag.ts) is gone;
-- this drops the now-orphaned table. It never carried real data, so there is
-- nothing to preserve.

DROP TABLE IF EXISTS app.user_scanner_portfolio;
