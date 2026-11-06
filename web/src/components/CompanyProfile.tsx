"use client";

/**
 * "About {symbol}" company profile card — lede sentence, segments/products,
 * health pros/cons, facts grid (CEO, founded, HQ, employees, listed date,
 * industry, markets, former name), website link, and the rest of the prose
 * behind a disclosure.
 *
 * Extracted from src/app/watchlist/WatchlistClient.tsx (where the ⓘ button
 * on each watchlist row first grew this) so the admin verdict detail page
 * can show the exact same card without a second, drifting copy. Fetches
 * /api/stock/profile itself — that route is unauthenticated (symbol param
 * only), so this component works unmodified on any page.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { BusinessHealth } from "@/lib/businessHealth";
import { parseSummary, splitLede } from "@/lib/businessSummary";

export type CompanyProfileData = {
  symbol: string;
  company_name: string;
  sector: string | null;
  industry: string | null;
  market_cap_category: string | null;
  listing_date: string | null;
  business_summary: string | null;
  website: string | null;
  employees: number | null;
  ceo_name: string | null;
  ceo_title: string | null;
  fetched_at: string | null;
  health: BusinessHealth | null;
};

// Module-level, same pattern as the watchlist's extrasCache: re-opening the
// panel on a symbol you already looked at must not re-hit the API.
const profileCache = new Map<string, CompanyProfileData>();

// Academic qualifications yfinance appends to officer names — "Mr. Pathik
// Paresh Shah B.E.", "Ms. Vishakha Vivek Mulye B.Com, CA". Nobody reads a CEO
// line to learn they have a B.Com, and the suffix is what made the facts row
// run together as "…Shah B.E.Employees: 4,162". Matched as an explicit SET,
// not a pattern: a heuristic like "trailing short token" would eat real
// surnames (Shah, Rao, Jain).
const DEGREE_TOKENS = new Set([
  "BE", "BSC", "BCOM", "BTECH", "BA", "BBA", "BPHARM", "BARCH", "BED",
  "MSC", "MCOM", "MTECH", "MBA", "MA", "MS", "MPHIL",
  "PHD", "LLB", "LLM", "CA", "CS", "CFA", "CPA", "ACA", "FCA", "ACS", "FCS",
  "ICWA", "CWA", "PGDM", "PGDBM", "IAS", "IPS", "IRS", "CAIIB", "DISA",
]);

/** "Mr. Pathik Paresh Shah B.E." → "Pathik Paresh Shah". Drops the honorific
 *  and any trailing qualifications, and collapses the double spaces yfinance
 *  leaves between initials ("Mr. B.  Sairam"). */
function cleanPerson(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/^(Mr|Mrs|Ms|Dr|Prof|Shri|Smt)\.?\s+/i, "");
  const parts = s.split(/[\s,]+/).filter(Boolean);
  while (parts.length > 1) {
    const tok = parts[parts.length - 1];
    const isDegree =
      DEGREE_TOKENS.has(tok.replace(/\./g, "").toUpperCase()) || /\.[A-Za-z]/.test(tok);
    if (!isDegree) break;
    parts.pop();
  }
  return parts.join(" ");
}

/** YYYY-MM-DD → "24 May '26" (compact, for a metric strip). */
function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  const yr = d.toLocaleDateString("en-IN", { year: "2-digit", timeZone: "UTC" });
  return `${day} '${yr}`;
}

/** The pros/cons block. Two columns on a wide panel, stacked on a narrow one.
 *
 *  Deliberately NOT a score. Every attempt to roll these into a single number
 *  throws away the only thing that makes them useful — which specific fact
 *  fired — and the platform already has a composite score for the "one number"
 *  job. This block exists to answer a different question: what would someone
 *  arguing for this stock say, and what would someone arguing against it say.
 *
 *  Green and red carry the sign, but the ✓ / ! prefixes carry it too, because
 *  ~8% of men cannot separate those two hues and a colour-only signal is not a
 *  signal for them. */
