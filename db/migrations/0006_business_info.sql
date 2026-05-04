-- Adds company business-description fields to app.universe.
-- Sourced from yfinance (which itself sources from companies' regulatory filings).

SET search_path = app, public;

ALTER TABLE app.universe
    ADD COLUMN IF NOT EXISTS business_summary TEXT,
    ADD COLUMN IF NOT EXISTS website          TEXT,
    ADD COLUMN IF NOT EXISTS employees        INT,
    ADD COLUMN IF NOT EXISTS business_info_fetched_at TIMESTAMPTZ;
