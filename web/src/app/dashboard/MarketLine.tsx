/**
 * Zone 1 — the market as a single thin strip: four index levels + FII/DII net.
 *
 * Deliberately NOT a <Zone> widget. It is one line of reference numbers that
 * nothing scrolls and nobody drills into from here, so giving it a boxed,
 * fixed-height widget wasted a whole grid row on four figures.
 *
 * EOD only. app.market_index_history is the daily NSE driver (same source as
 * /indices); there is no intraday index feed in this app, so the "as of" date
 * is load-bearing — without it this row reads as live and it is not.
 *
 * Cached under the "market" tag so the daily refresh purge busts it; the body
 * is one row per index, so a miss is still cheap.
 */
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { loadFiiDii, type FiiDay } from "@/lib/fiiDii";
import { Delta, cr, fmtDay, num } from "./ui";

const FII_DAYS = 5;
const HEADLINE_INDICES = ["NIFTY50", "NIFTYBANK", "NIFTYMIDCAP100", "NIFTY500"];

type IndexRow = {
  code: string;
  name: string;
  close: number;
  pct_change_1d: number | null;
  date: string;
};

async function loadHeadlineIndices(): Promise<IndexRow[]> {
  return sql<IndexRow[]>`
    WITH latest_date AS (SELECT MAX(date) AS d FROM app.market_index_history)
    SELECT h.index_code AS code,
           h.display_name AS name,
           h.close::float AS close,
           h.pct_change::float AS pct_change_1d,
           h.date::text AS date
      FROM app.market_index_history h
      JOIN latest_date l ON l.d = h.date
     WHERE h.index_code = ANY(${HEADLINE_INDICES})
  `.catch(() => [] as IndexRow[]);
}

const cachedIndices = unstable_cache(loadHeadlineIndices, ["dashboard:indices:v1"], {
  revalidate: 3600,
  tags: ["market"],
});

export async function MarketLine() {
  const [indices, fii] = await Promise.all([cachedIndices(), loadFiiDii(FII_DAYS)]);

  if (indices.length === 0 && fii.length === 0) {
    return null;
  }

  // Preserve HEADLINE_INDICES order — the query returns whatever order Neon
  // picks, and Nifty 50 must lead.
  const ordered = HEADLINE_INDICES.map((c) => indices.find((i) => i.code === c)).filter(
    (r): r is IndexRow => r != null,
  );
  const asOf = ordered[0]?.date ?? fii[0]?.date ?? null;

  return (
    <section
      className="rounded-md border hairline px-2 py-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1"
      style={{ backgroundColor: "var(--color-card)" }}
    >
      {ordered.map((r) => (
        <span key={r.code} className="flex items-baseline gap-1 min-w-0">
          <span className="muted-text text-[10px] uppercase tracking-wide truncate">
            {r.name}
          </span>
          <span className="font-mono text-[12.5px] font-semibold tabular-nums">
            {num(r.close)}
          </span>
          <span className="text-[10.5px] tabular-nums">
            <Delta v={r.pct_change_1d} digits={2} />
          </span>
        </span>
      ))}

      {fii.length > 0 && <FiiLine days={fii} />}

      <Link
        href="/indices"
        className="ml-auto shrink-0 text-[10px]"
        style={{ color: "var(--color-accent-700)" }}
      >
        {asOf ? `EOD · ${fmtDay(asOf)}` : "Indices"}
      </Link>
    </section>
  );
}

function FiiLine({ days }: { days: FiiDay[] }) {
  const latest = days[0];
  const fiiSum = sumNets(days.map((d) => d.fii_net));
  const diiSum = sumNets(days.map((d) => d.dii_net));
  return (
    <span className="flex items-baseline gap-1.5 text-[10.5px] tabular-nums">
      <span className="muted-text text-[10px] uppercase tracking-wide">FII/DII</span>
      <Flow net={latest.fii_net} />
      <Flow net={latest.dii_net} />
      <span className="muted-text">
        {days.length}d {cr(fiiSum)} / {cr(diiSum)}
      </span>
    </span>
  );
}

function Flow({ net }: { net: number | null }) {
  if (net == null) return <span className="muted-text">—</span>;
  return (
    <span
      className="font-mono font-semibold"
      style={{
        color: net >= 0 ? "var(--color-delta-up)" : "var(--color-delta-down)",
      }}
    >
      {cr(net)}
    </span>
  );
}

function sumNets(xs: (number | null)[]): number {
  return xs.reduce<number>((s, n) => s + (n ?? 0), 0);
}
