import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { loadConcallsForSymbol } from "@/lib/concall";
import {
  ConcallSummaryClient,
  type CompanyQuarterRow,
  type ConcallArchiveFiling,
  type ConcallStockHeader,
} from "./ConcallSummaryClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol: raw } = await params;
  const sym = decodeURIComponent(raw).toUpperCase();
  return {
    title: `${sym} Concall Summary & Highlights — EquityRoots`,
    description: `Quote-verified earnings call highlights, management guidance, delivered actuals, and analyst Q&A for ${sym}.`,
  };
}

export default async function ConcallSymbolPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { symbol: raw } = await params;
  const sp = searchParams ? await searchParams : undefined;
  let sym = raw;
  try {
    sym = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  const upper = sym.toUpperCase();

  const [stockRows, concalls, quarterRows, filingRows] = await Promise.all([
    sql<
      {
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
      }[]
    >`
      SELECT u.symbol,
             COALESCE(u.company_name, u.symbol) AS company_name,
             COALESCE(u.sector, 'General') AS sector,
             COALESCE(u.industry, 'General') AS industry,
             u.market_cap_category,
             sm.current_price::float8 AS ltp,
             sm.market_cap_cr::float8 AS market_cap_cr,
             sc.composite_pct::float8 AS composite_pct,
             sc.quality_pct::float8 AS quality_pct,
             sc.valuation_pct::float8 AS valuation_pct,
             sc.momentum_pct::float8 AS momentum_pct
        FROM app.universe u
        LEFT JOIN app.screener_meta sm ON sm.symbol = u.symbol
        LEFT JOIN app.scores sc ON sc.symbol = u.symbol
             AND sc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
       WHERE u.symbol = ${upper}
       LIMIT 1
    `.catch(() => []),

    loadConcallsForSymbol(upper, 8),

    sql<
      {
        period_end: string;
        sales: number | null;
        operating_profit: number | null;
        net_profit: number | null;
      }[]
    >`
      SELECT period_end::text AS period_end,
             sales::float8 AS sales,
             operating_profit::float8 AS operating_profit,
             net_profit::float8 AS net_profit
        FROM app.fundamentals_quarterly
       WHERE symbol = ${upper}
         AND (sales IS NOT NULL OR net_profit IS NOT NULL)
       ORDER BY period_end DESC
       LIMIT 8
    `.catch(() => []),

    sql<
      {
        id: string;
        title: string;
        published_at: string;
        pdf_url: string | null;
      }[]
    >`
      SELECT id,
             COALESCE(headline, title) AS title,
             published_at::text AS published_at,
             pdf_url
        FROM app.announcement
       WHERE symbol = ${upper}
         AND pdf_url IS NOT NULL
         AND (title ~* 'transcript|earnings call|concall|conference call|audio|investor presentation'
              OR headline ~* 'transcript|earnings call|concall|conference call|audio recording|investor presentation')
       ORDER BY published_at DESC
       LIMIT 25
    `.catch(() => []),
  ]);

  if (stockRows.length === 0) {
    notFound();
  }

  const s = stockRows[0];
  const currQ = quarterRows[0];
  const yagoQ = quarterRows[4];
  const salesYoy =
    currQ?.sales != null && yagoQ?.sales != null && yagoQ.sales > 0
      ? Math.round(((currQ.sales - yagoQ.sales) / yagoQ.sales) * 1000) / 10
      : null;
  const npYoy =
    currQ?.net_profit != null && yagoQ?.net_profit != null && yagoQ.net_profit > 0
      ? Math.round(((currQ.net_profit - yagoQ.net_profit) / yagoQ.net_profit) * 1000) / 10
      : null;
  const opmPct =
    currQ?.sales != null && currQ.sales > 0 && currQ.operating_profit != null
      ? Math.round((currQ.operating_profit / currQ.sales) * 1000) / 10
      : null;

  const header: ConcallStockHeader = {
    symbol: s.symbol,
    companyName: s.company_name.replace(/\.NS$/i, ""),
    sector: s.sector,
    industry: s.industry,
    marketCapCategory: s.market_cap_category,
    ltp: s.ltp,
    marketCapCr: s.market_cap_cr,
    compositePct: s.composite_pct,
    qualityPct: s.quality_pct,
    valuationPct: s.valuation_pct,
    momentumPct: s.momentum_pct,
    salesYoy,
    npYoy,
    opmPct,
  };

  const quarters: CompanyQuarterRow[] = quarterRows.slice(0, 5).map((q) => ({
    periodEnd: q.period_end,
    sales: q.sales,
    operatingProfit: q.operating_profit,
    netProfit: q.net_profit,
    opmPct:
      q.sales != null && q.sales > 0 && q.operating_profit != null
        ? Math.round((q.operating_profit / q.sales) * 1000) / 10
        : null,
  }));

  const filings: ConcallArchiveFiling[] = filingRows.map((f) => ({
    id: f.id,
    title: f.title,
    publishedAt: f.published_at,
    pdfUrl: f.pdf_url,
    kind: /audio|video|recording/i.test(f.title)
      ? "audio"
      : /presentation/i.test(f.title)
        ? "presentation"
        : "transcript",
  }));

  const initialTab =
    sp?.tab === "guidance" || sp?.tab === "qa" || sp?.tab === "filings"
      ? sp.tab
      : "highlights";

  return (
    <div className="mx-auto max-w-[1200px] px-4 md:px-6 py-6 md:py-8">
      <ConcallSummaryClient
        stock={header}
        concalls={concalls}
        quarters={quarters}
        filings={filings}
        initialTab={initialTab}
      />
    </div>
  );
}
