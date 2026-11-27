import type { Metadata } from "next";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import type {
  ConcallHighlightItem,
  ConcallNumberItem,
  ConcallQaItem,
} from "@/lib/concallTypes";
import {
  ConcallHubClient,
  type ConcallFilingRow,
  type ConcallHubItem,
} from "./ConcallHubClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Concall Intelligence — EquityRoots",
  description:
    "Quote-verified earnings call digests, cross-market keyword search, management tone & guidance vs actuals tracker for NSE companies.",
};

function asJsonArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function loadConcallHubData(): Promise<{
  digests: ConcallHubItem[];
  filings: ConcallFilingRow[];
  totalArchiveCount: number;
}> {
  const [digestRows, filingRows, countRows] = await Promise.all([
    sql<
      {
        id: number;
        symbol: string;
        company_name: string;
        sector: string;
        industry: string;
        market_cap_category: string | null;
        ltp: number | null;
        market_cap_cr: number | null;
        composite_pct: number | null;
        quality_pct: number | null;
        valuation_pct: number | null;
        momentum_pct: number | null;
        sales_yoy: number | null;
        np_yoy: number | null;
        quarter_label: string | null;
        published_at: string;
        pdf_url: string | null;
        tone: "Optimistic" | "Neutral" | "Cautious";
        tone_rationale: string | null;
        numbers_mentioned: unknown;
        highlights: unknown;
        qa_highlights: unknown;
        verified_ratio: number;
      }[]
    >`
      WITH ranked_q AS (
        SELECT symbol, sales, net_profit,
               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY period_end DESC) AS rn
          FROM app.fundamentals_quarterly
         WHERE sales IS NOT NULL OR net_profit IS NOT NULL
      ),
      q_yoy AS (
        SELECT c.symbol,
               CASE WHEN y.sales IS NOT NULL AND y.sales > 0
                    THEN ROUND(((c.sales - y.sales) / y.sales * 100)::numeric, 1)::float8
                    ELSE NULL END AS sales_yoy,
               CASE WHEN y.net_profit IS NOT NULL AND y.net_profit > 0
                    THEN ROUND(((c.net_profit - y.net_profit) / y.net_profit * 100)::numeric, 1)::float8
                    ELSE NULL END AS np_yoy
          FROM ranked_q c
          LEFT JOIN ranked_q y ON y.symbol = c.symbol AND y.rn = 5
         WHERE c.rn = 1
      )
      SELECT cs.id::int AS id,
             cs.symbol,
             COALESCE(u.company_name, cs.symbol) AS company_name,
             COALESCE(u.sector, 'General') AS sector,
             COALESCE(u.industry, 'General') AS industry,
             u.market_cap_category,
             sm.current_price::float8 AS ltp,
             sm.market_cap_cr::float8 AS market_cap_cr,
             sc.composite_pct::float8 AS composite_pct,
             sc.quality_pct::float8 AS quality_pct,
             sc.valuation_pct::float8 AS valuation_pct,
             sc.momentum_pct::float8 AS momentum_pct,
             qy.sales_yoy,
             qy.np_yoy,
             cs.quarter_label,
             cs.published_at::text AS published_at,
             cs.pdf_url,
             cs.tone,
             cs.tone_rationale,
             cs.numbers_mentioned,
             cs.highlights,
             cs.qa_highlights,
             cs.verified_ratio::float8 AS verified_ratio
        FROM app.concall_summary cs
        JOIN app.universe u ON u.symbol = cs.symbol
        LEFT JOIN app.screener_meta sm ON sm.symbol = cs.symbol
        LEFT JOIN app.scores sc ON sc.symbol = cs.symbol
             AND sc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
        LEFT JOIN q_yoy qy ON qy.symbol = cs.symbol
       ORDER BY cs.published_at DESC, sm.market_cap_cr DESC NULLS LAST
       LIMIT 300
    `.catch(() => []),

    sql<
      {
        id: string;
        symbol: string;
        company_name: string;
        sector: string;
        title: string;
        published_at: string;
        pdf_url: string | null;
        has_digest: boolean;
      }[]
    >`
      SELECT a.id,
             a.symbol,
             COALESCE(u.company_name, a.symbol) AS company_name,
             COALESCE(u.sector, 'General') AS sector,
             COALESCE(a.headline, a.title) AS title,
             a.published_at::text AS published_at,
             a.pdf_url,
             EXISTS (
               SELECT 1 FROM app.concall_summary cs
                WHERE cs.announcement_id = a.id OR cs.symbol = a.symbol
             ) AS has_digest
        FROM app.announcement a
        JOIN app.universe u ON u.symbol = a.symbol AND u.is_active
       WHERE a.pdf_url IS NOT NULL
         AND (a.title ~* 'transcript|earnings call|concall|conference call|audio recording'
              OR a.headline ~* 'transcript of.*(?:call|meet)|audio recording.*(?:call|meet)')
       ORDER BY a.published_at DESC
       LIMIT 120
    `.catch(() => []),

    sql<{ cnt: number }[]>`
      SELECT count(*)::int AS cnt
        FROM app.announcement
       WHERE pdf_url IS NOT NULL
         AND (title ~* 'transcript|earnings call|concall|conference call'
              OR headline ~* 'transcript|earnings call|concall|conference call')
    `.catch(() => [{ cnt: 0 }]),
  ]);

  const digests: ConcallHubItem[] = digestRows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    companyName: r.company_name.replace(/\.NS$/i, ""),
    sector: r.sector,
    industry: r.industry,
    marketCapCategory: r.market_cap_category,
    ltp: r.ltp,
    marketCapCr: r.market_cap_cr,
    compositePct: r.composite_pct,
    qualityPct: r.quality_pct,
    valuationPct: r.valuation_pct,
    momentumPct: r.momentum_pct,
    salesYoy: r.sales_yoy,
    npYoy: r.np_yoy,
    quarterLabel: r.quarter_label,
    publishedAt: r.published_at,
    pdfUrl: r.pdf_url,
    tone: r.tone,
    toneRationale: r.tone_rationale,
    numbersMentioned: asJsonArray<ConcallNumberItem>(r.numbers_mentioned),
    highlights: asJsonArray<ConcallHighlightItem>(r.highlights),
    qaHighlights: asJsonArray<ConcallQaItem>(r.qa_highlights),
    verifiedRatio: r.verified_ratio ?? 1,
  }));

  const filings: ConcallFilingRow[] = filingRows.map((f) => ({
    id: f.id,
    symbol: f.symbol,
    companyName: f.company_name.replace(/\.NS$/i, ""),
    sector: f.sector,
    title: f.title,
    publishedAt: f.published_at,
    pdfUrl: f.pdf_url,
    hasDigest: f.has_digest,
  }));

  return {
    digests,
    filings,
    totalArchiveCount: countRows[0]?.cnt ?? 0,
  };
}

export default async function ConcallPage() {
  const [session, hubData] = await Promise.all([
    getSession(),
    loadConcallHubData(),
  ]);

  let mySymbols: string[] = [];
  if (session) {
    const rows = await sql<{ symbol: string }[]>`
      SELECT DISTINCT symbol FROM app.portfolio_holding
       WHERE user_id = ${session.userId} AND symbol IS NOT NULL AND quantity > 0
      UNION
      SELECT DISTINCT symbol FROM app.user_watchlist
       WHERE user_id = ${session.userId}
    `.catch(() => []);
    mySymbols = rows.map((r) => r.symbol.toUpperCase());
  }

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6 py-6 md:py-8">
      <ConcallHubClient
        digests={hubData.digests}
        filings={hubData.filings}
        totalArchiveCount={hubData.totalArchiveCount}
        mySymbols={mySymbols}
        signedIn={session !== null}
      />
    </div>
  );
}
