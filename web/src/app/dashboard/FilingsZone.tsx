/**
 * Zone 10 — BSE filings on names you own or watch, last 7 days.
 *
 * Distinct from the headlines inside "Needs action": those are news articles
 * (app.news), this is what the company itself filed (app.announcement). An
 * order win, a pledge, a credit-rating change and a results date all appear
 * here BEFORE any journalist writes them up, and most never get written up.
 *
 * THE NOISE FILTER IS THE WHOLE WIDGET
 *
 * Unfiltered, 7 days of filings on this book is 112 rows, and the top of that
 * list is "Certificate under Regulation 74(5) of SEBI (DP) Regulations" and
 * "Intimation of Trading Window Closure" — mandatory boilerplate every listed
 * company files on a schedule. Measured 2026-10-13 on user 1's 125 holdings:
 * 112 rows before the exclusions below, 49 after. Both numbers are from the
 * same query; if you widen or narrow this list, re-measure rather than assume,
 * because the signal-to-noise ratio IS the feature here and a filter that
 * admits everything is the same as having no widget.
 *
 * Reg. 74(5) is matched by ILIKE on the text as well as by subcategory because
 * companies file the same certificate under three different subcategory labels
 * ('Certificate under Reg. 74 (5)...', 'General', and occasionally NULL) — the
 * structured field alone leaks it.
 *
 * What is NOT excluded: 'Insider Trading / SAST' as a category. Most of it is
 * trading-window boilerplate, which the title filter catches, but what remains
 * is promoter buying and selling — the one filing class worth waking up for.
 */
import { sql } from "@/lib/db";
import { loadPortfolioSymbols } from "@/lib/portfolio";
import { Zone, Empty, SymbolLink, fmtDay } from "./ui";

const WINDOW_DAYS = 7;
const ROW_CAP = 25;

/** Scheduled compliance paperwork. Every listed company files these; none of
 *  them is news. */
const NOISE_CATEGORIES = ["AGM/EGM"];
const NOISE_SUBCATEGORIES = [
  "Certificate under Reg. 74 (5) of SEBI (DP) Regulations, 2018",
  "Newspaper Publication",
  "Allotment of ESOP / ESPS",
  "Analyst / Investor Meet",
  "Daily Buy Back of equity shares",
];

type Filing = {
  id: string;
  symbol: string;
  label: string;
  text: string;
  date: string;
};

async function loadFilings(userId: number, held: string[]): Promise<Filing[]> {
  return sql<Filing[]>`
    SELECT a.id,
           a.symbol,
           COALESCE(NULLIF(a.subcategory, 'General'), a.category, 'Filing') AS label,
           COALESCE(a.headline, a.title)                                    AS text,
           a.published_at::date::text                                       AS date
      FROM app.announcement a
     WHERE a.published_at >= NOW() - (${WINDOW_DAYS}::int * INTERVAL '1 day')
       AND (
         a.symbol = ANY(${held})
         OR a.symbol IN (SELECT w.symbol FROM app.user_watchlist w WHERE w.user_id = ${userId})
       )
       AND COALESCE(a.category, '') <> ALL(${NOISE_CATEGORIES})
       AND COALESCE(a.subcategory, '') <> ALL(${NOISE_SUBCATEGORIES})
       AND COALESCE(a.headline, a.title) NOT ILIKE '%trading window%'
       AND COALESCE(a.headline, a.title) NOT ILIKE '%reg%74%'
     ORDER BY a.published_at DESC
     LIMIT ${ROW_CAP}
  `.catch(() => [] as Filing[]);
}

export async function FilingsZone({ userId }: { userId: number }) {
  const held = await loadPortfolioSymbols(userId).catch(() => [] as string[]);
  const rows = await loadFilings(userId, held);

  return (
    /* No `href`: filings are per-stock in this app (/stock/[symbol] carries the
       full list), so there is no cross-symbol filings page to open. */
    <Zone
      title="Filings"
      count={rows.length || undefined}
      meta={`${WINDOW_DAYS}d · your names`}
    >
      {rows.length === 0 ? (
        <Empty>
          No filings on your holdings or watchlist in the last {WINDOW_DAYS} days.
        </Empty>
      ) : (
        <ul className="divide-y hairline">
          {rows.map((f) => (
            <li key={f.id} className="py-[3px]">
              <span className="flex items-baseline gap-1.5 text-[11.5px]">
                <SymbolLink symbol={f.symbol} />
                <span className="muted-text text-[10px] tabular-nums shrink-0">
                  {fmtDay(f.date)}
                </span>
                <span className="muted-text text-[10px] truncate">{f.label}</span>
              </span>
              {/* The filing's own words, one line. BSE titles are long and
                  front-loaded with the company name, which is already in the
                  symbol above — but trimming them further means parsing prose,
                  and a wrong trim reads as a wrong filing. Truncate instead. */}
              <span className="block text-[10.5px] truncate">{f.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Zone>
  );
}
