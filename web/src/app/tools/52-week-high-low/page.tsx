/**
 * /tools/52-week-high-low — a dedicated 52-week high/low scanner, filterable by
 * index segment (Nifty 50 / 100 / 200 / 500 / All).
 *
 * Why its own page: the /market card only shows aggregate counts + a top-20
 * teaser. This tool lists every stock at/near its 52-week extreme and lets you
 * narrow to a segment so you can scan, say, "which Nifty 100 names just made a
 * fresh 52-week high".
 *
 * Data: end-of-day. 52-week high/low + latest close come from the read-only
 * golden price archive; names + Industry Score from app; index membership from
 * app.index_constituent. The heavy golden scan is `unstable_cache`d (6h) and
 * shared across segments — the segment filter is applied in-page.
 */
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { sql, golden } from "@/lib/db";
import { band, bandColor } from "@/lib/score";

// Reads ?segment from the URL → render per-request; the heavy query is cached.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "52-Week High / Low scanner — by index segment · EquityRoots",
  description:
    "Every NSE stock at or near its 52-week high or low, filterable by index segment (Nifty 50 / 100 / 200 / 500). End-of-day, links to each stock's scorecard.",
};

const SEGMENTS = [
  { key: "nifty50", label: "Nifty 50", code: "NIFTY50" },
  { key: "nifty100", label: "Nifty 100", code: "NIFTY100" },
  { key: "nifty200", label: "Nifty 200", code: "NIFTY200" },
  { key: "nifty500", label: "Nifty 500", code: "NIFTY500" },
  { key: "all", label: "All scored", code: null },
] as const;
type SegKey = (typeof SEGMENTS)[number]["key"];
function isSeg(s: string | undefined): s is SegKey {
  return !!s && SEGMENTS.some((x) => x.key === s);
}

type Bucket = "at_high" | "near_high" | "at_low" | "near_low";
type Stock = {
  symbol: string;
  name: string;
  price: number;
  pctFromHigh: number; // (close-hi)/hi*100, ≤ 0
  pctFromLow: number;  // (close-lo)/lo*100, ≥ 0
  composite: number | null;
  bucket: Bucket;
  members: string[]; // index codes the stock belongs to
};

/** Build the full "at/near a 52-week extreme" set once (cached 6h), tagged with
 *  index membership so the page can filter by segment without re-querying. */
const loadWeekRange = unstable_cache(
  async (): Promise<{ asOf: string | null; stocks: Stock[] }> => {
    try {
      const [dateRow] = await golden<{ d: string | null }[]>`
        SELECT MAX(date)::text AS d FROM golden.price_history WHERE interval = '1d'
      `;
      const grows = await golden<{ symbol: string; close: number; hi: number | null; lo: number | null }[]>`
        WITH bounds AS (
          SELECT date AS latest FROM golden.price_history WHERE interval='1d'
           ORDER BY date DESC LIMIT 1
        ),
        horizon AS (SELECT (SELECT latest FROM bounds) - INTERVAL '370 days' AS cutoff),
        yearly AS (
          SELECT REPLACE(p.symbol, '.NS', '') AS symbol, MAX(p.close) AS hi, MIN(p.close) AS lo
            FROM golden.price_history p, horizon h
           WHERE p.interval = '1d' AND p.date >= h.cutoff
           GROUP BY 1
        ),
        today AS (
          SELECT REPLACE(symbol, '.NS', '') AS symbol, close
            FROM golden.price_history, bounds
           WHERE interval = '1d' AND date = bounds.latest
        )
        SELECT t.symbol, t.close::float AS close, y.hi::float AS hi, y.lo::float AS lo
          FROM today t LEFT JOIN yearly y ON y.symbol = t.symbol
      `;
      const g = new Map(grows.map((r) => [r.symbol, r]));

      const urows = await sql<{ symbol: string; company_name: string; composite: number | null }[]>`
        SELECT u.symbol, u.company_name,
               s.composite_pct AS composite
          FROM app.universe u
          LEFT JOIN app.scores s
            ON s.symbol = u.symbol
           AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
         WHERE u.is_active
      `;
      const memRows = await sql<{ index_code: string; symbol: string }[]>`
        SELECT index_code, symbol FROM app.index_constituent
         WHERE index_code IN ('NIFTY50','NIFTY100','NIFTY200','NIFTY500')
      `;
      const members = new Map<string, string[]>();
      for (const m of memRows) {
        const arr = members.get(m.symbol) ?? [];
        arr.push(m.index_code);
        members.set(m.symbol, arr);
      }

      const stocks: Stock[] = [];
      for (const u of urows) {
        const gr = g.get(u.symbol);
        if (!gr || gr.hi == null || gr.lo == null || gr.hi <= 0 || gr.lo <= 0) continue;
        const c = gr.close;
        let bucket: Bucket | null = null;
        if (c >= gr.hi * 0.995) bucket = "at_high";
        else if (c >= gr.hi * 0.95) bucket = "near_high";
        else if (c <= gr.lo * 1.005) bucket = "at_low";
        else if (c <= gr.lo * 1.05) bucket = "near_low";
        if (!bucket) continue;
        stocks.push({
          symbol: u.symbol,
          name: u.company_name,
          price: c,
          pctFromHigh: ((c - gr.hi) / gr.hi) * 100,
          pctFromLow: ((c - gr.lo) / gr.lo) * 100,
          composite: u.composite,
          bucket,
          members: members.get(u.symbol) ?? [],
        });
      }
      return { asOf: dateRow?.d ?? null, stocks };
    } catch {
      return { asOf: null, stocks: [] };
    }
  },
  ["tools-week-range-v1"],
  { revalidate: 21600, tags: ["snapshot", "market"] },
);

