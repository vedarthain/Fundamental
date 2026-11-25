import "server-only";
import { unstable_cache } from "next/cache";
import { sql, golden } from "@/lib/db";

const FILING_NOISE_RE =
  "(trading window|newspaper|(analyst|investor)\\s.{0,25}(call|meet|conference|presentation|interaction|day)" +
  "|compliance certificate|certificate under reg|book closure|record date" +
  "|loss of .{0,20}certificate|duplicate .{0,20}certificate|change of address|change in registrar" +
  "|postal ballot|scrutinizer|esop|esps" +
  "|allotment of (non.?convertible|ncd|debenture|commercial paper|warrant)" +
  "|forfeiture|sub.?division|reconciliation of share" +
  "|secretarial compliance|compliances?.?reg|reg\\.?\\s?24" +
  "|statement of deviation|transcript|earnings? call|conference call" +
  "|determination of materiality|materiality of (information|an? event)" +
  "|regulation 29|substantial acquisition of shares|regulation 31a|reclassification" +
  "|share based employee benefit|esos|sweat equity" +
  "|large corporate|initial disclosure|format of .{0,15}disclosure" +
  "|prohibition of insider|insider trading|regulation 7.2" +
  "|regulation 5[12]|regulation 3[36]|audited financial result|unmodified opinion" +
  "|weblink|letters? to (share|member)|manager to the open offer|post.?offer" +
  "|encumbrance|levy of fine|fines? imposed|waiver of fine|imposition of fine" +
  "|deviation or variation|statement o[fn] deviation|regulation 32|penalty (paid|imposed|levied))";

const FILING_NOISE_JS = new RegExp(FILING_NOISE_RE, "i");
const REG_CITATION_RE =
  /(?:announcement(?:\s+of)?\s+under|intimation\s+under|disclosure\s+under|update\s+on\s+disclosure\s+under)?\s*(?:regulations?|reg\.?)\s*30\b(?:\s*of\s*(?:the\s*)?sebi)?\s*(?:\(listing obligations[^)]*\))?\s*(?:regulations?,?\s*\d{4})?\s*(?:\(lodr\))?/gi;
const RELEASE_WRAP_RE = /^(press\s+)?release\s*[-:]\s*/i;
const HEADLINE_FILLER_RE =
  /^(enclosed|please (find|refer|note)|kindly|we (are pleased|enclose|wish|hereby|submit)|find enclosed|with reference|pursuant to|in (continuation|compliance|terms)|this is to inform|attached|further to|refer)\b/i;
