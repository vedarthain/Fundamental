-- 0065 — admin-only "Morning Brief". A per-day, per-paper synthesized digest
-- of an epaper edition.
--
-- PRIVACY / COPYRIGHT: the source epaper PDF is Deb's personal, single-user
-- input. It is processed IN MEMORY (unpdf → text → LLM synthesis) and DISCARDED
-- — we NEVER store the PDF or its raw article text. Only the DERIVED brief
-- (our own summarized sections) lands here, and it is surfaced admin-only.
-- This mirrors the news posture (0033): we keep our synthesis + attribution,
-- not the publisher's full text.
--
-- One brief per (paper, brief_date): re-uploading the same edition overwrites
-- (UNIQUE upsert), so a re-run is idempotent. Multi-paper by design — the
-- initial sources are Financial Express and Business Standard.
--
-- `sections` holds the structured brief as JSON (headline groups, per-item
-- summary, optional linked NSE symbols) so the shape can evolve without a
-- migration. `symbols` is a denormalized flat list of every NSE symbol the
-- brief references, for cheap "briefs mentioning X" lookups on stock pages.

CREATE TABLE IF NOT EXISTS app.daily_brief (
    id           BIGSERIAL   PRIMARY KEY,
    -- Which epaper this brief was synthesized from, and for which day.
    paper        TEXT        NOT NULL,   -- 'financial-express' | 'business-standard'
    brief_date   DATE        NOT NULL,   -- the edition date
    -- Provenance of the synthesis (not the source content).
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    model        TEXT,                   -- e.g. 'claude-sonnet-4-6'
    source_pages INTEGER,               -- # of pages that survived the news filter
    -- The derived brief itself. jsonb: { sections: [...], symbols: [...] }-shaped
    -- payload owned by src/lib/dailyBrief.ts. No publisher full text.
    sections     JSONB       NOT NULL,
    -- Flat, denormalized list of referenced NSE symbols (subset of universe).
    symbols      TEXT[]      NOT NULL DEFAULT '{}',
    UNIQUE (paper, brief_date)
);

-- Dominant reads: "latest brief" (order by date) and "brief for a given day".
-- UNIQUE (paper, brief_date) already indexes the second; add a date-desc index
-- for the "newest first" list.
CREATE INDEX IF NOT EXISTS daily_brief_date_idx ON app.daily_brief (brief_date DESC);
-- "which briefs mention symbol X" — GIN over the flat symbol array.
CREATE INDEX IF NOT EXISTS daily_brief_symbols_idx ON app.daily_brief USING GIN (symbols);

COMMENT ON TABLE app.daily_brief IS
'Admin-only synthesized Morning Brief per (paper, brief_date). Stores our derived
summary only — NEVER the source epaper PDF or its raw article text. Surfaced
admin-gated under /news and on stock pages.';

-- Permissions for the app role.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.daily_brief TO fundamental_app;
        GRANT USAGE, SELECT ON SEQUENCE app.daily_brief_id_seq TO fundamental_app;
    END IF;
END $$;