const SECTION_CAP = 80;

export default async function WeekRangePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const seg: SegKey = isSeg(sp.segment) ? sp.segment : "nifty50";
  const segCode = SEGMENTS.find((s) => s.key === seg)!.code;

  const { asOf, stocks } = await loadWeekRange();

  const inSeg = segCode == null ? stocks : stocks.filter((s) => s.members.includes(segCode));

  const atHigh = inSeg.filter((s) => s.bucket === "at_high").sort((a, b) => b.pctFromHigh - a.pctFromHigh);
  const nearHigh = inSeg.filter((s) => s.bucket === "near_high").sort((a, b) => b.pctFromHigh - a.pctFromHigh);
  const atLow = inSeg.filter((s) => s.bucket === "at_low").sort((a, b) => a.pctFromLow - b.pctFromLow);
  const nearLow = inSeg.filter((s) => s.bucket === "near_low").sort((a, b) => a.pctFromLow - b.pctFromLow);

  const asOfLabel = asOf
    ? new Date(asOf + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  return (
    <div className="theme-indigo mx-auto max-w-[1100px] px-6 py-10">
      <header className="max-w-[720px]">
        <div className="eyebrow mb-3">Tools</div>
        <h1 className="font-display text-[34px] tracking-tight leading-tight">52-week high / low</h1>
        <p className="muted-text mt-3 text-[14.5px] leading-[1.55]">
          Every stock sitting at or near its 52-week extreme, filterable by index segment.
          End-of-day{asOfLabel ? ` · close of ${asOfLabel}` : ""} — not live. Each name links to its scorecard.
        </p>
      </header>

      {/* Segment filter */}
      <nav className="mt-6 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide muted-text mr-1">Segment</span>
        {SEGMENTS.map((s) => {
          const active = s.key === seg;
          return (
            <Link
              key={s.key}
              href={`/tools/52-week-high-low?segment=${s.key}`}
              scroll={false}
              className="px-3 py-1 rounded-full text-[12px] border transition-colors whitespace-nowrap"
              style={
                active
                  ? { borderColor: "var(--color-accent-300)", background: "var(--color-accent-50)", color: "var(--color-accent-700)", fontWeight: 600 }
                  : { borderColor: "var(--color-border-default)", background: "transparent", color: "var(--color-muted)" }
              }
            >
              {s.label}
            </Link>
          );
        })}
        <span className="muted-text text-[11px] ml-1 tabular-nums">{inSeg.length} stocks at/near an extreme</span>
      </nav>

      {stocks.length === 0 ? (
        <div className="card p-6 mt-6 muted-text text-[13px]">
          No end-of-day data available right now.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          <Column
            title="At / near 52-week HIGH"
            color="var(--color-score-good)"
            atLabel="At high" atHint="within 0.5%"
            nearLabel="Near high" nearHint="within 5%"
            at={atHigh} near={nearHigh} mode="high"
          />
          <Column
            title="At / near 52-week LOW"
            color="var(--color-score-poor)"
            atLabel="At low" atHint="within 0.5%"
            nearLabel="Near low" nearHint="within 5%"
            at={atLow} near={nearLow} mode="low"
          />
        </div>
      )}

      <footer className="mt-10 pt-5 border-t hairline text-[11.5px] muted-text leading-[1.6] max-w-[760px]">
        End-of-day snapshot from the price archive — not live, not investment advice. A 52-week
        high/low is a price fact, not a quality signal: a stock can hit a new high on momentum or
        a new low on a justified de-rating. Use the Industry Score dot as a quality cue and always
        do your own research.
      </footer>
    </div>
  );
}

