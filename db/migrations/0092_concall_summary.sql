-- 0092 — app.concall_summary: Quote-verified, strictly factual earnings call digests.
--
-- Stores structured management commentary extracted from BSE-filed earnings call
-- transcripts (app.announcement). Public/user-facing fields are strictly factual
-- (Guidance, Demand, Margins, Capex, Risks, Analyst Q&A) with verbatim quotes
-- verified against the source PDF text to prevent LLM hallucination.

CREATE TABLE IF NOT EXISTS app.concall_summary (
    id               bigserial    PRIMARY KEY,
    symbol           text         NOT NULL REFERENCES app.universe(symbol) ON DELETE CASCADE,
    announcement_id  text         UNIQUE REFERENCES app.announcement(id) ON DELETE SET NULL,
    quarter_label    text,
    published_at     timestamptz  NOT NULL,
    pdf_url          text,
    tone             text         NOT NULL CHECK (tone IN ('Optimistic', 'Neutral', 'Cautious')),
    tone_rationale   text,
    -- [{"category": "Guidance"|"Demand"|"Margins"|"Capex"|"Order Book"|"Risk", "point": "...", "quote": "..."}]
    highlights       jsonb        NOT NULL DEFAULT '[]'::jsonb,
    -- [{"topic": "...", "question": "...", "answer": "...", "quote": "..."}]
    qa_highlights    jsonb        NOT NULL DEFAULT '[]'::jsonb,
    -- [{"metric": "...", "value": "...", "quote": "..."}]
    numbers_mentioned jsonb       NOT NULL DEFAULT '[]'::jsonb,
    model            text         NOT NULL,
    source_sha256    text         NOT NULL,
    verified_ratio   real         NOT NULL DEFAULT 1.0,
    created_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS concall_summary_symbol_pub_idx
    ON app.concall_summary (symbol, published_at DESC);

CREATE INDEX IF NOT EXISTS concall_summary_pub_idx
    ON app.concall_summary (published_at DESC);
