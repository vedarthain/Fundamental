-- 0077 — app.portfolio_import: record the UPLOAD, stop inferring it from rows.
--
-- THE BUG THIS FIXES
--
-- The Import-freshness panel dated each broker's tradebook by
-- MAX(imported_at) over app.portfolio_transaction. That column is stamped per
-- ROW at insert. A tradebook is append-and-dedup (ON CONFLICT DO NOTHING), so
-- a re-upload where every trade is already on record inserts nothing, no row
-- carries the new timestamp, and the panel reports the age of the last time a
-- NEW trade arrived — not the last time a file was uploaded.
--
-- Those two diverge precisely when you upload and nothing is new, which is the
-- HEALTHY outcome. Measured 2026-09-26: a Zerodha tradebook covering
-- 26 Aug – 26 Sep was uploaded and all 6 of its trades were already stored, so
-- the panel kept reading "13d ago" from the 12 Sep insert. A freshness warning
-- that fires on the one case meaning "you are fully current" is worse than no
-- warning: it trains you to ignore it, and the row it will eventually be right
-- about looks identical.
--
-- A row count cannot answer "when did you last upload" because a successful
-- upload is allowed to produce zero rows. So the upload gets recorded as its
-- own fact.
--
-- WHY HOLDINGS ARE HERE TOO, EVEN THOUGH THEY WERE NOT BROKEN
--
-- A holdings import DELETEs the broker's rows and reinserts them, so every
-- surviving row does carry the latest timestamp and MAX(imported_at) happens
-- to be right. That is a coincidence of the write strategy, not a property of
-- the data — change holdings to an upsert and it breaks the same way, silently
-- and with no test to catch it. Both kinds are recorded so freshness has one
-- source of truth rather than two rules that agree today.
--
-- WHAT KEEPS THIS CURRENT (CLAUDE.md §5)
--
-- Nothing seeds this table. Both import routes write a row inside the same
-- transaction as the data, on every upload, whether or not anything landed.
-- The backfill below exists only so the panel is not blank on day one; if the
-- routes ever stop writing, the ages freeze visibly at the backfill dates
-- rather than degrading quietly.

CREATE TABLE IF NOT EXISTS app.portfolio_import (
  id          bigserial PRIMARY KEY,
  user_id     bigint      NOT NULL,
  broker      text        NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('holdings', 'trades')),
  file_name   text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  -- What the file contained and what became of it. `inserted = 0` with
  -- `skipped > 0` is the case the whole table exists for: a real upload that
  -- correctly changed nothing.
  --
  -- NULLABLE WITH NO DEFAULT, on purpose. A default of 0 would hand every
  -- backfilled row a `skipped = 0` — a measurement nobody took, rendered as
  -- "this upload declined nothing", which is the fabricated-zero version of
  -- the same class of bug this table fixes. Null means unmeasured and the UI
  -- prints nothing for it; the routes always supply all three.
  parsed      integer,
  inserted    integer,
  skipped     integer,
  -- The window the FILE claimed, from its own rows. Distinct from how far the
  -- stored history reaches, which is a property of every import together and
  -- is still read off app.portfolio_transaction.
  covers_from date,
  covers_to   date
);

-- The only access pattern: newest upload per (user, broker, kind).
CREATE INDEX IF NOT EXISTS portfolio_import_latest_idx
  ON app.portfolio_import (user_id, broker, kind, uploaded_at DESC);

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Reconstructed from the rows those uploads left behind.
--
-- THE BATCH KEY IS `imported_at`, NOT `source_file`. Every row of one upload
-- is inserted inside a single transaction, and now() is frozen for a
-- transaction's duration, so one upload = one exact timestamp. Grouping by
-- filename instead would fuse repeat uploads of the same export into one
-- event: tradebook-DD1184-EQ.csv was uploaded on 10 Aug and again on 12 Sep,
-- and a filename grouping dates it 10 Aug — understating freshness by a month
-- while looking perfectly reasonable. The timestamp separates them.
--
-- Still lossy in two ways, both of which understate rather than invent:
--
--   * An upload that inserted nothing left no trace and cannot be recovered.
--     Today's Zerodha upload is one — the very case this table exists for is
--     the one the backfill must miss.
--   * `inserted` counts rows from that batch STILL present, not the count at
--     the time. A later correction that deleted rows shrinks it.
--
-- `parsed` is deliberately left at 0 rather than set equal to `inserted`: the
-- file's own row count is not recoverable, and copying `inserted` across would
-- fabricate a "0 skipped" that was never measured.

INSERT INTO app.portfolio_import
  (user_id, broker, kind, file_name, uploaded_at, inserted, covers_from, covers_to)
SELECT t.user_id,
       t.broker,
       'trades',
       MIN(t.source_file),
       t.imported_at,
       COUNT(*),
       MIN(t.trade_date),
       MAX(t.trade_date)
  FROM app.portfolio_transaction t
 WHERE COALESCE(t.source_file, '') NOT IN ('', 'manual-entry')
 GROUP BY t.user_id, t.broker, t.imported_at
 ON CONFLICT DO NOTHING;

-- One row per broker, not per batch: a holdings import replaces the broker's
-- rows wholesale, so only the most recent one is still represented and any
-- earlier batch is unrecoverable.
INSERT INTO app.portfolio_import
  (user_id, broker, kind, file_name, uploaded_at, inserted)
SELECT h.user_id,
       h.broker,
       'holdings',
       NULL,
       MAX(h.imported_at),
       COUNT(*)
  FROM app.portfolio_holding h
 WHERE h.broker <> 'derived'
 GROUP BY h.user_id, h.broker
 ON CONFLICT DO NOTHING;
