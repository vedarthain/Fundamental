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
  type ConcallCalendarRow,
  type ConcallHubItem,
} from "./ConcallHubClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Concall Calendar — EquityRoots",
  description:
    "Datewise Concall Calendar with audio recordings, official BSE transcripts, quote-verified AI summaries, and Guidance vs Actuals.",
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
  latestCalls: ConcallCalendarRow[];
  upcomingCalls: ConcallCalendarRow[];
  digests: ConcallHubItem[];
  totalArchiveCount: number;
}> {
  const [digestRows, recentRows, upcomingRows, countRows] = await Promise.all([
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

    // Latest completed concall transcripts & audio recordings (date-stacked calendar feed)
    sql<
      {
        id: string;
        symbol: string;
        company_name: string;
        sector: string;
        market_cap_category: string | null;
        composite_pct: number | null;
        sales_yoy: number | null;
        np_yoy: number | null;
        title: string;
        published_at: string;
        pdf_url: string | null;
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
      SELECT a.id,
             a.symbol,
             COALESCE(u.company_name, a.symbol) AS company_name,
             COALESCE(u.sector, 'General') AS sector,
             u.market_cap_category,
             sc.composite_pct::float8 AS composite_pct,
             qy.sales_yoy,
             qy.np_yoy,
             COALESCE(a.headline, a.title) AS title,
             a.published_at::text AS published_at,
             a.pdf_url
        FROM app.announcement a
        JOIN app.universe u ON u.symbol = a.symbol AND u.is_active
        LEFT JOIN app.scores sc ON sc.symbol = a.symbol
             AND sc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
        LEFT JOIN q_yoy qy ON qy.symbol = a.symbol
       WHERE a.pdf_url IS NOT NULL
         AND (a.title ~* 'earnings call transcript|concall transcript|audio recording'
              OR a.headline ~* 'transcript of.*(?:call|discussion|meet)|audio recording.*(?:call|discussion|meet)')
         AND COALESCE(a.headline, a.title) !~* 'intimation of schedule|schedule of analyst'
       ORDER BY a.published_at DESC
       LIMIT 220
    `.catch(() => []),

    // Upcoming / Scheduled Concall & Analyst Meet intimations
    sql<
      {
        id: string;
        symbol: string;
        company_name: string;
        sector: string;
        market_cap_category: string | null;
        composite_pct: number | null;
        title: string;
        published_at: string;
        pdf_url: string | null;
      }[]
    >`
      SELECT a.id,
             a.symbol,
             COALESCE(u.company_name, a.symbol) AS company_name,
             COALESCE(u.sector, 'General') AS sector,
             u.market_cap_category,
             sc.composite_pct::float8 AS composite_pct,
             COALESCE(a.headline, a.title) AS title,
             a.published_at::text AS published_at,
             a.pdf_url
        FROM app.announcement a
        JOIN app.universe u ON u.symbol = a.symbol AND u.is_active
        LEFT JOIN app.scores sc ON sc.symbol = a.symbol
             AND sc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
       WHERE a.pdf_url IS NOT NULL
         AND (a.title ~* 'analyst.*investor meet|schedule.*conference call'
              OR a.headline ~* 'intimation of schedule.*(?:conference call|earnings call|analyst|investor)|earnings call.*scheduled')
         AND COALESCE(a.headline, a.title) !~* 'transcript|audio recording'
       ORDER BY a.published_at DESC
       LIMIT 100
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

  const latestDigestBySym = new Map<string, ConcallHubItem>();
  for (const d of digests) {
    if (!latestDigestBySym.has(d.symbol)) latestDigestBySym.set(d.symbol, d);
  }

  // Merge audio + transcript rows filed within 5 days for the same symbol into a single ConcallCalendarRow
  const mergedLatest: ConcallCalendarRow[] = [];
  for (const r of recentRows) {
    const isAudio = /audio|video|recording/i.test(r.title);
    const ts = new Date(r.published_at).getTime();
    const existing = mergedLatest.find(
      (m) =>
        m.symbol === r.symbol &&
        Math.abs(new Date(m.publishedAt).getTime() - ts) <= 5 * 86400 * 1000,
    );
    if (existing) {
      if (isAudio && !existing.audioUrl) existing.audioUrl = r.pdf_url;
      if (!isAudio && !existing.transcriptUrl) existing.transcriptUrl = r.pdf_url;
      continue;
    }
    const dig = latestDigestBySym.get(r.symbol);
    mergedLatest.push({
      id: r.id,
      symbol: r.symbol,
      companyName: r.company_name.replace(/\.NS$/i, ""),
      sector: r.sector,
      marketCapCategory: r.market_cap_category,
      compositePct: r.composite_pct,
      salesYoy: r.sales_yoy,
      npYoy: r.np_yoy,
      publishedAt: r.published_at,
      title: r.title,
      audioUrl: isAudio ? r.pdf_url : null,
      transcriptUrl: !isAudio ? r.pdf_url : dig?.pdfUrl ?? null,
      hasSummary: Boolean(dig),
      tone: dig?.tone ?? null,
      quarterLabel: dig?.quarterLabel ?? null,
      topTakeaway: dig?.highlights[0]?.point ?? null,
    });
  }

  // Ensure every AI-summarized stock appears in latestCalls even if older than the 220-row announcement window
  for (const d of latestDigestBySym.values()) {
    if (!mergedLatest.some((m) => m.symbol === d.symbol)) {
      mergedLatest.push({
        id: `dig-${d.id}`,
        symbol: d.symbol,
        companyName: d.companyName,
        sector: d.sector,
        marketCapCategory: d.marketCapCategory,
        compositePct: d.compositePct,
        salesYoy: d.salesYoy,
        npYoy: d.npYoy,
        publishedAt: d.publishedAt,
        title: `${d.quarterLabel ?? "Quarterly"} Earnings Call Transcript`,
        audioUrl: null,
        transcriptUrl: d.pdfUrl,
        hasSummary: true,
        tone: d.tone,
        quarterLabel: d.quarterLabel,
        topTakeaway: d.highlights[0]?.point ?? null,
      });
    }
  }

  mergedLatest.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  const seenUpcoming = new Set<string>();
  const upcomingCalls: ConcallCalendarRow[] = [];
  for (const u of upcomingRows) {
    const key = `${u.symbol}-${u.published_at.slice(0, 10)}`;
    if (seenUpcoming.has(key)) continue;
    seenUpcoming.add(key);
    const dig = latestDigestBySym.get(u.symbol);
    upcomingCalls.push({
      id: u.id,
      symbol: u.symbol,
      companyName: u.company_name.replace(/\.NS$/i, ""),
      sector: u.sector,
      marketCapCategory: u.market_cap_category,
      compositePct: u.composite_pct,
      salesYoy: null,
      npYoy: null,
      publishedAt: u.published_at,
      title: u.title,
      audioUrl: null,
      transcriptUrl: u.pdf_url,
      hasSummary: Boolean(dig),
      tone: dig?.tone ?? null,
      quarterLabel: dig?.quarterLabel ?? null,
      topTakeaway: null,
    });
  }

  return {
    latestCalls: mergedLatest,
    upcomingCalls,
    digests,
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
    <div className="mx-auto max-w-[1120px] px-4 md:px-6 py-6 md:py-8">
      <ConcallHubClient
        latestCalls={hubData.latestCalls}
        upcomingCalls={hubData.upcomingCalls}
        digests={hubData.digests}
        totalArchiveCount={hubData.totalArchiveCount}
        mySymbols={mySymbols}
        signedIn={session !== null}
      />
    </div>
  );
}
