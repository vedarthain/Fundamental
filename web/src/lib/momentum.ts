/**
 * momentum.ts — the "volume-ignition" breakout scanner.
 *
 * Catches the FIRST day of a run, not the aftermath: a stock making a big
 * up-move on abnormal volume while breaking a fresh high. Validated against
 * Kalyan Jewellers (+18% on 11.7x volume, Jul 9) and a full latest-day sweep
 * where every hit was a real results/order catalyst — zero pump-and-dumps.
 *
 * The delivery-% signal was removed entirely: as a "pump filter" it false-
 * flagged all five genuine winners (heavy intraday churn is normal on a
 * catalyst day), so it was never a filter — only a display column — and the
 * prod golden DB doesn't even carry delivery_pct. The real pump-guard is the
 * CATALYST column: a blank headline is the human flag, never an auto-reject.
 *
 * Two-DB shape (mirrors portfolio.ts): the price screen runs on `golden`, then
 * fundamental rank + catalyst enrichment come from `app`, merged in JS.
 */
import { sql, golden } from "@/lib/db";

export type MomentumSignal = {
  symbol: string;
  close: number;
  retPct: number;
  volX: number;
  newHigh: boolean;
  marketCapCr: number | null;
  compositePct: number | null;
  qualityPct: number | null;
  momentumPct: number | null;
  isScored: boolean;
  /** Broad sector (meta_cluster.name). */
  sector: string | null;
  /** Peer group (cluster.name) — the scoring cluster the stock sits in. */
  industry: string | null;
  catalystTitle: string | null;
  catalystUrl: string | null;
  catalystSource: string | null;
  catalystAt: string | null;
};

/**
 * Circular / price-move headlines carry no catalyst value: they just restate
 * the move the scanner already detected ("Here's why shares of Max India gained
 * up to 10%", "Stock jumps 12% intraday", "Top gainers today"). We reject these
 * so the catalyst column shows the REASON (results, order win, deal) rather than
 * the effect. If every candidate is circular we fall back to the newest so the
 * cell isn't empty — but a real headline is always preferred.
 */
const CIRCULAR_CATALYST_RE = new RegExp(
  [
    "here'?s why",
    "^why (did|is|are|has|do|does)\\b",
    "shares? of .+\\b(gain|gains|gained|ros[e]|rise|rises|jump|jumps|jumped|surge|surges|surged|rall|fall|falls|fell|drop|drops|dropped|slump|tank|plunge|slip|slid|zoom|soar|spike|end|ended|clos)",
    "\\bstock\\b.+\\b(jump|jumps|jumped|surge|surges|surged|rall|gain|gains|gained|rise|rises|ros[e]|fall|falls|fell|drop|drops|dropped|slump|tank|plunge|zoom|soar|climb|spike|edge|end|ended)",
    "top (gainers|losers)",
    "\\d+(\\.\\d+)?\\s*% (intraday|today|this week|in early trade|in trade|on (mon|tues|wednes|thurs|fri)day)",
    "\\bbuzzing\\b",
    "hits? (a )?(fresh |new |record )?(all.?time |52.?week |multi.?year )?(high|low)",
    "52.?week (high|low)",
    "movers?( and shakers)?\\b",
    "\\bin focus\\b.*\\b(gain|surge|jump|rally|fall|drop)\\b",
  ].join("|"),
  "i",
);

/** True when a headline is a circular price-move restatement, not a catalyst. */
function isCircularHeadline(title: string | null): boolean {
  return !!title && CIRCULAR_CATALYST_RE.test(title);
}

