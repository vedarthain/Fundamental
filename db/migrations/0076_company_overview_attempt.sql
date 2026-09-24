-- Attempt ledger for the daily company-overview worker.
--
-- WHY THIS TABLE EXISTS
--
-- app.company_overview only records SUCCESSES. A symbol with no Screener wiki
-- page and no yfinance prose writes nothing at all, so it stays "missing"
-- forever. A daily worker that selects "symbols with no overview row" would
-- therefore hand back the same permanently-empty symbols every single night,
-- burning Screener's 80/day allowance on pages that will never yield anything
-- and starving the symbols that would.
--
-- That is CLAUDE.md section 5 in its other form: not a check that cannot fail,
-- but a queue that cannot drain. The backfill would look busy forever and
-- finish never.
--
-- WHY retry_after RATHER THAN A COUNTER
--
-- A plain attempt counter needs a MAX_ATTEMPTS constant, and any such constant
-- is a guess that permanently blacklists a symbol on the strength of it. A
-- timestamp instead says "ask again later", which is what we actually mean:
--   built          -> +180 days   the description itself barely changes
--   unchanged      -> +45  days   the wiki page hash was identical
--   no_input       -> +90  days   no wiki page AND no yfinance prose today;
--                                 refresh-company-info.yml may supply prose
--                                 on the 5th of some future month
--   kept_existing  -> +90  days   Key Points was unavailable and we refused to
--                                 downgrade a good row to yfinance
--
-- Nothing is ever permanently excluded, and every window is set by the writer
-- from the outcome it just observed, not from a constant read at query time.
--
-- The worker writes this row for every symbol it ATTEMPTS. It deliberately
-- does NOT write one for the symbol that tripped the Screener daily quota:
-- that symbol was never fetched, and recording an attempt would push it to the
-- back of tomorrow's queue for work that never happened.

CREATE TABLE IF NOT EXISTS app.company_overview_attempt (
  symbol          text PRIMARY KEY REFERENCES app.universe(symbol) ON DELETE CASCADE,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_outcome    text        NOT NULL,
  attempts        integer     NOT NULL DEFAULT 1,
  retry_after     timestamptz NOT NULL,
  CONSTRAINT company_overview_attempt_outcome_known
    CHECK (last_outcome IN ('built', 'unchanged', 'no_input', 'kept_existing')),
  CONSTRAINT company_overview_attempt_retry_is_future
    CHECK (retry_after > last_attempt_at)
);

-- The queue reads `WHERE retry_after <= now()` ordered by retry_after on every
-- run, over the whole active universe.
CREATE INDEX IF NOT EXISTS company_overview_attempt_retry_idx
  ON app.company_overview_attempt (retry_after);
