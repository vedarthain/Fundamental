-- Allow 'dvr_duplicate' as a universe_event.source.
--
-- WHY A NEW SOURCE RATHER THAN REUSING 'non_equity'
--   app.universe_event is the immutable record of why a symbol entered or left
--   the scored universe, and the `source` column is the only place the REASON
--   survives — is_active is a boolean and forgets. The existing values each
--   encode a distinct kind of evidence:
--
--     sync        gone dark on NSE (no daily bar for 60d)
--     backfill    the original one-off seed
--     fund        ISIN starts with INF — an ETF / mutual-fund unit
--     non_equity  absent from EQUITY_L.csv AND zero rows in fundamentals_annual
--
--   A DVR retirement is none of those. FELDVR, GATECHDVR and JISLDVREQS are
--   present in EQUITY_L, trade daily, and carry a full fundamentals history —
--   every existing test says "keep". They are removed for a reason no other
--   bucket expresses: the company is ALREADY IN THE UNIVERSE under its ordinary
--   symbol, and the DVR is a second share class of it.
--
--   Folding this into 'non_equity' would assert something false about the row
--   (that it has no fundamentals) and would make the two cleanups
--   indistinguishable in the event log — which is the one thing the event log
--   exists to prevent.
--
-- WHY IT MATTERS THAT THIS IS RECORDED AT ALL
--   GATECHDVR was scoring composite 100 / valuation 100 in a 180-name cluster
--   while its ordinary share GATECH scored 64 / 56 — same company, same
--   earnings. A DVR trades at a standing discount to the ordinary share, so the
--   parent's earnings over the discounted price always read as cheap. Anyone
--   later asking "why did the #1 name in bfsi_nbfc disappear" needs to find the
--   answer here, not reconstruct it.
ALTER TABLE app.universe_event
    DROP CONSTRAINT IF EXISTS universe_event_source_check;

ALTER TABLE app.universe_event
    ADD CONSTRAINT universe_event_source_check
    CHECK (source = ANY (ARRAY[
        'sync'::text,
        'backfill'::text,
        'fund'::text,
        'non_equity'::text,
        'dvr_duplicate'::text
    ]));
