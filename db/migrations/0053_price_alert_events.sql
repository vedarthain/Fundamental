-- Immutable history of price-alert FIRES.
--
-- app.price_alert (0052) is the *current line* — its row is edited (re-armed) and
-- can be hard-deleted from the chart, so it can't be trusted to remember that an
-- alert ever fired. This table is the append-only log: one row every time an
-- armed alert's EOD close crosses its level. It outlives the line.
--
-- No FK on alert_id ON PURPOSE: deleting the line (or re-arming it) must not
-- erase the fact that it fired. user_id keeps the FK so history is cleaned up
-- when an account is deleted.
--
-- Acknowledgement lives HERE (not on the live alert): the Alerts tab's "Price
-- alerts" category reads straight from this log, so a fire stays visible — as an
-- active card until acked, greyed after — regardless of what happened to the
-- source line afterwards.
CREATE TABLE app.price_alert_event (
    id              BIGSERIAL PRIMARY KEY,
    alert_id        BIGINT NOT NULL,   -- the price_alert that fired (no FK: history outlives it)
    user_id         BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,     -- bare NSE symbol (snapshot at fire time)
    price           NUMERIC NOT NULL,  -- the level that was crossed
    direction       TEXT NOT NULL CHECK (direction IN ('above', 'below')),
    close_at_event  NUMERIC,           -- the EOD close that tripped it
    event_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ        -- set when the user dismisses the card
);

-- Tab read: this user's fires, newest first.
CREATE INDEX idx_price_alert_event_user
    ON app.price_alert_event (user_id, event_at DESC);
