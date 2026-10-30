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

  return NextResponse.json(
    { news: news.slice(0, 20), filings },
    { headers: { "Cache-Control": "no-store" } },
  );
}