/** Ruleset knobs — one place to tune the screen. */
const RET_MIN = 0.06; //  >= 6% up-day
const VOL_MULT = 3; //    >= 3x its own 50-day average volume
const PRICE_FLOOR = 30; // >= Rs 30 (no penny junk)
const TURNOVER_FLOOR = 1e7; // >= Rs 1 cr average daily turnover (liquidity)
const MAX_ROWS = 20; //   final N stored/shown, ranked by composite (see below)
// Golden-side candidate pool. We can't rank by composite_pct here (that lives in
// app, added during enrich), so we take a generous pool by volume, THEN re-rank
// the enriched pool by composite and keep MAX_ROWS. Why not cap by volume as the
// final rank: a 6749-event / 2.5yr backtest showed vol_x is INVERSELY related to
// forward return — the 10x+ spikes (which a vol_x-DESC cap keeps) were the worst
// bucket (T+20 mean +0.27%) while 3-5x names were best (+2.49%). Ranking the
// stored set by volume literally surfaced the worst performers first and, on
// busy days, dropped the better moderate-volume names. 60 comfortably exceeds a
// typical day's ignition count so the pool rarely truncates real candidates.
const CANDIDATE_POOL = 60;

type GoldenRow = {
  symbol: string;
  close: number;
  ret_pct: number;
  vol_x: number;
  new_high: boolean;
};

/**
 * Run the price screen over the latest golden bar and return raw ignitions
 * (already ranked by volume multiple, capped at MAX_ROWS). `snapDate` is the
 * date of that latest bar so the caller stamps rows consistently.
 */
async function screenGolden(): Promise<{ snapDate: string; rows: GoldenRow[] }> {
  const latest = await golden<{ d: string }[]>`
    SELECT max(date)::text AS d FROM golden.price_history_1d WHERE interval = '1d'
  `;
  const snapDate = latest[0]?.d;
  if (!snapDate) return { snapDate: "", rows: [] };

  // Window functions need a lookback runway; 120 days covers the 60-day high
  // and 50-day avg-volume windows with margin, cheaply.
  const rows = await golden<GoldenRow[]>`
    WITH r AS (
      SELECT symbol, date, close, volume, high,
             close / NULLIF(LAG(close) OVER (PARTITION BY symbol ORDER BY date), 0) - 1 AS ret1
      FROM golden.price_history_1d
      WHERE interval = '1d' AND date > (${snapDate}::date - 120)
    ),
    b AS (
      SELECT symbol, date, close, volume, ret1,
             AVG(volume) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 50 PRECEDING AND 1 PRECEDING) AS avg_vol50,
             MAX(high)   OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 60 PRECEDING AND 1 PRECEDING) AS hi60
      FROM r
    )
    SELECT replace(symbol, '.NS', '')                       AS symbol,
           close::float8                                     AS close,
           (ret1 * 100)::float8                              AS ret_pct,
           (volume / NULLIF(avg_vol50, 0))::float8           AS vol_x,
           (close > hi60)                                    AS new_high
    FROM b
    WHERE date = ${snapDate}::date
      AND ret1 >= ${RET_MIN}
      AND volume >= ${VOL_MULT} * avg_vol50
      AND close > hi60
      AND close >= ${PRICE_FLOOR}
      AND avg_vol50 * close >= ${TURNOVER_FLOOR}
    ORDER BY vol_x DESC
    LIMIT ${CANDIDATE_POOL}
  `;
  return { snapDate, rows };
}

/**
 * Enrich the golden hits with fundamental rank (panel cache) + latest catalyst
 * headline (app.news), merged in JS. Returns the full signal rows.
 */
