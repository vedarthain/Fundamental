import "server-only";
import { sql } from "@/lib/db";
import type {
  ConcallDigest,
  ConcallHighlightItem,
  ConcallNumberItem,
  ConcallQaItem,
} from "@/lib/concallTypes";

export type { ConcallDigest } from "@/lib/concallTypes";

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

/**
 * Load up to `limit` most recent quote-verified concall digests for `symbol`.
 * Returns `[]` gracefully if the migration hasn't run yet or no rows exist.
 */
export async function loadConcallsForSymbol(
  symbol: string,
  limit = 6,
): Promise<ConcallDigest[]> {
  try {
    const rows = await sql<
      {
        id: number;
        symbol: string;
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
      SELECT id::int AS id,
             symbol,
             quarter_label,
             published_at::text AS published_at,
             pdf_url,
             tone,
             tone_rationale,
             numbers_mentioned,
             highlights,
             qa_highlights,
             verified_ratio::float8 AS verified_ratio
        FROM app.concall_summary
       WHERE symbol = ${symbol.toUpperCase()}
       ORDER BY published_at DESC
       LIMIT ${limit}
    `;

    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
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
  } catch {
    return [];
  }
}
