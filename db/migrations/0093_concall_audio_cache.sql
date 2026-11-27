-- Cache resolved direct audio/video/webcast URLs extracted from BSE Reg 30 audio cover-letter PDFs
CREATE TABLE IF NOT EXISTS app.concall_audio_cache (
  announcement_id TEXT PRIMARY KEY REFERENCES app.announcement(id) ON DELETE CASCADE,
  symbol          TEXT NOT NULL,
  media_url       TEXT NOT NULL,
  media_kind      TEXT NOT NULL CHECK (media_kind IN ('audio', 'video', 'youtube', 'webcast')),
  source_pdf_url  TEXT,
  resolved_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS concall_audio_cache_symbol_idx
  ON app.concall_audio_cache (symbol, resolved_at DESC);
