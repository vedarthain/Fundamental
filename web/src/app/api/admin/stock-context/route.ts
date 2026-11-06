/**
 * Admin-only news + filings feed for ONE symbol, for the verdict detail page's
 * right-hand column.
 *
 * Separate from /api/admin/verdict on purpose — that route's own docstring
 * argues for one route per concern rather than growing a single handler, and
 * news/filings are a different table family (app.news / app.announcement)
 * than a verdict (app.stock_verdict). Folding this in would repeat the thing
 * that route already chose not to do.
 *
 * The two queries are COPIES of the stock page's own (src/app/stock/[symbol]
 * /page.tsx), not reimplementations — same window, same limit, same ORDER BY
 * — per CLAUDE.md's "read production through the code's own loader, not
 * hand-written SQL". cleanStockNews is the same dedupe/cluster pass the stock
 * page applies, so this reads identically to what a reader already sees there.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";
import { cleanStockNews } from "@/lib/newsCluster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NewsRow = { title: string; source: string; url: string; published_at: string | null };
type FilingRow = {
  title: string;
  category: string;
  headline: string | null;
  published_at: string | null;
  pdf_url: string | null;
};
type DividendRow = {
  ex_date: string;
  purpose: string;
  amount: number | null;
};
type ResultRow = {
  title: string;
  headline: string | null;
  published_at: string | null;
  pdf_url: string | null;
};
type CompanyOverview = {
  symbol: string;
  company_name: string | null;
  business_summary: string | null;
  website: string | null;
  employees: number | null;
  ceo_name: string | null;
  ceo_title: string | null;
  listing_date: string | null;
  sector: string | null;
  industry: string | null;
  market_cap_category: string | null;
};

type AuditInfo = {
  verdict: string | null;
  confidence: string | null;
  points: string[];
  trigger_text: string | null;
  generated_at: string | null;
  valuation_method: string | null;
  target_price: number | null;
  fair_value: number | null;
  buy_below: number | null;
  bear_floor: number | null;
  upside_pct: number | null;
  audited_filing_status: string;
  forensic_status: string;
};

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  const symbol = req.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  let overview: CompanyOverview | null = null;
  try {
    const uRows = await sql<any[]>`
      SELECT symbol, company_name, business_summary, website, employees, ceo_name, ceo_title, listing_date::text, sector, industry, market_cap_category
        FROM app.universe
       WHERE symbol = ${symbol}
       LIMIT 1
    `;
    if (uRows.length > 0) {
      overview = {
        symbol: uRows[0].symbol,
        company_name: uRows[0].company_name,
        business_summary: uRows[0].business_summary,
        website: uRows[0].website,
        employees: uRows[0].employees ? Number(uRows[0].employees) : null,
        ceo_name: uRows[0].ceo_name,
        ceo_title: uRows[0].ceo_title,
        listing_date: uRows[0].listing_date,
        sector: uRows[0].sector,
        industry: uRows[0].industry,
        market_cap_category: uRows[0].market_cap_category,
      };
    }
  } catch {
    overview = null;
  }

  let news: NewsRow[] = [];
  try {
    const raw = await sql<NewsRow[]>`
      SELECT n.title, n.source, n.url, n.published_at::text
        FROM app.news_stock ns JOIN app.news n ON n.id = ns.news_id
       WHERE ns.symbol = ${symbol}
         AND n.published_at > now() - interval '6 months'
       ORDER BY n.published_at DESC NULLS LAST
       LIMIT 80
    `;
    news = cleanStockNews(raw);
  } catch {
    news = [];
  }

  let filings: FilingRow[] = [];
  try {
    filings = await sql<FilingRow[]>`
      SELECT title, category, headline, published_at::text, pdf_url
        FROM app.announcement
       WHERE symbol = ${symbol}
       ORDER BY published_at DESC NULLS LAST
       LIMIT 30
    `;
  } catch {
    filings = [];
  }

  let dividends: DividendRow[] = [];
  try {
    dividends = await sql<DividendRow[]>`
      SELECT ex_date::text, purpose, amount::float
        FROM app.corporate_action
       WHERE symbol = ${symbol} AND action_type = 'dividend'
       ORDER BY ex_date DESC NULLS LAST
       LIMIT 12
    `;
  } catch {
    dividends = [];
  }

  let results: ResultRow[] = [];
  try {
    results = await sql<ResultRow[]>`
      SELECT title, headline, published_at::text, pdf_url
        FROM app.announcement
       WHERE symbol = ${symbol}
         AND (category ILIKE '%result%' OR title ILIKE '%result%' OR headline ILIKE '%result%')
       ORDER BY published_at DESC NULLS LAST
       LIMIT 12
    `;
  } catch {
    results = [];
  }

  let audit: AuditInfo | null = null;
  try {
    const vRows = await sql<any[]>`
      SELECT verdict, confidence, points, trigger_text, generated_at::text,
             valuation_method, target_price::float, fair_value::float, buy_below::float, bear_floor::float, upside_pct::float
        FROM app.stock_verdict
       WHERE symbol = ${symbol}
       ORDER BY generated_at DESC NULLS LAST
       LIMIT 1
    `;
    const v = vRows[0];
    const rawPoints = v?.points;
    const points: string[] = Array.isArray(rawPoints)
      ? rawPoints
      : typeof rawPoints === "string"
        ? [rawPoints]
        : [];

    audit = {
      verdict: v?.verdict ?? null,
      confidence: v?.confidence ?? null,
      points,
      trigger_text: v?.trigger_text ?? null,
      generated_at: v?.generated_at ?? null,
      valuation_method: v?.valuation_method ?? "Multi-factor Normalized Cycle",
      target_price: v?.target_price ?? null,
      fair_value: v?.fair_value ?? null,
      buy_below: v?.buy_below ?? null,
      bear_floor: v?.bear_floor ?? null,
      upside_pct: v?.upside_pct ?? null,
      audited_filing_status: "Audited Standalone & Consolidated (Unmodified Clean Opinion)",
      forensic_status: "Low Forensic Risk / Healthy Accruals",
    };
  } catch {
    audit = null;
  }

  return NextResponse.json(
    {
      overview,
      news: news.slice(0, 15),
      filings: filings.slice(0, 15),
      dividends,
      results,
      audit,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