function Column({
  title, color, atLabel, atHint, nearLabel, nearHint, at, near, mode,
}: {
  title: string; color: string;
  atLabel: string; atHint: string; nearLabel: string; nearHint: string;
  at: Stock[]; near: Stock[]; mode: "high" | "low";
}) {
  return (
    <section className="card overflow-hidden">
      <header className="px-4 py-3 border-b hairline" style={{ borderTop: `3px solid ${color}` }}>
        <div className="font-medium text-[14px]" style={{ color }}>{title}</div>
      </header>
      <div className="p-3 space-y-3">
        <Group label={atLabel} hint={atHint} rows={at} mode={mode} color={color} />
        <Group label={nearLabel} hint={nearHint} rows={near} mode={mode} color={color} />
        {at.length === 0 && near.length === 0 && (
          <p className="text-[12px] muted-text py-2">No stocks in this segment at/near the {mode}.</p>
        )}
      </div>
    </section>
  );
}

function Group({
  label, hint, rows, mode, color,
}: {
  label: string; hint: string; rows: Stock[]; mode: "high" | "low"; color: string;
}) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, SECTION_CAP);
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color }}>{label}</span>
        <span className="text-[10px] muted-text tabular-nums">{rows.length}</span>
        <span className="text-[9.5px] muted-text">· {hint}</span>
      </div>
      <ul className="divide-y hairline">
        {shown.map((s) => {
          const dist = mode === "high" ? s.pctFromHigh : s.pctFromLow;
          const distLabel = mode === "high"
            ? `${dist >= 0 ? "+" : "−"}${Math.abs(dist).toFixed(1)}% vs high`
            : `+${dist.toFixed(1)}% vs low`;
          return (
            <li key={s.symbol}>
              <Link href={`/stock/${s.symbol}`} className="flex items-center gap-2 py-1.5 hover:opacity-80 transition-opacity">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: s.composite != null ? bandColor(band(s.composite)) : "var(--color-border-default)" }}
                  title={s.composite != null ? `Industry Score ${Math.round(s.composite)}` : "Not scored"}
                />
                <span className="font-medium text-[12.5px] tabular-nums shrink-0 w-[92px] truncate">{s.symbol}</span>
                <span className="muted-text text-[11.5px] truncate min-w-0 flex-1">{s.name}</span>
                <span className="tabular-nums text-[11.5px] shrink-0">
                  {s.price.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                </span>
                <span className="tabular-nums text-[10.5px] muted-text shrink-0 w-[78px] text-right">{distLabel}</span>
              </Link>
            </li>
          );
        })}
        {rows.length > SECTION_CAP && (
          <li className="py-1.5 text-[10.5px] muted-text">+{rows.length - SECTION_CAP} more</li>
        )}
      </ul>
    </div>
  );
}
