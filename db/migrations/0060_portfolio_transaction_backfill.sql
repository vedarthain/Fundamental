-- 0060 — backfill the CREATE TABLE for app.portfolio_transaction.
--
-- Schema drift repair: app.portfolio_transaction exists in every live DB but was
-- never created by a tracked migration (it predates 0050, which only references
-- it in prose). A from-scratch rebuild therefore lacked the table entirely, and
-- 0059 (which re-keys + re-indexes it) is guarded to no-op when it's absent.
--
-- This migration reconstructs the table from the live schema so a fresh build
-- matches prod. It is IF NOT EXISTS / idempotent: on prod + local the table
-- already exists and this is a no-op; only a clean rebuild actually creates it.
--
-- Ordering note: this runs AFTER 0059, and 0059 skips when the table is missing.
-- So on a clean build the table is created HERE in its final, post-0059 shape —
-- the unique index is (user_id, dedup_key), never the old dedup_key-only one.
-- Two divergences from the drifted live copy are deliberately corrected for new
-- builds (harmless on existing DBs, which keep their current form via IF NOT
-- EXISTS): a real FK on user_id -> app.users(id) ON DELETE CASCADE (matching the
-- other portfolio tables in 0041), and bigserial for id.

CREATE TABLE IF NOT EXISTS app.portfolio_transaction (
  id           bigserial   PRIMARY KEY,
  user_id      bigint      NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  broker       text        NOT NULL,     -- 'manual' | 'derived' | real broker name
  trade_date   date        NOT NULL,
  trade_time   text,                     -- broker execution timestamp (raw string) or NULL
  side         text        NOT NULL,     -- 'buy' | 'sell'
  symbol       text        NOT NULL,     -- resolved app.universe.symbol
  raw_symbol   text,                     -- broker's original identifier (audit)
  raw_name     text,                     -- broker's company name (audit / name-resolution)
  isin         text,
  quantity     numeric     NOT NULL,
  price        numeric     NOT NULL,
  trade_id     text,                     -- broker trade id (unique within an account)
  order_id     text,
  source_file  text,                     -- upload filename, or 'manual-entry'
  dedup_key    text        NOT NULL,     -- user-scoped: see tradeDedupKey() + 0059
  imported_at  timestamptz NOT NULL DEFAULT now()
);

-- User-scoped uniqueness (post-0059). Conflict target for import-trades'
-- `ON CONFLICT (user_id, dedup_key) DO NOTHING`.
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_transaction_user_dedup_key_idx
  ON app.portfolio_transaction (user_id, dedup_key);

CREATE INDEX IF NOT EXISTS portfolio_transaction_user_symbol_idx
  ON app.portfolio_transaction (user_id, symbol);

COMMENT ON TABLE app.portfolio_transaction IS
  'Per-user trade log (broker tradebook imports + manual entries). Drives Buy/Sell chart markers and average-cost derived holdings. Append-only; deduped per user on dedup_key.';
