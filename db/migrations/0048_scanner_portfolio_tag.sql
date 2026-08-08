-- 0048 — per-user Scanner "Portfolio" tags (the P marker on the Graph tab).
--
-- A sibling to app.user_scanner_favourite (0047): a lightweight, one-tap
-- marker the user applies while browsing charts on the Scanner's Graph tab.
--
-- IMPORTANT — this is NOT the real portfolio. Actual holdings (quantity, cost
-- basis, P&L) live in app.portfolio_holding and are managed on the Portfolio
-- tab. This table is a pure membership set — a scanner-view tag ("P") used to
-- filter/mark charts, exactly parallel to Favourites. Keeping the two apart
-- means a phantom zero-quantity holding never leaks into the Portfolio page's
-- P&L just because a user tagged a chart to look at later.
--
-- Membership-only, mirrors user_scanner_favourite exactly. Signed-out visitors
-- use localStorage; on first sign-in the client merges local tags in (once),
-- then clears the local key.

CREATE TABLE IF NOT EXISTS app.user_scanner_portfolio (
    user_id    bigint       NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    symbol     text         NOT NULL,
    created_at timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, symbol)
);

COMMENT ON TABLE app.user_scanner_portfolio IS
  'Per-user Scanner "P" tags on the Graph tab. A scanner-view marker only — NOT real holdings (those live in app.portfolio_holding). Mirrors user_scanner_favourite.';

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, DELETE ON app.user_scanner_portfolio TO fundamental_app;
    END IF;
END $$;
