/**
 * Validation harness — does the fundamental score predict forward returns?
 *
 * PRIVATE / admin-only. This is the honest backbone of the "recommendation
 * desk": before trusting composite_pct (or Q/V/M) to pick trades, measure
 * whether a higher score has actually preceded higher forward returns.
 *
 * Method (per weekly snapshot, per forward horizon):
 *   - Entry  = first golden EOD close on/after the snapshot date.
 *   - Exit   = close H trading days later.
 *   - Forward return = exit/entry − 1.
 *   - IC     = Spearman rank correlation between a factor and forward return
 *              across all scored stocks in that snapshot (−1..+1; ~0 = no
 *              signal, >0.05 = weak edge, >0.1 = decent).
 *   - Decile spread = mean forward return of the top-decile-by-composite minus
 *                     the bottom decile. This is the tradable proxy: "if I buy
 *                     the highest-scored names and avoid the lowest, what's the
 *                     realised gap?"
 *
 * IMPORTANT — the score archive only exists point-in-time from 2026-05-04, so
 * results are short-horizon and single-regime today. The harness accrues power
 * automatically as app.scores grows each Friday; it is NOT a verdict yet.
 *
 * Cross-DB: scores live in the app DB (`sql`), prices in golden (`golden`).
 * We pull both and join in JS — there is no cross-database SQL join.
 */
import { sql, golden } from "@/lib/db";
import { unstable_cache } from "next/cache";

export const HORIZONS_TD = [5, 10, 21] as const; // trading days (~1w, ~2w, ~1mo)
export type Horizon = (typeof HORIZONS_TD)[number];

export type FactorKey = "composite" | "quality" | "valuation" | "momentum";

export type SnapshotResult = {
  snapshot: string; // ISO date
  n: number; // stocks with forward data at this horizon
  ic: Record<FactorKey, number | null>;
  topDecileRet: number | null; // mean fwd return, top decile by composite
  botDecileRet: number | null;
  spread: number | null; // top − bot
};

export type HorizonResult = {
  horizon: Horizon;
  snapshots: SnapshotResult[];
  // Averages across snapshots that had enough forward data.
  avgIc: Record<FactorKey, number | null>;
  avgSpread: number | null;
  nSnapshots: number;
};

export type ValidationReport = {
  generatedAt: string;
  totalSnapshots: number; // snapshots in the archive
  archiveStart: string | null;
  archiveEnd: string | null;
  universeLatest: number; // scored stocks in the latest snapshot
  horizons: HorizonResult[];
};

type ScoreRow = {
  symbol: string;
  snapshot_date: string;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
};

const MIN_SNAPSHOT_N = 30; // don't compute IC on a handful of names

/** Dense-rank a numeric array (ties share the average rank is overkill here;
 *  argsort-of-argsort ordinal ranks are fine for Spearman on ~2k points). */
function ordinalRanks(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const ranks = new Array(xs.length);
  for (let r = 0; r < idx.length; r++) ranks[idx[r]] = r;
  return ranks;
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < MIN_SNAPSHOT_N) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va === 0 || vb === 0) return null;
  return cov / Math.sqrt(va * vb);
}

/** Spearman IC between factor values and forward returns (drops null factors). */
function spearman(factor: (number | null)[], ret: number[]): number | null {
  const f: number[] = [], r: number[] = [];
  for (let i = 0; i < factor.length; i++) {
    const fv = factor[i];
    if (fv == null || !Number.isFinite(ret[i])) continue;
    f.push(fv); r.push(ret[i]);
  }
  if (f.length < MIN_SNAPSHOT_N) return null;
  return pearson(ordinalRanks(f), ordinalRanks(r));
}

