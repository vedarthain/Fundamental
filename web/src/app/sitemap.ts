/**
 * /sitemap.xml — generated dynamically by Next.js (App Router convention).
 *
 * robots.ts declares `Sitemap: https://equityroots.in/sitemap.xml`; until this
 * file existed that URL 404'd, leaving the ~2,150 stock pages (plus industry
 * and tool routes) effectively invisible to search crawlers. This enumerates:
 *   - static top-level pages,
 *   - the tool pages,
 *   - every industry cluster (/industry/[id]),
 *   - every stock that actually renders (must have an app.scores row — the
 *     stock page 404s without one, so we join on scores, not universe).
 *
 * Well under Next's 50,000-URL / 50 MB per-file cap (~2,200 URLs), so a single
 * sitemap is fine. Cached 24h to avoid waking Neon on every crawler hit.
 */
import type { MetadataRoute } from "next";
import { sql } from "@/lib/db";

const BASE = "https://equityroots.in";

// Industry data changes weekly; matches the /industry cache cadence.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Static, publicly-indexable routes. Admin/api are excluded (also blocked in
  // robots.ts). Auth pages (login/signup) and personal pages (watchlist) are
  // omitted as they carry no crawlable content.
  const staticPaths: Array<{ path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
    { path: "/", priority: 1.0, freq: "daily" },
    { path: "/market", priority: 0.9, freq: "daily" },
    { path: "/today", priority: 0.9, freq: "daily" },
    { path: "/news", priority: 0.8, freq: "daily" },
    { path: "/ideas", priority: 0.8, freq: "daily" },
    { path: "/sectors", priority: 0.7, freq: "weekly" },
    { path: "/indices", priority: 0.7, freq: "daily" },
    { path: "/tools", priority: 0.6, freq: "weekly" },
    { path: "/tools/screener", priority: 0.6, freq: "weekly" },
    { path: "/tools/peer-comparison", priority: 0.6, freq: "weekly" },
    { path: "/tools/opportunities", priority: 0.6, freq: "weekly" },
    { path: "/tools/52-week-high-low", priority: 0.6, freq: "daily" },
    { path: "/tools/investing-trials", priority: 0.5, freq: "monthly" },
    { path: "/glossary", priority: 0.4, freq: "monthly" },
    { path: "/about", priority: 0.3, freq: "monthly" },
    { path: "/feedback", priority: 0.2, freq: "monthly" },
  ];

  const staticEntries: MetadataRoute.Sitemap = staticPaths.map((s) => ({
    url: `${BASE}${s.path}`,
    lastModified: now,
    changeFrequency: s.freq,
    priority: s.priority,
  }));

  // Dynamic entries. If the DB is unreachable at build/request time, still
  // return the static map rather than failing the whole route.
  let clusterEntries: MetadataRoute.Sitemap = [];
  let stockEntries: MetadataRoute.Sitemap = [];
  try {
    const clusters = await sql<{ id: string }[]>`SELECT id FROM app.cluster ORDER BY id`;
    clusterEntries = clusters.map((c) => ({
      url: `${BASE}/industry/${encodeURIComponent(c.id)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));

    const symbols = await sql<{ symbol: string }[]>`
      SELECT DISTINCT symbol FROM app.scores ORDER BY symbol
    `;
    stockEntries = symbols.map((r) => ({
      url: `${BASE}/stock/${encodeURIComponent(r.symbol)}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.5,
    }));
  } catch {
    // Fall through with whatever we have.
  }

  return [...staticEntries, ...clusterEntries, ...stockEntries];
}
