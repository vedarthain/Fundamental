/**
 * Morning attention payload for the strip on /portfolio and /watchlist.
 *
 * Reads the last-reconciled alert set (same as /tools/alerts) — does NOT
 * re-evaluate. Headlines are a 2-day intersect with held + saved names;
 * missing news tables fail soft. Cap is the point of the strip.
 */
import "server-only";
import { sql } from "@/lib/db";
import { loadAlerts, type AlertRow } from "@/lib/alerts";
import { loadPortfolioSymbols } from "@/lib/portfolio";

export const STRIP_ALERT_CAP = 5;
export const STRIP_HEADLINE_CAP = 3;

export type AttentionHeadline = {
  id: string;
  title: string;
  symbols: string[];
};

export type AttentionPayload = {
  alerts: AlertRow[];
  headlines: AttentionHeadline[];
};

export async function loadAttention(userId: number): Promise<AttentionPayload> {
  const { active } = await loadAlerts(userId);
  const alerts = active.slice(0, STRIP_ALERT_CAP);

  const headlines = await loadHeadlinesForUser(userId).catch(() => [] as AttentionHeadline[]);
  return { alerts, headlines };
}

async function loadHeadlinesForUser(userId: number): Promise<AttentionHeadline[]> {
  const [held, saved] = await Promise.all([
    loadPortfolioSymbols(userId).catch(() => [] as string[]),
    sql<{ symbol: string }[]>`
      SELECT symbol FROM app.user_watchlist WHERE user_id = ${userId}
    `.catch(() => [] as { symbol: string }[]),
  ]);
  const symbols = Array.from(
    new Set([...held, ...saved.map((r) => r.symbol)].map((s) => s.toUpperCase())),
  );
  if (symbols.length === 0) return [];

  const rows = await sql<
    { id: string; title: string; symbols: string[] }[]
  >`
    SELECT n.id::text AS id, n.title,
           array_agg(DISTINCT ns.symbol) AS symbols
      FROM app.news n
      JOIN app.news_stock ns ON ns.news_id = n.id
     WHERE n.published_at > now() - interval '2 days'
       AND ns.symbol = ANY(${symbols})
     GROUP BY n.id, n.title, n.published_at
     ORDER BY n.published_at DESC NULLS LAST
     LIMIT ${STRIP_HEADLINE_CAP}
  `;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    symbols: (r.symbols ?? []).filter(Boolean),
  }));
}
