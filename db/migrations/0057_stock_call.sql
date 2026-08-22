-- 0057 — per-user Buy/Sell "calls". A lightweight conviction log: the user tags
-- a symbol Buy or Sell, and we snapshot the price + date at that moment so the
-- call can be scored later on raw price move. This is NOT a real trade (no
-- quantity, no cost basis — that's app.portfolio_transaction) and NOT the
-- watchlist (app.user_watchlist). It's a dated directional call, tracked over
-- months, so it gets its own table.
--
-- One call per (user, symbol): re-tagging (Buy→Sell or vice-versa) is a NEW
-- call — it overwrites side + re-anchors date/price via the UNIQUE upsert.
-- ON DELETE CASCADE drops a user's calls when their account is removed.

CREATE TABLE IF NOT EXISTS app.stock_call (
    id           BIGSERIAL   PRIMARY KEY,
    user_id      BIGINT      NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    symbol       TEXT        NOT NULL,
    side         CHAR(1)     NOT NULL CHECK (side IN ('B', 'S')),
    -- The moment the call was made: date + the price we anchored the % move to.
    anchor_date  DATE        NOT NULL,
    anchor_price NUMERIC(18, 4) NOT NULL CHECK (anchor_price > 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, symbol)
);

-- Dominant read is "all of this user's calls". The UNIQUE(user_id, symbol)
-- index already covers user-scoped scans, so no extra index is needed.

COMMENT ON TABLE app.stock_call IS
'Per-user dated Buy/Sell calls. One row per (user, symbol); re-tagging overwrites
side and re-anchors date/price. Raw % move is computed against anchor_price.';

-- Permissions for the app role.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.stock_call TO fundamental_app;
        GRANT USAGE, SELECT ON SEQUENCE app.stock_call_id_seq TO fundamental_app;
    END IF;
END $$;
