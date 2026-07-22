/**
 * backtest.ts — read model for the Trend Leaders backtest study.
 *
 * The backtest is a ONE-SHOT study (scripts/backtest-trend-leaders.py, not yet
 * built — see docs/BACKTEST_TREND_LEADERS.md), not a daily cron. This module
 * only READS the cached result from app.backtest_result (0044). When the engine
 * hasn't run, the table is empty and the tab renders methodology + "not yet
 * run" — deliberately, so the UI never implies a validation that didn't happen.
 */
import { sql } from "@/lib/db";

export type BacktestRow = {
  config: string;
  cohort: string;
  horizonDays: number;
  signalCount: number;
  avgRet: number | null;
  medianRet: number | null;
  winRate: number | null;
  benchmarkRet: number | null;
  excessRet: number | null;
  winRateVsBench: number | null;
  maxDrawdown: number | null;
  hit2x: number | null;
  isSmallSample: boolean;
  notes: string | null;
};

export async function loadLatestBacktest(): Promise<{ runDate: string | null; rows: BacktestRow[] }> {
  const dateRow = await sql<{ d: string | null }[]>`
    SELECT max(run_date)::text AS d FROM app.backtest_result
  `;
  const runDate = dateRow[0]?.d ?? null;
  if (!runDate) return { runDate: null, rows: [] };

  const rows = await sql<
    {
      config: string;
      cohort: string;
      horizonDays: number;
      signalCount: number;
      avgRet: number | null;
      medianRet: number | null;
      winRate: number | null;
      benchmarkRet: number | null;
      excessRet: number | null;
      winRateVsBench: number | null;
      maxDrawdown: number | null;
      hit2x: number | null;
      isSmallSample: boolean;
      notes: string | null;
    }[]
  >`
    SELECT config,
           cohort,
           horizon_days::int          AS "horizonDays",
           signal_count::int          AS "signalCount",
           avg_ret::float8            AS "avgRet",
           median_ret::float8         AS "medianRet",
           win_rate::float8           AS "winRate",
           benchmark_ret::float8      AS "benchmarkRet",
           excess_ret::float8         AS "excessRet",
           win_rate_vs_bench::float8  AS "winRateVsBench",
           max_drawdown::float8       AS "maxDrawdown",
           hit_2x::float8             AS "hit2x",
           is_small_sample            AS "isSmallSample",
           notes
    FROM app.backtest_result
    WHERE run_date = ${runDate}
    ORDER BY config, horizon_days, cohort
  `;
  return { runDate, rows };
}
