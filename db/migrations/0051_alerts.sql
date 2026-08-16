-- Portfolio alerts — ring 1 (holdings discipline).
--
-- Deb can't eyeball 2000+ names daily, so a cron evaluates a small set of
-- price-vs-reference rules on the stocks he HOLDS and writes any trip here. The
-- Tools → Alerts tab reads this table: active cards on top, dismissed greyed.
--
-- The whole design hinges on an alert being an EPISODE with identity, not a
-- query result — otherwise "dismiss" can't stick (the rule is still true
-- tomorrow, so it re-appears). Lifecycle:
--
--   active  → dismissed   (you ack it; stays greyed, will NOT re-fire)
--   active  → resolved    (the condition cleared; the evaluator retires it)
--
-- A partial UNIQUE index guarantees at most ONE non-resolved row per
-- (user, rule, symbol) — i.e. one open episode. The evaluator:
--   • condition true  → INSERT ... ON CONFLICT DO NOTHING  (noop if open)
--   • condition false → UPDATE the open row to 'resolved'  (re-arms it)
-- So dismissing silences an episode until the condition clears and re-crosses,
-- which then opens a fresh episode. No escalation on "further gains" by design.
CREATE TABLE app.alert (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    rule_key      TEXT NOT NULL,   -- 'target_hit' | 'big_down_day' | 'deep_drawdown'
    symbol        TEXT NOT NULL,   -- bare NSE symbol (no .NS)
    severity      TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'urgent')),
    title         TEXT NOT NULL,   -- short card heading
    reason        TEXT NOT NULL,   -- the human "why", pre-rendered
    context       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- price/target/avg… for the card
    dedup_key     TEXT NOT NULL,   -- 'rule_key|symbol' — episode identity
    status        TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'dismissed', 'resolved')),
    triggered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    dismissed_at  TIMESTAMPTZ,
    resolved_at   TIMESTAMPTZ
);

-- One open episode per (user, rule, symbol). Powers ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX uq_alert_open
    ON app.alert (user_id, rule_key, symbol)
    WHERE status <> 'resolved';

-- The tab's read path: a user's non-resolved alerts, newest first.
CREATE INDEX idx_alert_user_status
    ON app.alert (user_id, status, triggered_at DESC)
    WHERE status <> 'resolved';
