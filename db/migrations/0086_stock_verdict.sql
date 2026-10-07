-- app.stock_verdict — hand-written per-symbol verdicts, with their evidence.
--
-- WHY THIS TABLE EXISTS
--
-- The Consumer Durables 23-stock review (reports/consumer-durables-23.html)
-- produced something no scored percentile does: a stated opinion, the figures
-- it rests on, and the condition that would reverse it. This table moves that
-- per symbol, onto an admin-only tab on the stock page.
--
-- It is written BY HAND, in a Claude Code session, one batch of symbols at a
-- time. That is a deliberate choice, not a stopgap. An automated monthly LLM
-- call over an evidence pack was priced ($2-8/month across 306 symbols) and
-- rejected for two reasons, in this order:
--
--   1. The report was good because the data was INTERROGATED. Writing v3
--      surfaced that indicators.daily_signals had 60 columns, zero rows and no
--      writer, and that golden.delivery_data was empty for the same reason.
--      An API call handed a pre-built evidence pack cannot find that. It would
--      have written fluent momentum prose over NULLs, confidently.
--   2. Two of the v2 verdicts (CROMPTON, HAVELLS) were wrong, and were caught
--      only by going back and re-reading them against newly populated data.
--      Nobody re-reads 3,061 generated pages.
--
-- So: fewer verdicts, all of them questioned. The cost of that honesty is that
-- nothing refreshes this table on a schedule, which is CLAUDE.md §5 exactly —
-- "things get seeded and then nothing maintains them". See the last section.
--
-- WHY HISTORY, NOT CURRENT STATE
--
-- PRIMARY KEY (symbol, generated_at): every verdict ever written is kept and
-- nothing is overwritten. The tab reads the newest row and renders the older
-- ones as a timeline. This is not archival sentiment — the most useful part of
-- the v3 report was the table of what changed from v2 and why, and that table
-- can be COMPUTED from two consecutive rows rather than remembered. A verdict
-- whose history is discarded can only ever assert; one with history can show
-- that it moved, when, and against which numbers.
--
-- WHY `evidence` IS STORED RATHER THAN RECOMPUTED
--
-- This is the load-bearing column and the reason the tab can be trusted.
--
-- A date badge does not stop a reader trusting an old opinion. "Written 7 Oct"
-- reads as provenance, not as a warning. So `evidence` freezes the figures the
-- prose was actually written against — PE, OPM, pct_above_200ema_252d,
-- delivery %, promoter stake, whatever the argument leaned on — and the tab
-- re-reads those same metrics live and renders them side by side. When they
-- diverge the page says so in the reader's own terms: "written against PE 40.0
-- — now 47.2". Staleness announces itself through the numbers that moved, not
-- through a clock.
--
-- Asked §5's question — what would make this fail? — a clock cannot fail. It
-- always shows an age, and an age always looks like information. A stored-vs-
-- live comparison fails loudly and specifically, which is the only kind of
-- check worth adding.
--
-- WHY NO FOREIGN KEY ON symbol
--
-- Deliberate. A verdict is a historical record of what was believed on a date.
-- If a symbol is delisted, renamed, or dropped from app.universe, the verdict
-- that was written about it still happened and must survive. An FK with any
-- cascade would silently delete exactly the rows most worth keeping — the ones
-- about positions that ended badly. Orphans are handled in the application as
-- a "dormant" state, not in the schema as a deletion.
--
-- SHAPE
--
--   symbol         NSE symbol, uppercase, no .NS suffix (matches app.scores).
--   generated_at   when the verdict was written. Part of the PK.
--   verdict        the call, free text, as rendered: 'BUY',
--                  'HOLD - downgraded from BUY', 'AVOID AT THIS PRICE'. Free
--                  text because the v3 report's most useful verdicts carried
--                  their own correction in the label, and an enum would have
--                  flattened that into 'HOLD'. Bucketing for colour is the
--                  renderer's job, by prefix.
--   confidence     'high' | 'medium' | 'low'. Capped by DATA COVERAGE, not by
--                  conviction — 9 of the 23 had no company overview and were
--                  capped at medium or low for that reason alone.
--   points         jsonb array of strings, the justification, in order. Light
--                  inline HTML (<b>, <i>, entities) is expected and is rendered
--                  as-is on an admin-only page.
--   trigger_text   "what would change this verdict". Nullable but should never
--                  be null in practice: a verdict with no falsifying condition
--                  is a feeling.
--   evidence       jsonb object, metric key -> value as of writing. See above.
--   snapshot_date  app.metrics_snapshot date the evidence came from.
--   price_asof     latest golden.price_history date behind the technicals.
--   model          which model wrote it, e.g. 'claude-opus-4.7'. Recorded
--                  because a verdict is an argument by a specific author and
--                  comparing authors later requires knowing who wrote what.
--   source_report  optional path/slug of a bulk report this came out of, e.g.
--                  'consumer-durables-23 v3'.
--
-- WHAT KEEPS THIS CURRENT
--
-- Nothing in this file. That is the honest answer and it is why /admin/verdicts
-- is part of the same change rather than a follow-up. That page is a WORK
-- QUEUE, not a report, and it must be able to evict as well as upsert — the
-- previous coverage ledger in this codebase could only upsert, so retired
-- symbols stayed in it forever. Three buckets, from watchlist UNION portfolio:
--
--   missing   tracked, no verdict row          -> needs writing
--   due       newest verdict older than ~45d,
--             or its stored evidence has drifted -> needs revisiting
--   dormant   verdict exists, symbol no longer
--             tracked                          -> keep the row, stop
--                                                 presenting it as current,
--                                                 drop it from the queue
--
-- A symbol with no verdict renders an explicit empty state on the tab. It must
-- never render a blank panel: a tab that shows nothing is indistinguishable
-- from a tab that failed.