async function enrich(snapDate: string, rows: GoldenRow[]): Promise<MomentumSignal[]> {
  if (rows.length === 0) return [];
  const symbols = rows.map((r) => r.symbol);

  const cache = await sql<
    {
      symbol: string;
      market_cap_cr: number | null;
      composite_pct: number | null;
      quality_pct: number | null;
      momentum_pct: number | null;
      sector: string | null;
      industry: string | null;
    }[]
  >`
    SELECT p.symbol,
           p.market_cap_cr::float8 AS market_cap_cr,
           p.composite_pct::float8 AS composite_pct,
           p.quality_pct::float8   AS quality_pct,
           p.momentum_pct::float8  AS momentum_pct,
           mc.name                 AS sector,
           c.name                  AS industry
    FROM app.cluster_stocks_panel_cache p
    LEFT JOIN app.cluster c       ON c.id = p.cluster_id
    LEFT JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    WHERE p.snapshot_date = (SELECT max(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND p.symbol = ANY(${symbols})
  `;
  const cacheBy = new Map(cache.map((c) => [c.symbol, c]));

  // Pull the recent headlines per symbol (within 3 days of the ignition), then
  // pick the most SUBSTANTIVE one in JS — preferring a real catalyst over a
  // circular "stock jumped X%" restatement. Ordered newest-first so ties break
  // to the freshest.
  const news = await sql<
    { symbol: string; title: string; url: string; source: string; published_at: string }[]
  >`
    SELECT ns.symbol, n.title, n.url, n.source, n.published_at::text AS published_at
    FROM app.news_stock ns
    JOIN app.news n ON n.id = ns.news_id
    WHERE ns.symbol = ANY(${symbols})
      AND n.published_at >= (${snapDate}::date - 3)
    ORDER BY ns.symbol, n.published_at DESC
  `;
  // First non-circular headline per symbol (newest-first); fall back to the
  // newest of any kind so the cell isn't left blank.
  const newsBy = new Map<string, (typeof news)[number]>();
  const newsFallback = new Map<string, (typeof news)[number]>();
  for (const x of news) {
    if (!newsFallback.has(x.symbol)) newsFallback.set(x.symbol, x);
    if (!newsBy.has(x.symbol) && !isCircularHeadline(x.title)) newsBy.set(x.symbol, x);
  }
  for (const [sym, x] of newsFallback) {
    if (!newsBy.has(sym)) newsBy.set(sym, x);
  }

  return rows.map((r) => {
    const c = cacheBy.get(r.symbol);
    const nw = newsBy.get(r.symbol);
    return {
      symbol: r.symbol,
      close: r.close,
      retPct: r.ret_pct,
      volX: r.vol_x,
      newHigh: r.new_high,
      marketCapCr: c?.market_cap_cr ?? null,
      compositePct: c?.composite_pct ?? null,
      qualityPct: c?.quality_pct ?? null,
      momentumPct: c?.momentum_pct ?? null,
      isScored: !!c,
      sector: c?.sector ?? null,
      industry: c?.industry ?? null,
      catalystTitle: nw?.title ?? null,
      catalystUrl: nw?.url ?? null,
      catalystSource: nw?.source ?? null,
      catalystAt: nw?.published_at ?? null,
    };
  });
}

/**
 * Compute today's signals end-to-end (screen + enrich). Used by the cron.
 *
 * Ranking: the golden screen returns a volume-ranked POOL; here we re-rank the
 * enriched pool by composite_pct (quality first, unscored last) and keep the top
 * MAX_ROWS. This replaces the old vol_x-DESC cap, which the backtest showed was
 * inverted — it surfaced exhaustion spikes and dropped better moderate-volume
 * names. Ties (and unscored names) fall back to vol_x so ordering stays stable.
 */
export async function computeMomentumSignals(): Promise<{ snapDate: string; signals: MomentumSignal[] }> {
  const { snapDate, rows } = await screenGolden();
  const enriched = await enrich(snapDate, rows);
  const signals = enriched
    .sort((a, b) => (b.compositePct ?? -1) - (a.compositePct ?? -1) || b.volX - a.volX)
    .slice(0, MAX_ROWS);
  return { snapDate, signals };
}

