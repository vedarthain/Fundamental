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
    "Datewise Concall Calendar with inline audio recordings, official BSE transcripts, quote-verified AI summaries, and Datewise Guidance vs Actuals.",
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
  const [digestRows, recentRows, upcomingRows, countRows, latestAudioBySymRows] =
    await Promise.all([
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
          period_label: string | null;
          sales_cr: number | null;
          sales_yoy: number | null;
          sales_qoq: number | null;
          ebitda_cr: number | null;
          ebitda_yoy: number | null;
          opm_pct: number | null;
          opm_yoy_bps: number | null;
          pat_cr: number | null;
          np_yoy: number | null;
          roce_3y: number | null;
          roe_3y: number | null;
          op_margin_3y: number | null;
          cfo_pat_3y: number | null;
          debt_equity: number | null;
          pe_ttm: number | null;
          ev_ebitda_ttm: number | null;
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
          SELECT symbol,
                 period_end,
                 sales::float8 AS sales,
                 operating_profit::float8 AS operating_profit,
                 net_profit::float8 AS net_profit,
                 CASE WHEN sales IS NOT NULL AND sales > 0 AND operating_profit IS NOT NULL
                      THEN (operating_profit / sales * 100)::float8
                      ELSE NULL END AS opm_pct,
                 ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY period_end DESC) AS rn
            FROM app.fundamentals_quarterly
           WHERE sales IS NOT NULL OR net_profit IS NOT NULL
        ),
        q_enriched AS (
          SELECT c.symbol,
                 TO_CHAR(c.period_end, 'Mon YYYY') AS period_label,
                 ROUND(c.sales::numeric, 1)::float8 AS sales_cr,
                 CASE WHEN y.sales IS NOT NULL AND y.sales > 0
                      THEN ROUND(((c.sales - y.sales) / y.sales * 100)::numeric, 1)::float8
                      ELSE NULL END AS sales_yoy,
                 CASE WHEN p.sales IS NOT NULL AND p.sales > 0
                      THEN ROUND(((c.sales - p.sales) / p.sales * 100)::numeric, 1)::float8
                      ELSE NULL END AS sales_qoq,
                 ROUND(c.operating_profit::numeric, 1)::float8 AS ebitda_cr,
                 CASE WHEN y.operating_profit IS NOT NULL AND y.operating_profit > 0
                      THEN ROUND(((c.operating_profit - y.operating_profit) / y.operating_profit * 100)::numeric, 1)::float8
                      ELSE NULL END AS ebitda_yoy,
                 ROUND(c.opm_pct::numeric, 1)::float8 AS opm_pct,
                 CASE WHEN c.opm_pct IS NOT NULL AND y.opm_pct IS NOT NULL
                      THEN ROUND(((c.opm_pct - y.opm_pct) * 100)::numeric, 0)::int
                      ELSE NULL END AS opm_yoy_bps,
                 ROUND(c.net_profit::numeric, 1)::float8 AS pat_cr,
                 CASE WHEN y.net_profit IS NOT NULL AND y.net_profit > 0
                      THEN ROUND(((c.net_profit - y.net_profit) / y.net_profit * 100)::numeric, 1)::float8
                      ELSE NULL END AS np_yoy
            FROM ranked_q c
            LEFT JOIN ranked_q p ON p.symbol = c.symbol AND p.rn = 2
            LEFT JOIN ranked_q y ON y.symbol = c.symbol AND y.rn = 5
           WHERE c.rn = 1
        ),
        latest_ms AS (
          SELECT DISTINCT ON (symbol)
                 symbol,
                 roce_3y::float8 AS roce_3y,
                 roe_3y::float8 AS roe_3y,
                 op_margin_3y::float8 AS op_margin_3y,
                 cfo_pat_3y::float8 AS cfo_pat_3y,
                 debt_equity::float8 AS debt_equity,
                 pe_ttm::float8 AS pe_ttm,
                 ev_ebitda_ttm::float8 AS ev_ebitda_ttm
            FROM app.metrics_snapshot
           ORDER BY symbol, snapshot_date DESC
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
               qe.period_label,
               qe.sales_cr,
               qe.sales_yoy,
               qe.sales_qoq,
               qe.ebitda_cr,
               qe.ebitda_yoy,
               qe.opm_pct,
               qe.opm_yoy_bps,
               qe.pat_cr,
               qe.np_yoy,
               ms.roce_3y,
               ms.roe_3y,
               ms.op_margin_3y,
               ms.cfo_pat_3y,
               ms.debt_equity,
               ms.pe_ttm,
               ms.ev_ebitda_ttm,
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
          LEFT JOIN q_enriched qe ON qe.symbol = cs.symbol
          LEFT JOIN latest_ms ms ON ms.symbol = cs.symbol
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
          sales_cr: number | null;
          sales_yoy: number | null;
          ebitda_yoy: number | null;
          opm_pct: number | null;
          opm_yoy_bps: number | null;
          np_yoy: number | null;
          roce_3y: number | null;
          pe_ttm: number | null;
          title: string;
          published_at: string;
          pdf_url: string | null;
          cached_media_url: string | null;
          cached_media_kind: "audio" | "video" | "youtube" | "webcast" | null;
        }[]
      >`
        WITH ranked_q AS (
          SELECT symbol,
                 sales::float8 AS sales,
                 operating_profit::float8 AS operating_profit,
                 net_profit::float8 AS net_profit,
                 CASE WHEN sales IS NOT NULL AND sales > 0 AND operating_profit IS NOT NULL
                      THEN (operating_profit / sales * 100)::float8
                      ELSE NULL END AS opm_pct,
                 ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY period_end DESC) AS rn
            FROM app.fundamentals_quarterly
           WHERE sales IS NOT NULL OR net_profit IS NOT NULL
        ),
        q_enriched AS (
          SELECT c.symbol,
                 ROUND(c.sales::numeric, 1)::float8 AS sales_cr,
                 CASE WHEN y.sales IS NOT NULL AND y.sales > 0
                      THEN ROUND(((c.sales - y.sales) / y.sales * 100)::numeric, 1)::float8
                      ELSE NULL END AS sales_yoy,
                 CASE WHEN y.operating_profit IS NOT NULL AND y.operating_profit > 0
                      THEN ROUND(((c.operating_profit - y.operating_profit) / y.operating_profit * 100)::numeric, 1)::float8
                      ELSE NULL END AS ebitda_yoy,
                 ROUND(c.opm_pct::numeric, 1)::float8 AS opm_pct,
                 CASE WHEN c.opm_pct IS NOT NULL AND y.opm_pct IS NOT NULL
                      THEN ROUND(((c.opm_pct - y.opm_pct) * 100)::numeric, 0)::int
                      ELSE NULL END AS opm_yoy_bps,
                 CASE WHEN y.net_profit IS NOT NULL AND y.net_profit > 0
                      THEN ROUND(((c.net_profit - y.net_profit) / y.net_profit * 100)::numeric, 1)::float8
                      ELSE NULL END AS np_yoy
            FROM ranked_q c
            LEFT JOIN ranked_q y ON y.symbol = c.symbol AND y.rn = 5
           WHERE c.rn = 1
        ),
        latest_ms AS (
          SELECT DISTINCT ON (symbol)
                 symbol,
                 roce_3y::float8 AS roce_3y,
                 pe_ttm::float8 AS pe_ttm
            FROM app.metrics_snapshot
           ORDER BY symbol, snapshot_date DESC
        )
        SELECT a.id,
               a.symbol,
               COALESCE(u.company_name, a.symbol) AS company_name,
               COALESCE(u.sector, 'General') AS sector,
               u.market_cap_category,
               sc.composite_pct::float8 AS composite_pct,
               qe.sales_cr,
               qe.sales_yoy,
               qe.ebitda_yoy,
               qe.opm_pct,
               qe.opm_yoy_bps,
               qe.np_yoy,
               ms.roce_3y,
               ms.pe_ttm,
               COALESCE(a.headline, a.title) AS title,
               a.published_at::text AS published_at,
               a.pdf_url,
               ac.media_url AS cached_media_url,
               ac.media_kind AS cached_media_kind
          FROM app.announcement a
          JOIN app.universe u ON u.symbol = a.symbol AND u.is_active
          LEFT JOIN app.scores sc ON sc.symbol = a.symbol
               AND sc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
          LEFT JOIN q_enriched qe ON qe.symbol = a.symbol
          LEFT JOIN latest_ms ms ON ms.symbol = a.symbol
          LEFT JOIN app.concall_audio_cache ac ON ac.announcement_id = a.id
         WHERE a.pdf_url IS NOT NULL
           AND (a.title ~* 'earnings call transcript|concall transcript|audio recording|video recording.*(?:call|meet)'
                OR a.headline ~* 'transcript of.*(?:call|discussion|meet)|(?:audio|video) recording.*(?:call|discussion|meet)')
           AND COALESCE(a.headline, a.title) !~* 'intimation of schedule|schedule of analyst|annual general meeting|agm'
         ORDER BY a.published_at DESC
         LIMIT 240
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
           AND COALESCE(a.headline, a.title) !~* 'transcript|audio recording|video recording'
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

      // Lookup latest audio filing per AI-summarized symbol so [Listen] attaches to older summarized calls too
      sql<
        {
          symbol: string;
          id: string;
          published_at: string;
          cached_media_url: string | null;
          cached_media_kind: "audio" | "video" | "youtube" | "webcast" | null;
        }[]
      >`
        SELECT DISTINCT ON (a.symbol)
               a.symbol,
               a.id,
               a.published_at::text AS published_at,
               ac.media_url AS cached_media_url,
               ac.media_kind AS cached_media_kind
          FROM app.announcement a
          JOIN (SELECT DISTINCT symbol FROM app.concall_summary) cs ON cs.symbol = a.symbol
          LEFT JOIN app.concall_audio_cache ac ON ac.announcement_id = a.id
         WHERE a.pdf_url IS NOT NULL
           AND (a.title ~* '(?:audio|video) recording.*(?:call|meet|earnings)'
                OR a.headline ~* '(?:audio|video) recording.*(?:call|discussion|meet|earnings)')
           AND COALESCE(a.headline, a.title) !~* 'annual general meeting|agm'
         ORDER BY a.symbol, a.published_at DESC
      `.catch(() => []),
    ]);

  const audioBySym = new Map<
    string,
    {
      id: string;
      publishedAt: string;
      cachedUrl: string | null;
      cachedKind: "audio" | "video" | "youtube" | "webcast" | null;
    }
  >();
  for (const ar of latestAudioBySymRows) {
    audioBySym.set(ar.symbol, {
      id: ar.id,
      publishedAt: ar.published_at,
      cachedUrl: ar.cached_media_url,
      cachedKind: ar.cached_media_kind,
    });
  }

  const digests: ConcallHubItem[] = digestRows.map((r) => {
    const aud = audioBySym.get(r.symbol);
    const withinWindow =
      aud &&
      Math.abs(new Date(aud.publishedAt).getTime() - new Date(r.published_at).getTime()) <=
        15 * 86400 * 1000;
    return {
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
      periodLabel: r.period_label,
      salesCr: r.sales_cr,
      salesYoy: r.sales_yoy,
      salesQoq: r.sales_qoq,
      ebitdaCr: r.ebitda_cr,
      ebitdaYoy: r.ebitda_yoy,
      opmPct: r.opm_pct,
      opmYoyBps: r.opm_yoy_bps,
      patCr: r.pat_cr,
      npYoy: r.np_yoy,
      roce3y: r.roce_3y,
      roe3y: r.roe_3y,
      opMargin3y: r.op_margin_3y,
      cfoPat3y: r.cfo_pat_3y,
      debtEquity: r.debt_equity,
      peTtm: r.pe_ttm,
      evEbitdaTtm: r.ev_ebitda_ttm,
      audioAnnouncementId: withinWindow ? aud.id : null,
      cachedAudioUrl: withinWindow ? aud.cachedUrl : null,
      cachedAudioKind: withinWindow ? aud.cachedKind : null,
      quarterLabel: r.quarter_label,
      publishedAt: r.published_at,
      pdfUrl: r.pdf_url,
      tone: r.tone,
      toneRationale: r.tone_rationale,
      numbersMentioned: asJsonArray<ConcallNumberItem>(r.numbers_mentioned),
      highlights: asJsonArray<ConcallHighlightItem>(r.highlights),
      qaHighlights: asJsonArray<ConcallQaItem>(r.qa_highlights),
      verifiedRatio: r.verified_ratio ?? 1,
    };
  });

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
      if (isAudio && !existing.audioAnnouncementId) {
        existing.audioAnnouncementId = r.id;
        existing.cachedAudioUrl = r.cached_media_url;
        existing.cachedAudioKind = r.cached_media_kind;
      }
      if (!isAudio && !existing.transcriptUrl) {
        existing.transcriptUrl = r.pdf_url;
      }
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
      salesCr: r.sales_cr,
      salesYoy: r.sales_yoy,
      ebitdaYoy: r.ebitda_yoy,
      opmPct: r.opm_pct,
      opmYoyBps: r.opm_yoy_bps,
      npYoy: r.np_yoy,
      roce3y: r.roce_3y,
      peTtm: r.pe_ttm,
      publishedAt: r.published_at,
      title: r.title,
      audioAnnouncementId: isAudio ? r.id : dig?.audioAnnouncementId ?? null,
      cachedAudioUrl: isAudio ? r.cached_media_url : dig?.cachedAudioUrl ?? null,
      cachedAudioKind: isAudio ? r.cached_media_kind : dig?.cachedAudioKind ?? null,
      transcriptUrl: !isAudio ? r.pdf_url : dig?.pdfUrl ?? null,
      hasSummary: Boolean(dig),
      tone: dig?.tone ?? null,
      quarterLabel: dig?.quarterLabel ?? null,
      callMetrics: dig?.numbersMentioned.slice(0, 4) ?? [],
      topTakeaway: dig?.highlights[0]?.point ?? null,
    });
  }

  // Ensure every AI-summarized stock appears in latestCalls even if older than the 240-row announcement window
  for (const d of latestDigestBySym.values()) {
    if (!mergedLatest.some((m) => m.symbol === d.symbol)) {
      mergedLatest.push({
        id: `dig-${d.id}`,
        symbol: d.symbol,
        companyName: d.companyName,
        sector: d.sector,
        marketCapCategory: d.marketCapCategory,
        compositePct: d.compositePct,
        salesCr: d.salesCr,
        salesYoy: d.salesYoy,
        ebitdaYoy: d.ebitdaYoy,
        opmPct: d.opmPct,
        opmYoyBps: d.opmYoyBps,
        npYoy: d.npYoy,
        roce3y: d.roce3y,
        peTtm: d.peTtm,
        publishedAt: d.publishedAt,
        title: `${d.quarterLabel ?? "Quarterly"} Earnings Call Transcript`,
        audioAnnouncementId: d.audioAnnouncementId,
        cachedAudioUrl: d.cachedAudioUrl,
        cachedAudioKind: d.cachedAudioKind,
        transcriptUrl: d.pdfUrl,
        hasSummary: true,
        tone: d.tone,
        quarterLabel: d.quarterLabel,
        callMetrics: d.numbersMentioned.slice(0, 4),
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
      salesCr: null,
      salesYoy: null,
      ebitdaYoy: null,
      opmPct: null,
      opmYoyBps: null,
      npYoy: null,
      roce3y: null,
      peTtm: null,
      publishedAt: u.published_at,
      title: u.title,
      audioAnnouncementId: null,
      cachedAudioUrl: null,
      cachedAudioKind: null,
      transcriptUrl: u.pdf_url,
      hasSummary: Boolean(dig),
      tone: dig?.tone ?? null,
      quarterLabel: dig?.quarterLabel ?? null,
      callMetrics: [],
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
    <div className="mx-auto max-w-[1160px] px-4 md:px-6 py-6 md:py-8">
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
