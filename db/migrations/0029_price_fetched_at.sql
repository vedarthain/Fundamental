-- Add price_fetched_at to screener_meta so the intraday equity pinger
-- can record exactly when current_price was last written. Displayed on
-- the /stock page so users know how fresh the price is.
ALTER TABLE app.screener_meta
  ADD COLUMN IF NOT EXISTS price_fetched_at TIMESTAMPTZ;