/** Persist a day's signals — REPLACE that day's rows (idempotent re-run). */
export async function persistMomentumSignals(snapDate: string, signals: MomentumSignal[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM app.momentum_signal WHERE snap_date = ${snapDate}`;
    for (const s of signals) {
      await tx`
        INSERT INTO app.momentum_signal
          (snap_date, symbol, close, ret_pct, vol_x, new_high,
           market_cap_cr, composite_pct, quality_pct, momentum_pct, is_scored,
           catalyst_title, catalyst_url, catalyst_source, catalyst_at)
        VALUES
          (${snapDate}, ${s.symbol}, ${s.close}, ${s.retPct}, ${s.volX}, ${s.newHigh},
           ${s.marketCapCr}, ${s.compositePct}, ${s.qualityPct}, ${s.momentumPct}, ${s.isScored},
           ${s.catalystTitle}, ${s.catalystUrl}, ${s.catalystSource}, ${s.catalystAt})
      `;
    }
  });
}

/**
 * Read a stored snapshot for the /tools/scanner page. Pass `targetDate` to
 * browse history (the scanner keeps ~1 year of daily snapshots); omit it for
 * the latest. Returns the list of available dates so the page can render a
 * date-picker. An invalid/absent targetDate falls back to the latest.
 */
export async function loadLatestMomentum(
  targetDate?: string | null,
): Promise<{ snapDate: string | null; signals: MomentumSignal[]; dates: string[] }> {
  const dateRows = await sql<{ d: string }[]>`
    SELECT DISTINCT snap_date::text AS d
    FROM app.momentum_signal
    WHERE snap_date >= (CURRENT_DATE - 400)
    ORDER BY d DESC
  `;
  const dates = dateRows.map((r) => r.d);
  const snapDate = targetDate && dates.includes(targetDate) ? targetDate : dates[0] ?? null;
  if (!snapDate) return { snapDate: null, signals: [], dates };

  const rows = await sql<
    (Omit<MomentumSignal, "newHigh" | "isScored"> & { new_high: boolean; is_scored: boolean })[]
  >`
    SELECT symbol,
           close::float8         AS close,
           ret_pct::float8       AS "retPct",
           vol_x::float8         AS "volX",
           new_high,
           market_cap_cr::float8 AS "marketCapCr",
           composite_pct::float8 AS "compositePct",
           quality_pct::float8   AS "qualityPct",
           momentum_pct::float8  AS "momentumPct",
           is_scored,
           catalyst_title        AS "catalystTitle",
           catalyst_url          AS "catalystUrl",
           catalyst_source       AS "catalystSource",
           catalyst_at::text     AS "catalystAt"
    FROM app.momentum_signal
    WHERE snap_date = ${snapDate}
    -- Quality-first: composite_pct DESC (unscored last), vol_x as tiebreak.
    -- Ranking by vol_x is inverted vs forward return (see momentum.ts header),
    -- so it must not be the primary sort. Applies to already-stored rows too,
    -- so the page reorders immediately without waiting for a cron recompute.
    ORDER BY composite_pct DESC NULLS LAST, vol_x DESC
  `;

  // Sector / peer-group aren't stored on the signal cache; join the scoring
  // panel at read time so it works without a schema migration or cron recompute.
  const clsSymbols = rows.map((r) => r.symbol);
  const cls = clsSymbols.length
    ? await sql<{ symbol: string; sector: string | null; industry: string | null }[]>`
        SELECT p.symbol, mc.name AS sector, c.name AS industry
        FROM app.cluster_stocks_panel_cache p
        LEFT JOIN app.cluster c       ON c.id = p.cluster_id
        LEFT JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
        WHERE p.snapshot_date = (SELECT max(snapshot_date) FROM app.cluster_stocks_panel_cache)
          AND p.symbol = ANY(${clsSymbols})
      `
    : [];
  const clsBy = new Map(cls.map((x) => [x.symbol, x]));

  const signals: MomentumSignal[] = rows.map((r) => ({
    symbol: r.symbol,
    close: r.close,
    retPct: r.retPct,
    volX: r.volX,
    newHigh: r.new_high,
    marketCapCr: r.marketCapCr,
    compositePct: r.compositePct,
    qualityPct: r.qualityPct,
    momentumPct: r.momentumPct,
    isScored: r.is_scored,
    sector: clsBy.get(r.symbol)?.sector ?? null,
    industry: clsBy.get(r.symbol)?.industry ?? null,
    catalystTitle: r.catalystTitle,
    catalystUrl: r.catalystUrl,
    catalystSource: r.catalystSource,
    catalystAt: r.catalystAt,
  }));
  return { snapDate, signals, dates };
}

/** Prune snapshots older than `keepDays` so the history table stays bounded. */
export async function pruneMomentumHistory(keepDays = 400): Promise<void> {
  await sql`DELETE FROM app.momentum_signal WHERE snap_date < (CURRENT_DATE - ${keepDays}::int)`;
}
