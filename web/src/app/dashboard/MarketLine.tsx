/**
 * Zone 1 — the market in one row: four index levels + the FII/DII cash net.
 *
 * EOD only. app.market_index_history is the daily NSE driver (same source as
 * /indices); there is no intraday index feed in this app, so the "as of" date
 * is load-bearing — without it this row reads as live and it is not.
 *
 * Cached under the "market" tag so the daily refresh purge busts it; the body
 * is one row per index, so a miss is still cheap.
 */
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { loadFiiDii, type FiiDay } from "@/lib/fiiDii";
import { Zone, Delta, cr, fmtDay, num } from "./ui";

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
    <Zone
      title="Market"
      href="/indices"
      meta={asOf ? `EOD · ${fmtDay(asOf)}` : undefined}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
        {ordered.map((r) => (
          <div key={r.code} className="min-w-0">
            <div className="text-[11px] muted-text truncate">{r.name}</div>
            <div className="font-mono text-[14px] font-semibold tabular-nums">
              {num(r.close)}
            </div>
            <div className="text-[11px] tabular-nums">
              <Delta v={r.pct_change_1d} digits={2} />
            </div>
          </div>
        ))}
      </div>
      {fii.length > 0 && <FiiLine days={fii} />}
    </Zone>
  );
}

function FiiLine({ days }: { days: FiiDay[] }) {
  const latest = days[0];
  const fiiSum = sumNets(days.map((d) => d.fii_net));
  const diiSum = sumNets(days.map((d) => d.dii_net));
  return (
    <div className="mt-3 pt-2 border-t hairline flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px]">
      <span className="muted-text text-[11px]">FII / DII cash</span>
      <span className="tabular-nums">
        FII <Flow net={latest.fii_net} />
      </span>
      <span className="tabular-nums">
        DII <Flow net={latest.dii_net} />
      </span>
      <span className="muted-text text-[11px] tabular-nums">
        {days.length}d: FII {cr(fiiSum)} · DII {cr(diiSum)}
      </span>
    </div>
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
