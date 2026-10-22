-- app.stock_verdict.anchor_price — the price the verdict was written against,
-- stored rather than derived.
--
-- WHY STORED AND NOT COMPUTED ON READ
--
-- The Verdict tab now shows, per row, the price on the verdict's own
-- `price_asof` date, the latest close, and the move between them. Every input
-- for that was already available: `price_asof` is on this table, and the
-- latest close comes from `latestCloseBySymbol()` in web/src/lib/calls.ts,
-- which the calls feature already trusts. So the anchor could simply have been
-- looked up from golden.price_history on every read, with no migration at all.
--
-- It is stored anyway, for the same reason app.stock_call stores
-- `anchor_price` instead of recomputing it: **golden.price_history is
-- back-adjusted.** A split or bonus issue rewrites every historical close for
-- that symbol, retroactively. A derived anchor would therefore change by
-- itself, silently, long after the verdict was written — and the number it
-- changes is the one the reader uses to judge whether the call worked. The
-- displayed move would quietly become right-looking and wrong, with no event
-- to notice. A stored anchor cannot do that. It is what the price was, full
-- stop, and if a split makes it incomparable to today's close then the
-- comparison is visibly odd rather than invisibly adjusted.
--
-- This is the same reasoning as `evidence` on this table (see 0086): the
-- figures a verdict rests on are frozen at writing time precisely so that
-- drift becomes measurable instead of being absorbed.
--
-- NULLABLE, DELIBERATELY
--
-- Two populations cannot have one:
--
--   * A symbol golden has no bars for on or before `price_asof`. At the time
--     of writing all 257 verdicts with a non-NULL `price_asof` resolved, but a
--     newly listed or suspended symbol legitimately may not, and a NOT NULL
--     here would block a verdict from being written at all over a missing
--     price — which inverts the priority. The prose is the asset.
--   * Rows whose `price_asof` is itself NULL. 26 exist (the two
--     `oil-refining*` batches, whose generators omitted the field); the
--     backfill below fills them from `snapshot_date`, which is the date the
--     evidence pack was cut and therefore the only defensible proxy.
--
-- The UI renders a missing anchor as an explicit "no anchor price" rather than
-- a zero or a dash, because a 0.00 move is a claim and an absent one is not.
--
-- WHAT KEEPS THIS CURRENT  (CLAUDE.md §5)
--
-- A column added by a backfill and fed by nothing is the next bug in this
-- codebase, and this table has already produced that exact failure once:
-- `price_asof` has been on app.stock_verdict since 0086, but
-- scripts/verdict-load.py read it as `v.get("price_asof")` with no fallback,
-- so two batches whose generators never set the key wrote NULL and nobody
-- noticed for two weeks. So the loader is changed in the same commit as this
-- migration: it defaults `price_asof` to the snapshot date and resolves
-- `anchor_price` from golden at load time. There is no path that inserts a
-- verdict without attempting both. That — not this ALTER — is the part of the
-- change that has to hold.

ALTER TABLE app.stock_verdict
  ADD COLUMN IF NOT EXISTS anchor_price numeric;

COMMENT ON COLUMN app.stock_verdict.anchor_price IS
  'Close on price_asof from golden.price_history, frozen at load time. Stored '
  'rather than derived because golden is split-back-adjusted and a derived '
  'anchor would silently rewrite the displayed move. NULL = unresolvable; '
  'render it as absent, never as zero.';