function HealthBullets({ health, symbol }: { health: BusinessHealth; symbol: string }) {
  const { pros, cons } = health;

  if (pros.length === 0 && cons.length === 0) {
    return (
      <p className="text-[11px] muted-text italic mb-2">
        {health.years === 0
          ? `No annual financials on file for ${symbol}.`
          : health.years < 4
            ? `Only ${health.years} year${health.years === 1 ? "" : "s"} of financials — too short to judge trends.`
            : `Nothing stands out either way on ${health.years} years of financials.`}
      </p>
    );
  }

  const col = (items: typeof pros, title: string, colour: string, glyph: string) =>
    items.length > 0 && (
      <div className="min-w-0">
        <div className="text-[9.5px] uppercase tracking-wide font-semibold mb-1" style={{ color: colour }}>
          {title}
        </div>
        <ul className="space-y-0.5">
          {items.map((c) => (
            <li key={c.id} className="flex gap-1.5 text-[11px] leading-snug">
              <span aria-hidden className="shrink-0 font-bold" style={{ color: colour }}>
                {glyph}
              </span>
              <span className="min-w-0">{c.text}</span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="mb-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {col(pros, "Working for it", "var(--color-up, #15803d)", "✓")}
        {col(cons, "Working against it", "var(--color-down, #b91c1c)", "!")}
      </div>
      {health.leverageSkipped && (
        <p className="mt-1.5 text-[9.5px] muted-text italic">
          Read as a lender: debt, margin and cash-conversion checks are skipped — those are the business
          model here, not a signal. Return on assets and cost-to-income are used in their place.
        </p>
      )}
    </div>
  );
}

export function CompanyProfile({ symbol, onClose }: { symbol: string; onClose?: () => void }) {
  const [data, setData] = useState<CompanyProfileData | null>(profileCache.get(symbol) ?? null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const cached = profileCache.get(symbol);
    if (cached) {
      setData(cached);
      setErr(false);
      return;
    }
    let alive = true;
    setData(null);
    setErr(false);
    fetch(`/api/stock/profile?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: CompanyProfileData) => {
        if (!alive) return;
        profileCache.set(symbol, j);
        setData(j);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [symbol]);

  // Close on Escape — the panel is dismissible chrome, and reaching back for
  // the ⓘ to close it is the thing that makes an expander annoying.
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="mt-2 rounded-md border hairline p-3"
      style={{ background: "var(--color-paper)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wide muted-text font-semibold">
          About {symbol}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] leading-none muted-text hover:text-[var(--color-ink)] shrink-0"
            title="Close"
            aria-label="Close company information"
          >
            ×
          </button>
        )}
      </div>

      {err ? (
        <div className="text-[11.5px] muted-text italic">Could not load company information.</div>
      ) : data === null ? (
        <div className="text-[11.5px] muted-text italic">Loading…</div>
      ) : (
        <>
          {(() => {
            const summary = data.business_summary ?? "";
            const { lede, rest } = summary ? splitLede(summary) : { lede: "", rest: "" };
            const parsed = summary ? parseSummary(summary) : null;
            const facts: { k: string; v: ReactNode }[] = [];
            if (data.ceo_name) {
              facts.push({ k: "CEO", v: <span title={data.ceo_title ?? undefined}>{cleanPerson(data.ceo_name)}</span> });
            }
            const founded = parsed?.founded ?? null;
            const hq = parsed?.hq ?? null;
            if (founded) facts.push({ k: "Founded", v: founded });
            if (hq) facts.push({ k: "Head office", v: hq });
            if (data.employees != null) {
              facts.push({ k: "Employees", v: data.employees.toLocaleString("en-IN") });
            }
            if (data.listing_date) {
              facts.push({ k: "Listed", v: formatShortDate(data.listing_date) });
            }
            if (data.industry || data.sector) {
              facts.push({ k: "Industry", v: data.industry ?? data.sector });
            }
            if (parsed && parsed.geo.length >= 2) {
              const g = parsed.geo.join(", ");
              facts.push({ k: "Markets", v: <span title={g}>{g}</span> });
            }
            if (parsed?.formerName) {
              const fn = parsed.formerName;
              const txt = fn.changed ? `${fn.name} (to ${fn.changed})` : fn.name;
              facts.push({ k: "Formerly", v: <span title={txt}>{txt}</span> });
            }
            return (
              <>
                {lede && <p className="text-[12px] leading-snug mb-2">{lede}</p>}

                {parsed && parsed.segments.length > 0 && (
                  <div className="mb-2">
                    <div className="muted-text text-[10px] uppercase tracking-wide mb-1">
                      {parsed.segmentsSource === "segments"
                        ? "Segments"
                        : parsed.segmentsSource === "activities"
                          ? "Activities"
                          : "Products"}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {parsed.segments.map((sg) => (
                        <span
                          key={sg}
                          className="inline-block px-1.5 py-0.5 rounded text-[10.5px] leading-tight"
                          style={{ backgroundColor: "var(--color-paper)", color: "var(--color-muted)" }}
                        >
                          {sg}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {data.health && <HealthBullets health={data.health} symbol={symbol} />}

                {facts.length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1 text-[11px] mb-2">
                    {facts.map((f) => (
                      <Fragment key={f.k}>
                        <dt className="muted-text whitespace-nowrap">{f.k}</dt>
                        <dd className="font-medium tabular-nums min-w-0 truncate">{f.v}</dd>
                      </Fragment>
                    ))}
                  </dl>
                )}

                {data.website && (
                  <a
                    href={data.website.startsWith("http") ? data.website : `https://${data.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-[11px] font-medium hover:underline mb-1.5"
                    style={{ color: "var(--color-accent-600)" }}
                  >
                    {data.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
                  </a>
                )}

                {rest && (
                  <details className="group">
                    <summary className="cursor-pointer list-none text-[10.5px] font-medium select-none" style={{ color: "var(--color-accent-600)" }}>
                      <span className="group-open:hidden">More about the business ▾</span>
                      <span className="hidden group-open:inline">Less ▴</span>
                    </summary>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed max-h-[11rem] overflow-y-auto pr-1">
                      {rest}
                    </p>
                  </details>
                )}

                {!summary && (
                  <p className="text-[11.5px] muted-text italic">
                    No business description on file for {symbol}.
                  </p>
                )}
              </>
            );
          })()}

          <div className="mt-2 flex items-center justify-between gap-2 text-[9.5px] muted-text">
            <span>
              {[
                data.fetched_at
                  ? `Description as of ${formatShortDate(data.fetched_at.slice(0, 10))}`
                  : "Description date unknown",
                data.health?.asOf ? `financials to ${data.health.asOf}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <Link href={`/stock/${symbol}`} className="hover:underline shrink-0">
              Full profile →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
