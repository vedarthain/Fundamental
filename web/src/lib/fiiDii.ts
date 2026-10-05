/**
 * Daily FII/DII cash-market net (₹ Cr) from app.fii_dii_flow.
 *
 * Source of truth is the table, not market_snapshot_cache — that blob
 * also carries movers/heatmap and /market no longer exists. Fail soft:
 * an empty or missing table must not take down /dashboard.
 */
import "server-only";
import { sql } from "@/lib/db";

export type FiiDay = {
  date: string;
  fii_net: number | null;
  dii_net: number | null;
};

export async function loadFiiDii(limit: number): Promise<FiiDay[]> {
  return sql<FiiDay[]>`
    SELECT date::text AS date,
           fii_net::float AS fii_net,
           dii_net::float AS dii_net
      FROM app.fii_dii_flow
     ORDER BY date DESC
     LIMIT ${limit}
  `.catch(() => [] as FiiDay[]);
}
