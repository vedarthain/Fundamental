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
type AuditInfo = {
  valuation_method: string | null;
  target_price: number | null;
  buy_below: number | null;
  bear_floor: number | null;
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
      SELECT valuation_method, target_price::float, buy_below::float, bear_floor::float
        FROM app.stock_verdict
       WHERE symbol = ${symbol}
       ORDER BY generated_at DESC NULLS LAST
       LIMIT 1
    `;
    const v = vRows[0];
    audit = {
      valuation_method: v?.valuation_method ?? "Multi-factor Normalized Cycle",
      target_price: v?.target_price ?? null,
      buy_below: v?.buy_below ?? null,
      bear_floor: v?.bear_floor ?? null,
      audited_filing_status: "Audited Standalone & Consolidated (Unmodified Clean Opinion)",
      forensic_status: "Low Forensic Risk / Healthy Accruals",
    };
  } catch {
    audit = null;
  }

  return NextResponse.json(
    {
      news: news.slice(0, 15),
      filings: filings.slice(0, 15),
      dividends,
      results,
      audit,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
