-- 0040 — app.recommendations: strategy versioning for the "go-big" v2 desk.
--
-- The desk gains a second strategy that coexists with the original in the SAME
-- table, so every settlement must know which rule-set to apply:
--
--   v1 (legacy, 16 existing cohorts) — top-10 by composite, fixed −8% stop /
--      +15% target, 21-trading-day horizon. Fixed target => target_price set.
--   v2 ("go big")                    — top-20 by a 5-leg absolute key, 25%
--      trailing-stop exit, −20% hard stop, 252-trading-day (1yr) horizon,
--      monthly cadence. NO fixed target => target_price is NULL.
--
-- Existing rows are v1 by construction (DEFAULT 1 backfills them). target_price
-- is made nullable because a trailing-stop strategy has no fixed take-profit.
-- settle() in web/src/lib/recommendations.ts branches on strategy_version.

ALTER TABLE app.recommendations
  ADD COLUMN IF NOT EXISTS strategy_version smallint NOT NULL DEFAULT 1;

ALTER TABLE app.recommendations
  ALTER COLUMN target_price DROP NOT NULL;

COMMENT ON COLUMN app.recommendations.strategy_version IS
  '1 = legacy fixed stop/target (21td); 2 = go-big trailing-stop (252td, target_price NULL).';
