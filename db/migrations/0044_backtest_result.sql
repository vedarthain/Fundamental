-- 0044 — app.backtest_result: cached output of the Trend Leaders backtest.
--
-- Populated by a one-shot study job (scripts/backtest-trend-leaders.py, not yet
-- built — see docs/BACKTEST_TREND_LEADERS.md), NOT a daily cron. The
-- /tools/momentum "Backtest" tab reads the latest run_date. Until the engine
-- runs, this table is empty and the tab shows methodology + a "not yet run"
-- state — deliberately, so the UI never implies a validation that hasn't
-- happened.
--
-- Long format: one row per (run_date, config, cohort, horizon_days). The
-- headline metric is win_rate_vs_bench (share of signals beating the benchmark
-- over the same calendar window, net of costs). config distinguishes the honest
-- 35-year price-only test from the tiny score-filtered sample (~2 months of
-- point-in-time scores exist), which must be labelled small-sample.

CREATE TABLE IF NOT EXISTS app.backtest_result (
  run_date          date          NOT NULL,   -- when the study was run
  config            text          NOT NULL,   -- 'price-only' | 'price+score>=66' | 'random-null'
  cohort            text          NOT NULL,   -- signal-year label ('2019'…'2026') or 'all'
  horizon_days      int           NOT NULL,   -- 21 | 63 | 126 | 252
  signal_count      int           NOT NULL,   -- fires in this cohort (hide < 20 in UI)
  avg_ret           numeric(9,2),             -- net avg forward return, %
  median_ret        numeric(9,2),
  win_rate          numeric(6,2),             -- % of signals with positive net return
  benchmark_ret     numeric(9,2),             -- avg benchmark return over matched windows, %
  excess_ret        numeric(9,2),             -- net avg − benchmark, %
  win_rate_vs_bench numeric(6,2),             -- % of signals beating benchmark  (HEADLINE)
  max_drawdown      numeric(9,2),             -- worst single-signal net outcome, %
  hit_2x            numeric(6,2),             -- % that doubled within 12M
  is_small_sample   boolean       NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (run_date, config, cohort, horizon_days)
);

CREATE INDEX IF NOT EXISTS idx_backtest_result_run
  ON app.backtest_result (run_date DESC, config, cohort);

COMMENT ON TABLE app.backtest_result IS
  'Cached Trend Leaders backtest output (one-shot study job, not a cron). Headline = win_rate_vs_bench, net of a 1% round-trip cost, over matched benchmark windows. Price-only config is the honest 35-year test; score-filtered config is small-sample (only ~2 months of point-in-time scores exist). See docs/BACKTEST_TREND_LEADERS.md.';
