-- User-defined price alerts — the "draw a line on the chart" feature.
--
-- Distinct from app.alert (0051): those are AUTO episodes the evaluator derives
-- from portfolio rules. THIS table is a STANDING user rule — "tell me when SYM
-- reaches ₹X". It's the source of truth for the green/orange "A" marker on the
-- stock chart AND for the Alerts tab's "Price alerts" category.
--
-- Lifecycle (no partial-unique gymnastics — multiple lines per symbol are the
-- whole point, so we allow many open rows per (user, symbol)):
--
--   armed      the line is set, price hasn't reached it yet   → GREEN on chart
--   triggered  EOD close crossed the level in its direction   → ORANGE on chart,
--              shows as a card in the Alerts "Price alerts" tab
--   dismissed  user acked the triggered card                  → greyed, no line
--
-- Direction is INFERRED at creation from where the target sits vs the current
-- price (target above → 'above' (a target); below → 'below' (a stop)), so the
-- alert always starts armed. Evaluation is EOD-only (v1): the daily cron / the
-- tab's "Check now" compares the latest golden close to each armed level.
CREATE TABLE app.price_alert (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    symbol        TEXT NOT NULL,   -- bare NSE symbol (no .NS)
    price         NUMERIC NOT NULL CHECK (price > 0),  -- the level to watch
    direction     TEXT NOT NULL CHECK (direction IN ('above', 'below')),
    status        TEXT NOT NULL DEFAULT 'armed'
                    CHECK (status IN ('armed', 'triggered', 'dismissed')),
    note          TEXT,            -- optional user label (unused in v1 UI)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    triggered_at  TIMESTAMPTZ,
    dismissed_at  TIMESTAMPTZ
);

-- Chart lookup: this user's live (armed|triggered) lines for one symbol.
CREATE INDEX idx_price_alert_user_symbol
    ON app.price_alert (user_id, symbol)
    WHERE status <> 'dismissed';

-- Evaluator: sweep all armed alerts for a user (any symbol) each run.
CREATE INDEX idx_price_alert_user_status
    ON app.price_alert (user_id, status);
