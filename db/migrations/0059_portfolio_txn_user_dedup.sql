-- 0059 — scope tradebook dedup to the user.
--
-- app.portfolio_transaction.dedup_key had a UNIQUE index on dedup_key ALONE,
-- and tradeDedupKey() didn't hash user_id. A broker trade_id is only unique
-- within one account, and the no-trade_id composite fallback
-- (broker|date|symbol|side|qty|price|time) collides trivially across users —
-- two people buying 10 INFY at the same price on the same day produce the same
-- key. With the global UNIQUE + `ON CONFLICT (dedup_key) DO NOTHING`, the second
-- user's REAL trade was silently swallowed. This makes the key user-scoped.
--
-- Manual entries key as 'manual:<uuid>' (globally unique) and are left as-is.
-- Existing import rows are re-keyed to the new format so a re-upload of an
-- already-imported window stays idempotent (no duplicate rows) rather than
-- inserting a fresh copy under the new key. The re-key string mirrors
-- tradeDedupKey() in web/src/lib/tradebookImport.ts EXACTLY.
--
-- NOTE: app.portfolio_transaction itself is not created by any tracked
-- migration (pre-existing schema drift). This migration is guarded on the
-- table's existence so a from-scratch rebuild is a no-op here rather than an
-- error; on prod/local the table exists and the change applies.

DO $$
BEGIN
  IF to_regclass('app.portfolio_transaction') IS NULL THEN
    RAISE NOTICE 'app.portfolio_transaction absent — skipping 0059';
    RETURN;
  END IF;

  -- Drop the too-narrow unique index before re-keying (a re-key could otherwise
  -- transiently violate uniqueness on the old single-column index).
  DROP INDEX IF EXISTS app.portfolio_transaction_dedup_key_idx;

  -- Re-key existing IMPORT rows (skip manual:<uuid> entries). trade_id present
  -- and non-empty -> tid form; otherwise the natural composite. Mirrors
  -- tradeDedupKey(): md5 of a '|'-joined string prefixed with user_id.
  UPDATE app.portfolio_transaction
     SET dedup_key = md5(
           user_id::text || '|' || broker || '|tid|' || trade_id)
   WHERE dedup_key NOT LIKE 'manual:%'
     AND trade_id IS NOT NULL
     AND trade_id <> '';

  UPDATE app.portfolio_transaction
     SET dedup_key = md5(
           user_id::text || '|' || broker || '|' || trade_date::text || '|'
           || symbol || '|' || side || '|' || quantity::text || '|'
           || price::text || '|' || coalesce(trade_time, ''))
   WHERE dedup_key NOT LIKE 'manual:%'
     AND (trade_id IS NULL OR trade_id = '');

  -- Re-create the uniqueness guarantee, now scoped to the user. This is the
  -- conflict target for `ON CONFLICT (user_id, dedup_key)` in import-trades.
  -- IF NOT EXISTS so the runner can re-apply this file harmlessly if the schema
  -- change was already made by hand (as it was, before the ledger was
  -- reconciled) — migrations must be re-runnable.
  CREATE UNIQUE INDEX IF NOT EXISTS portfolio_transaction_user_dedup_key_idx
      ON app.portfolio_transaction (user_id, dedup_key);
END $$;