CREATE TABLE IF NOT EXISTS app.stock_verdict (
  symbol         text        NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  verdict        text        NOT NULL,
  confidence     text        NOT NULL,
  points         jsonb       NOT NULL,
  trigger_text   text,
  evidence       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  snapshot_date  date,
  price_asof     date,
  model          text,
  source_report  text,

  PRIMARY KEY (symbol, generated_at),

  CONSTRAINT stock_verdict_symbol_upper
    CHECK (symbol = upper(symbol) AND symbol <> ''),
  CONSTRAINT stock_verdict_confidence
    CHECK (confidence IN ('high', 'medium', 'low')),
  -- A verdict with no justification is the thing this table exists to prevent.
  CONSTRAINT stock_verdict_points_nonempty
    CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) > 0),
  CONSTRAINT stock_verdict_evidence_object
    CHECK (jsonb_typeof(evidence) = 'object')
);

-- Chronological feed on /admin/verdicts: every verdict ever written, newest
-- first, across all symbols. The PK serves the per-symbol timeline; this serves
-- reading the month rather than the stock.
CREATE INDEX IF NOT EXISTS stock_verdict_generated_at_idx
  ON app.stock_verdict (generated_at DESC);

COMMENT ON TABLE app.stock_verdict IS
  'Hand-written per-symbol verdicts with the evidence they were written '
  'against. Admin-only; surfaced as a 7th tab on the stock page. Append-only '
  'by PK (symbol, generated_at) so the history of an opinion survives its '
  'revision. See 0086 for why it is manual, why evidence is frozen rather '
  'than recomputed, and why there is no FK on symbol.';

COMMENT ON COLUMN app.stock_verdict.evidence IS
  'Metric key -> value as of writing. The tab re-reads the same metrics live '
  'and shows both, so a stale verdict is exposed by the figures that moved '
  'rather than by its age. Freezing this is the whole staleness mechanism.';

COMMENT ON COLUMN app.stock_verdict.confidence IS
  'high|medium|low, capped by data coverage rather than conviction. A symbol '
  'with no company overview cannot support high confidence however clear the '
  'financials look.';

COMMENT ON COLUMN app.stock_verdict.trigger_text IS
  'What would change this verdict. Nullable for load-time flexibility only — '
  'a verdict with no falsifying condition is not a verdict.';
