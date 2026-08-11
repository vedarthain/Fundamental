-- Manual trades + transaction-derived holdings.
--
-- Deb wants two ways to get positions in between broker holdings-snapshot
-- uploads: (1) hand-enter a buy/sell, (2) upload a broker TRANSACTION export
-- (tradebook) in the browser. Both must update the Holdings table AND the B/S
-- chart markers.
--
-- Two data planes already exist:
--   • app.portfolio_transaction — the trade log (drives B/S chart markers).
--     Manual entries go in as broker='manual'; tradebook imports keep their
--     real broker name. No broker CHECK here, so both insert as-is.
--   • app.portfolio_holding — current-positions snapshot (drives Holdings).
--
-- We introduce a synthetic broker 'derived' in portfolio_holding: a position
-- COMPUTED (average-cost) from ALL of a user's transactions for a symbol. It is
-- created ONLY for symbols that have no real broker snapshot — because the
-- snapshot always wins on quantity (it's accurate as of export; a tradebook can
-- be date-windowed and miss pre-window lots). See derivedHoldings.ts.
ALTER TABLE app.portfolio_holding DROP CONSTRAINT IF EXISTS portfolio_holding_broker_check;
ALTER TABLE app.portfolio_holding ADD CONSTRAINT portfolio_holding_broker_check
  CHECK (broker = ANY (ARRAY['upstox', 'zerodha', 'fyers', 'fivepaisa', 'groww', 'derived']));