async function compute(): Promise<ValidationReport> {
  // 1. All scored rows.
  const scores = await sql<ScoreRow[]>`
    SELECT symbol, snapshot_date::text AS snapshot_date,
           composite_pct, quality_pct, valuation_pct, momentum_pct
    FROM app.scores
    WHERE composite_pct IS NOT NULL
  `.catch(() => [] as ScoreRow[]);

  const snapshots = [...new Set(scores.map((s) => s.snapshot_date))].sort();
  const symbols = [...new Set(scores.map((s) => s.symbol))];

  if (snapshots.length === 0 || symbols.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      totalSnapshots: 0, archiveStart: null, archiveEnd: null,
      universeLatest: 0, horizons: [],
    };
  }

  const archiveStart = snapshots[0];
  const archiveEnd = snapshots[snapshots.length - 1];

  // 2. Daily closes for those symbols from golden (add .NS suffix to match).
  const gsyms = symbols.map((s) => `${s}.NS`);
  const priceRows = await golden<{ symbol: string; date: string; close: string }[]>`
    SELECT symbol, date::text AS date, close::text AS close
    FROM golden.price_history_1d
    WHERE symbol = ANY(${gsyms})
      AND date >= ${archiveStart}
      AND close IS NOT NULL
    ORDER BY symbol, date
  `.catch(() => [] as { symbol: string; date: string; close: string }[]);

  // series[bareSymbol] = [[date, close], ...] ascending by date
  const series = new Map<string, [string, number][]>();
  for (const r of priceRows) {
    const bare = r.symbol.endsWith(".NS") ? r.symbol.slice(0, -3) : r.symbol;
    let arr = series.get(bare);
    if (!arr) { arr = []; series.set(bare, arr); }
    arr.push([r.date, Number(r.close)]);
  }

  // forward return: entry = first close on/after snap; exit = H trading days later
  function fwdReturn(symbol: string, snap: string, h: number): number | null {
    const s = series.get(symbol);
    if (!s) return null;
    let lo = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i][0] >= snap) { lo = i; break; }
    }
    if (lo < 0 || lo + h >= s.length) return null;
    const entry = s[lo][1], exit = s[lo + h][1];
    if (!(entry > 0)) return null;
    return exit / entry - 1;
  }

  const bySnap = new Map<string, ScoreRow[]>();
  for (const r of scores) {
    let arr = bySnap.get(r.snapshot_date);
    if (!arr) { arr = []; bySnap.set(r.snapshot_date, arr); }
    arr.push(r);
  }

  const horizons: HorizonResult[] = HORIZONS_TD.map((h) => {
    const snapResults: SnapshotResult[] = [];
    for (const snap of snapshots) {
      const recs = bySnap.get(snap) ?? [];
      const comp: (number | null)[] = [];
      const qual: (number | null)[] = [];
      const val: (number | null)[] = [];
      const mom: (number | null)[] = [];
      const ret: number[] = [];
      const compForDecile: { c: number; r: number }[] = [];
      for (const rec of recs) {
        const fr = fwdReturn(rec.symbol, snap, h);
        if (fr == null) continue;
        comp.push(rec.composite_pct);
        qual.push(rec.quality_pct);
        val.push(rec.valuation_pct);
        mom.push(rec.momentum_pct);
        ret.push(fr);
        if (rec.composite_pct != null) compForDecile.push({ c: rec.composite_pct, r: fr });
      }
      const n = ret.length;
      let topDecileRet: number | null = null, botDecileRet: number | null = null, spread: number | null = null;
      if (compForDecile.length >= MIN_SNAPSHOT_N) {
        compForDecile.sort((a, b) => a.c - b.c);
        const k = Math.max(1, Math.floor(compForDecile.length / 10));
        const bot = compForDecile.slice(0, k);
        const top = compForDecile.slice(-k);
        botDecileRet = bot.reduce((s, x) => s + x.r, 0) / bot.length;
        topDecileRet = top.reduce((s, x) => s + x.r, 0) / top.length;
        spread = topDecileRet - botDecileRet;
      }
      snapResults.push({
        snapshot: snap,
        n,
        ic: {
          composite: spearman(comp, ret),
          quality: spearman(qual, ret),
          valuation: spearman(val, ret),
          momentum: spearman(mom, ret),
        },
        topDecileRet, botDecileRet, spread,
      });
    }

    // Averages across snapshots with enough data.
    const withData = snapResults.filter((s) => s.n >= MIN_SNAPSHOT_N);
    const avgOf = (pick: (s: SnapshotResult) => number | null): number | null => {
      const vals = withData.map(pick).filter((x): x is number => x != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return {
      horizon: h,
      snapshots: snapResults,
      avgIc: {
        composite: avgOf((s) => s.ic.composite),
        quality: avgOf((s) => s.ic.quality),
        valuation: avgOf((s) => s.ic.valuation),
        momentum: avgOf((s) => s.ic.momentum),
      },
      avgSpread: avgOf((s) => s.spread),
      nSnapshots: withData.length,
    };
  });

  const universeLatest = (bySnap.get(archiveEnd) ?? []).length;

  return {
    generatedAt: new Date().toISOString(),
    totalSnapshots: snapshots.length,
    archiveStart, archiveEnd, universeLatest,
    horizons,
  };
}

// The archive only changes weekly; cache 6h so repeated admin views don't
// re-run the join, but a same-day re-run of the ETL is picked up reasonably.
export const getValidationReport = unstable_cache(compute, ["validation-report-v1"], {
  revalidate: 21600,
  tags: ["validation"],
});