const HEADLINE_BOILER_RE =
  /(regulation 30 of|intimation under regulation|sebi \(listing|listing obligations and disclosure|disclosure of material event)/i;

function normaliseFilingText(s: string): string {
  let out = s
    .replace(/<[^>]+>/g, " ")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^["'\s-]+|["'\s]+$/g, "")
    .trim();
  if (out.length > 0 && !/[a-z]/.test(out)) {
    out = out.replace(/([A-Z])([A-Z]+)/g, (_, a, b) => a + b.toLowerCase());
  }
  return out;
}

function stripRegCitation(s: string): string {
  return (
    s
      .split(REG_CITATION_RE)
      .map((p) => p.replace(/^[\s\-:_.|]+|[\s\-:_.|]+$/g, "").trim())
      .filter(
        (p) =>
          p.length > 0 &&
          !/^(of|the|under|sebi|disclosure|intimation|announcement|update(\s+on)?|regulations?,?\s*\d{4}|listing obligations.*)$/i.test(
            p,
          ),
      )
      .sort((a, b) => b.length - a.length)[0] || ""
  );
}

function cleanFilingTitle(title: string | null, headline: string | null): string | null {
  const t0 = (title || "").trim();
  const h0 = (headline || "").trim();
  if (!t0 && !h0) return null;

  if (/\b(?:regulations?|reg\.?)\s*30\b/i.test(t0)) {
    const h = normaliseFilingText(h0);
    if (h.length >= 15 && !HEADLINE_FILLER_RE.test(h) && !HEADLINE_BOILER_RE.test(h)) {
      return FILING_NOISE_JS.test(h) ? null : h;
    }
    const stripped = normaliseFilingText(stripRegCitation(t0));
    if (stripped.length >= 8) return FILING_NOISE_JS.test(stripped) ? null : stripped;
  }

  let base = t0 || h0;
  base = base.replace(RELEASE_WRAP_RE, "");
  base = stripRegCitation(base) || base;
  const cleaned = normaliseFilingText(base);
  if (cleaned.length < 4) return null;
  return FILING_NOISE_JS.test(cleaned) ? null : cleaned;
}

type Row = {
  symbol: string;
  company_name: string | null;
  industry_id: string;
  industry_name: string;
  sector_id: string;
  sector_name: string;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  composite_pct: number | null;
  peer_rank: number | null;
  peer_count: number | null;
  is_nifty50: boolean;
  is_nifty100: boolean;
  is_nifty200: boolean;
  is_nifty500: boolean;
  ret_1m_rel: number | null;
  ret_3m_rel: number | null;
  ret_6m_rel: number | null;
  ret_12m_rel: number | null;
  pct_above_200ema: number | null;
  ema_stack_bull: boolean | null;
  pe_ttm: number | null;
  pb: number | null;
  np_cagr_5y: number | null;
  rev_cagr_5y: number | null;
  roe_3y: number | null;
  np_yoy_q: number | null;
  listing_date: string | null;
  first_bar_date: string | null;
  years_of_data: number | null;
};

type HistPrices = {
  symbol: string;
  price_1m_ago: number | null;
  price_3m_ago: number | null;
  price_6m_ago: number | null;
  price_1y_ago: number | null;
};

type RecoverySignals = {
  symbol: string;
  above_200sma: boolean | null;
  off_52w_low_pct: number | null;
  accum_ratio_20d: number | null;
};

type LatestFiling = {
  symbol: string;
  filing_title: string | null;
  filing_headline: string | null;
  filing_category: string | null;
  filing_date: string | null;
  filing_url: string | null;
};

type NiftyReturns = {
  ret_1m: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  ret_1y: number | null;
};

type BenchmarkRow = NiftyReturns & { index_code: string };

async function computeOpportunities() {
  // 1. Fetch qualifying universe (~900 stocks with Q>=30 & V>=30) + NIFTY benchmarks in parallel
  const [rows, niftyRows] = await Promise.all([
    sql<Row[]>`
      WITH ranked AS (
        SELECT
          s.symbol,
          s.cluster_id,
          s.maturity_tier,
          s.quality_pct,
          s.valuation_pct,
          s.momentum_pct,
          s.composite_pct,
          RANK() OVER (
            PARTITION BY s.cluster_id, s.maturity_tier
            ORDER BY s.composite_pct DESC NULLS LAST
          )::int AS peer_rank,
          COUNT(*) OVER (
            PARTITION BY s.cluster_id, s.maturity_tier
          )::int AS peer_count
        FROM app.scores s
        WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
          AND COALESCE(s.quality_pct,   0) >= 30
          AND COALESCE(s.valuation_pct, 0) >= 30
      )
      SELECT
        r.symbol,
        u.company_name,
        r.cluster_id                                        AS industry_id,
        c.name                                              AS industry_name,
        mc.id                                               AS sector_id,
        mc.name                                             AS sector_name,
        r.maturity_tier,
        sm.market_cap_cr::float                             AS market_cap_cr,
        sm.current_price::float                             AS current_price,
        COALESCE(u.is_nifty50,  false)                      AS is_nifty50,
        (n100.symbol IS NOT NULL)                           AS is_nifty100,
        COALESCE(u.is_nifty200, false)                      AS is_nifty200,
        (n500.symbol IS NOT NULL)                           AS is_nifty500,
        r.quality_pct,
        r.valuation_pct,
        r.momentum_pct,
        r.composite_pct,
        r.peer_rank,
        r.peer_count,
        (m.cluster_metrics->>'ret_1m_rel')::float           AS ret_1m_rel,
        (m.cluster_metrics->>'ret_3m_rel')::float           AS ret_3m_rel,
        (m.cluster_metrics->>'ret_6m_rel')::float           AS ret_6m_rel,
        (m.cluster_metrics->>'ret_12m_rel')::float          AS ret_12m_rel,
        (m.cluster_metrics->>'pct_above_200ema_252d')::float AS pct_above_200ema,
        CASE (m.cluster_metrics->>'ema_stack_bull')
          WHEN '1' THEN true
          WHEN '1.0' THEN true
          ELSE false
        END                                                 AS ema_stack_bull,
        (m.cluster_metrics->>'pe_ttm')::float               AS pe_ttm,
        (m.cluster_metrics->>'pb')::float                   AS pb,
        (m.cluster_metrics->>'np_cagr_5y')::float           AS np_cagr_5y,
        (m.cluster_metrics->>'rev_cagr_5y')::float          AS rev_cagr_5y,
        COALESCE(
          (m.cluster_metrics->>'roe_3y')::float,
          (m.cluster_metrics->>'roce_3y')::float
        )                                                   AS roe_3y,
        (m.cluster_metrics->>'np_yoy_q')::float             AS np_yoy_q,
        u.listing_date::text                                AS listing_date,
        u.first_bar_date::text                              AS first_bar_date,
        u.years_of_data::float                              AS years_of_data
      FROM ranked r
      JOIN app.universe u ON u.symbol = r.symbol
      JOIN app.cluster c ON c.id = r.cluster_id
      JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
      LEFT JOIN app.screener_meta sm ON sm.symbol = r.symbol
      LEFT JOIN app.metrics_snapshot m
        ON m.symbol = r.symbol
       AND m.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      LEFT JOIN (
        SELECT symbol FROM app.index_constituent WHERE index_code = 'NIFTY100'
      ) n100 ON n100.symbol = r.symbol
      LEFT JOIN (
        SELECT symbol FROM app.index_constituent WHERE index_code = 'NIFTY500'
      ) n500 ON n500.symbol = r.symbol
      WHERE u.is_active
      ORDER BY r.quality_pct DESC NULLS LAST, r.valuation_pct DESC NULLS LAST
    `,
    sql<BenchmarkRow[]>`
      SELECT
        codes.index_code,
        CASE WHEN m.close > 0 THEN ((t.close - m.close) / m.close)::float END AS ret_1m,
        CASE WHEN q.close > 0 THEN ((t.close - q.close) / q.close)::float END AS ret_3m,
        CASE WHEN h.close > 0 THEN ((t.close - h.close) / h.close)::float END AS ret_6m,
        CASE WHEN y.close > 0 THEN ((t.close - y.close) / y.close)::float END AS ret_1y
      FROM (VALUES ('NIFTY50'), ('NIFTY100'), ('NIFTY500')) AS codes(index_code)
      CROSS JOIN LATERAL (
        SELECT close, date FROM app.market_index_history
        WHERE index_code = codes.index_code ORDER BY date DESC LIMIT 1
      ) t
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history
        WHERE index_code = codes.index_code AND date <= t.date - INTERVAL '30 days'
        ORDER BY date DESC LIMIT 1
      ) m ON TRUE
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history
        WHERE index_code = codes.index_code AND date <= t.date - INTERVAL '90 days'
        ORDER BY date DESC LIMIT 1
      ) q ON TRUE
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history
        WHERE index_code = codes.index_code AND date <= t.date - INTERVAL '180 days'
        ORDER BY date DESC LIMIT 1
      ) h ON TRUE
      LEFT JOIN LATERAL (
        SELECT close FROM app.market_index_history
        WHERE index_code = codes.index_code AND date <= t.date - INTERVAL '365 days'
        ORDER BY date DESC LIMIT 1
      ) y ON TRUE
    `,
  ]);

  const syms = rows.map((r) => r.symbol);
  const nsSyms = syms.map((s) => `${s}.NS`);

  // 2. Scope golden.price_history & announcement scans strictly to the ~900 qualifying symbols
  const [histRows, recoveryRows, filingRows] = syms.length
    ? await Promise.all([
        golden<HistPrices[]>`
          WITH latest AS (
            SELECT MAX(date) AS d FROM golden.price_history WHERE interval = '1d'
          ),
          d_1m AS (
            SELECT MAX(date) AS d FROM golden.price_history
            WHERE interval = '1d' AND date <= (SELECT d FROM latest) - INTERVAL '30 days'
          ),
          d_3m AS (
            SELECT MAX(date) AS d FROM golden.price_history
            WHERE interval = '1d' AND date <= (SELECT d FROM latest) - INTERVAL '90 days'
          ),
          d_6m AS (
            SELECT MAX(date) AS d FROM golden.price_history
            WHERE interval = '1d' AND date <= (SELECT d FROM latest) - INTERVAL '180 days'
          ),
          d_1y AS (
            SELECT MAX(date) AS d FROM golden.price_history
            WHERE interval = '1d' AND date <= (SELECT d FROM latest) - INTERVAL '365 days'
          )
          SELECT
            REPLACE(p.symbol, '.NS', '') AS symbol,
            MAX(p.adj_close) FILTER (WHERE p.date = (SELECT d FROM d_1m))::float AS price_1m_ago,
            MAX(p.adj_close) FILTER (WHERE p.date = (SELECT d FROM d_3m))::float AS price_3m_ago,
            MAX(p.adj_close) FILTER (WHERE p.date = (SELECT d FROM d_6m))::float AS price_6m_ago,
            MAX(p.adj_close) FILTER (WHERE p.date = (SELECT d FROM d_1y))::float AS price_1y_ago
          FROM golden.price_history p
          WHERE p.interval = '1d'
            AND p.date IN (
              (SELECT d FROM d_1m),
              (SELECT d FROM d_3m),
              (SELECT d FROM d_6m),
              (SELECT d FROM d_1y)
            )
            AND p.symbol = ANY(${nsSyms})
          GROUP BY REPLACE(p.symbol, '.NS', '')
        `,
        golden<RecoverySignals[]>`
          WITH ranked AS (
            SELECT
              REPLACE(symbol, '.NS', '') AS sym,
              adj_close,
              volume,
              close >= open              AS is_up_day,
              ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
            FROM golden.price_history
            WHERE interval = '1d'
              AND date >= CURRENT_DATE - INTERVAL '300 days'
              AND symbol = ANY(${nsSyms})
          ),
          agg AS (
            SELECT
              sym                                                          AS symbol,
              MAX(adj_close) FILTER (WHERE rn = 1)                        AS current_adj,
              AVG(adj_close) FILTER (WHERE rn <= 200)                     AS sma_200,
              MIN(adj_close) FILTER (WHERE rn <= 252)                     AS low_252d,
              SUM(volume)    FILTER (WHERE rn <= 20 AND is_up_day)        AS vol_up,
              SUM(volume)    FILTER (WHERE rn <= 20 AND NOT is_up_day)    AS vol_dn
            FROM ranked
            GROUP BY sym
          )
          SELECT
            symbol,
            (current_adj > sma_200)::boolean                              AS above_200sma,
            CASE WHEN low_252d > 0
                 THEN ((current_adj - low_252d) / low_252d)::float END    AS off_52w_low_pct,
            CASE WHEN vol_dn > 0
                 THEN (vol_up::float / vol_dn)::float END                 AS accum_ratio_20d
          FROM agg
          WHERE current_adj IS NOT NULL
        `,
        sql<LatestFiling[]>`
          SELECT DISTINCT ON (a.symbol)
            a.symbol,
            a.title              AS filing_title,
            a.headline           AS filing_headline,
            a.category           AS filing_category,
            a.published_at::text AS filing_date,
            a.pdf_url            AS filing_url
          FROM app.announcement a
          WHERE a.symbol = ANY(${syms})
            AND a.published_at > now() - interval '90 days'
            AND a.title !~* ${FILING_NOISE_RE}
            AND (a.headline IS NULL OR a.headline !~* ${FILING_NOISE_RE})
          ORDER BY a.symbol, a.published_at DESC NULLS LAST
        `.catch(() => [] as LatestFiling[]),
      ])
    : [[], [], []];

  const histMap = new Map(histRows.map((h) => [h.symbol, h]));
  const recoveryMap = new Map(recoveryRows.map((rv) => [rv.symbol, rv]));
  const filingMap = new Map(filingRows.map((f) => [f.symbol, f]));

  const rowsWithPrices = rows.map((r) => {
    const h = histMap.get(r.symbol);
    const rv = recoveryMap.get(r.symbol);
    const f = filingMap.get(r.symbol);
    return {
      ...r,
      price_1m_ago: h?.price_1m_ago ?? null,
      price_3m_ago: h?.price_3m_ago ?? null,
      price_6m_ago: h?.price_6m_ago ?? null,
      price_1y_ago: h?.price_1y_ago ?? null,
      above_200sma: rv?.above_200sma ?? null,
      off_52w_low_pct: rv?.off_52w_low_pct ?? null,
      accum_ratio_20d: rv?.accum_ratio_20d ?? null,
      filing_title: cleanFilingTitle(f?.filing_title ?? null, f?.filing_headline ?? null),
      filing_category: f?.filing_category ?? null,
      filing_date: f?.filing_date ?? null,
      filing_url: f?.filing_url ?? null,
    };
  });

  const nullReturns: NiftyReturns = { ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null };
  const benchmarkMap = new Map(niftyRows.map((r) => [r.index_code, r as NiftyReturns]));

  const benchmarks = {
    n50: benchmarkMap.get("NIFTY50") ?? nullReturns,
    n100: benchmarkMap.get("NIFTY100") ?? nullReturns,
    n200: benchmarkMap.get("NIFTY100") ?? nullReturns,
    n500: benchmarkMap.get("NIFTY500") ?? nullReturns,
  };

  return { rows: rowsWithPrices, benchmarks };
}

export const loadOpportunities = unstable_cache(
  computeOpportunities,
  ["opportunities:v2"],
  { revalidate: 3600, tags: ["panel-cache", "market"] },
);
