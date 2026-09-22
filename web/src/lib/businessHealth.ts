/**
 * businessHealth — the "pros and cons" behind the ⓘ button, DERIVED from
 * app.fundamentals_annual and app.shareholding_pattern.
 *
 * WHY DERIVED, not scraped: screener.in's own Pros/Cons bullets live only in
 * the HTML page. What this repo stores is `app.screener_export_raw`, which is
 * the XLSX export — 431 symbols, no prose. There is nothing to copy. So every
 * line below is computed here, from the annual statements.
 *
 * That turns out to be the better half of the deal. `business_summary` (the
 * prose above these bullets) was written by ONE backfill on 2026-05-04 and
 * nothing refreshes it. `fundamentals_annual` is different: 2,577 of 2,593
 * active symbols were re-fetched in September 2026, 2,592 have at least one
 * year, 2,422 have five or more. The bullets are the freshest thing on the
 * card even though they are the only computed thing on it.
 *
 * ── Rules this file holds itself to ───────────────────────────────────────
 *
 * 1. EVERY BULLET CARRIES ITS NUMBER. "Profit compounded 21% a year over 5
 *    years" — not "strong growth". A threshold is an opinion; the number is
 *    the evidence, and the reader is entitled to disagree with where the line
 *    was drawn. This is also what keeps the thresholds honest: a badly chosen
 *    one is visible the moment you read the bullet it produced.
 *
 * 2. A MISSING INPUT PRODUCES NOTHING, NEVER A PASS. Each check returns null
 *    when its inputs are absent. The alternative — treating a null borrowings
 *    as zero — would print "almost debt-free" for a company whose balance
 *    sheet simply failed to parse, which is the exact failure mode CLAUDE.md
 *    §5 is about: a check that cannot fail.
 *
 * 3. LEVERAGE CHECKS ARE SKIPPED FOR FINANCIALS. A bank funds itself with
 *    deposits and borrowings; debt/equity of 8 is its business model, not a
 *    warning. Running the generic rule over the 293 "Financial Services"
 *    symbols would flag nearly all of them, and a red flag that fires on every
 *    member of a sector carries no information. Those two checks are dropped
 *    for that sector rather than re-tuned, because the honest statement is "I
 *    do not assess this", not a softened threshold.
 *
 * 4. CAGR REFUSES A NEGATIVE OR ZERO BASE. Growth "from" a loss has no
 *    defined rate, and computing one produces confident nonsense (a swing from
 *    −10 to +10 is not 0% growth and is not infinite growth). Those cases fall
 *    through to the turnaround/loss checks, which describe them in words.
 */

/** A money/ratio field as it actually arrives.
 *
 *  STRING is not defensive padding — it is the normal case. postgres.js hands
 *  back `numeric` as a JS string, because numeric is arbitrary-precision and
 *  silently narrowing it to a float would be a data-integrity bug in a
 *  financial table. The first run of this module returned zero bullets for a
 *  symbol with 11 clean years of statements for exactly this reason: a
 *  `typeof v === "number"` guard rejected every field, every check returned
 *  null, and the card said "nothing stands out" — which looked like a
 *  considered verdict rather than a total parse failure. That is the failure
 *  mode CLAUDE.md §5 names: a check that cannot fail. Hence `num()` below, and
 *  hence this type says out loud what the driver really sends. */
type Num = number | string | null;

/** One annual statement row, newest first as handed in. Every field is
 *  nullable because the source rows genuinely are: 4,786 of 5,052 recent rows
 *  carry `borrowings`, 2,562 carry `dividend_amount`. */
export type AnnualRow = {
  period_end: string;
  sales: Num;
  operating_profit: Num;
  other_income: Num;
  interest: Num;
  profit_before_tax: Num;
  net_profit: Num;
  dividend_amount: Num;
  equity_share_capital: Num;
  reserves: Num;
  borrowings: Num;
  no_of_equity_shares: Num;
  cash_from_operating: Num;
  /** Lenders only, but selected for everyone. ROA is the return measure that
   *  works on a balance sheet made of other people's money, and cost-to-income
   *  is the efficiency measure that replaces operating margin. Both are
   *  populated for all 293 financials (expenses for 288). */
  total_assets: Num;
  expenses: Num;
};

/** One shareholding-pattern quarter, newest first. */
export type ShareRow = {
  period_end: string;
  promoter_pct: Num;
  pledge_pct: Num;
};

export type HealthCheck = {
  /** Stable id — the client keys on it, and it names the rule in a bug report. */
  id: string;
  kind: "pro" | "con";
  /** One sentence, always containing the number that produced it. */
  text: string;
};

export type BusinessHealth = {
  pros: HealthCheck[];
  cons: HealthCheck[];
  /** Label of the latest annual period, e.g. "FY26" — the card is dated with
   *  this, because a bullet about profit growth is only as current as the last
   *  annual result, which for most symbols is March. */
  latestPeriod: string | null;
  /** Years of annual history actually used. Below 5 most growth checks cannot
   *  run, and the card says so instead of showing a thin, silent list. */
  years: number;
  /** True when this was read as a lender, so the four checks that assume a
   *  manufacturer — leverage, operating margin, cash conversion, the one-off
   *  detector — were skipped and the two bank measures run instead. Surfaced so
   *  the absent debt line is explained rather than looking like an oversight. */
  leverageSkipped: boolean;
};

/** The ONLY way a field becomes a number in this file. Accepts the numeric
 *  strings postgres.js returns; rejects "", null, and anything non-finite. */
const num = (v: Num | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Compound annual growth over `years`. Null unless BOTH ends are positive —
 *  see rule 4. Returns whole percent. */
function cagr(latest: Num, earliest: Num, years: number): number | null {
  const a = num(latest);
  const b = num(earliest);
  if (a === null || b === null || b <= 0 || a <= 0 || years <= 0) return null;
  return (Math.pow(a / b, 1 / years) - 1) * 100;
}

const pct = (v: number): string => `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(0)}%`;

/** "2026-03-31" → "FY26". Non-March year-ends (20 symbols close in December)
 *  are labelled by calendar year instead, because calling a December 2025
 *  close "FY26" would be wrong for them. */
function periodLabel(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  if (!Number.isFinite(y)) return iso;
  if (m === 3) return `FY${String(y).slice(2)}`;
  return `${iso.slice(0, 7)}`;
}

/** Equity = share capital + reserves. Null if either is missing: a net worth
 *  computed from half the inputs is a wrong number, not a partial one. */
function equityOf(r: AnnualRow): number | null {
  const sc = num(r.equity_share_capital);
  const res = num(r.reserves);
  if (sc === null || res === null) return null;
  return sc + res;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param annual  newest-first annual rows (pass 11 to get a clean 10-year span)
 * @param shares  newest-first shareholding quarters
 * @param sector  app.universe.sector — only used to skip leverage checks
 */
export function assessBusiness(
  annual: AnnualRow[],
  shares: ShareRow[],
  sector: string | null,
  industry: string | null = null,
): BusinessHealth {
  const pros: HealthCheck[] = [];
  const cons: HealthCheck[] = [];
  const rows = annual.filter((r) => !!r.period_end);
  const latest = rows[0] ?? null;
  const isFinancial = (sector ?? "").trim().toLowerCase() === "financial services";

  // SECTOR IS TOO COARSE TO SET A THRESHOLD ON, and finding that out cost a
  // round of wrong bullets. "Financial Services" is 293 active symbols and five
  // unlike businesses: Finance/NBFC 177, Capital Markets 52, Banks 41,
  // Insurance 13, Fintech 10. Their median return on assets runs 1.00% for
  // banks, 2.29% for NBFCs and 6.53% for capital markets — a broker is
  // asset-light, so the ratio is not large because it is good. The first cut of
  // the ROA check used a single 1.5% bar across the sector and fired on 169 of
  // 293 (58%), which is the growth-threshold mistake repeated one file later.
  //
  // So the sector still decides what to SKIP — that judgement holds for anyone
  // whose balance sheet is other people's money — but only the industry decides
  // what to MEASURE, and it is measured against that industry's own quartiles.
  const ind = (industry ?? "").trim().toLowerCase();
  const isBank = isFinancial && ind === "banks";
  const isNbfc = isFinancial && ind === "finance";

  const out: BusinessHealth = {
    pros,
    cons,
    latestPeriod: latest ? periodLabel(latest.period_end) : null,
    years: rows.length,
    leverageSkipped: isFinancial,
  };
  if (!latest) return out;

  // The comparison base for every growth check. Five years back if we have it,
  // otherwise three — never fewer, because a two-year CAGR is noise wearing the
  // costume of a trend. `span` is the real gap, so the sentence never claims
  // five years of history the data does not have.
  const idx = rows.length > 5 ? 5 : rows.length > 3 ? 3 : -1;
  const base = idx > 0 ? rows[idx] : null;
  const span = idx;

  // ── Is the latest profit even the business's own? ───────────────────────
  // Vodafone Idea's FY26: operating profit 18,859 cr, OTHER income 59,292 cr,
  // net profit 34,552 cr — the AGR dues conversion, a one-off, booked below the
  // operating line. Read naively that is a spectacular turnaround from five
  // years of losses, and the first version of this file duly printed "Back in
  // profit" as a green bullet for a company whose core operations did not
  // change. Other income exceeding operating profit is the direct, unambiguous
  // tell, so it is checked FIRST and used to gate the two bullets that would
  // otherwise be read off the flattered number.
  //
  // NOT for lenders. For a bank "other income" is fees, treasury and forex —
  // core banking revenue that simply sits below the interest line. HDFC Bank
  // and ICICI Bank both tripped this and were told most of their FY26 profit
  // came from outside the core business, which is the opposite of true. The
  // signal is real for a manufacturer and meaningless for a bank, so the test
  // does not run rather than running at a re-tuned threshold: there is no
  // threshold that makes fee income a one-off.
  const opLatestRaw = num(latest.operating_profit);
  const oiLatest = num(latest.other_income);
  const flattered =
    !isFinancial &&
    opLatestRaw !== null &&
    opLatestRaw > 0 &&
    oiLatest !== null &&
    oiLatest > opLatestRaw &&
    (num(latest.net_profit) ?? 0) > 0;
  if (flattered) {
    cons.push({
      id: "non-operating",
      kind: "con",
      text: `Most of ${periodLabel(latest.period_end)} profit came from outside the core business`,
    });
  }

  // ── Growth ──────────────────────────────────────────────────────────────
  if (base) {
    // Thresholds set from the UNIVERSE's own distribution, not from a
    // remembered rule of thumb. Measured over the 2,290 symbols with a usable
    // five-year sales pair: p25 6.4%, MEDIAN 13.9%, p75 23.8%. A "strong
    // growth" bar of 15% — which is what this shipped with first — is the 52nd
    // percentile, so half the exchange earned a green bullet and the bullet
    // meant nothing. 22% is roughly p75. The FY21 COVID base is the reason the
    // median is that high: every five-year window currently starts in a
    // depressed year, which lifts the whole distribution. A fixed bar would
    // have silently absorbed that; a percentile-anchored one does not.
    const sg = cagr(latest.sales, base.sales, span);
    if (sg !== null) {
      if (sg >= 22) pros.push({ id: "sales-up", kind: "pro", text: `Sales compounded ${pct(sg)} a year over ${span} years` });
      else if (sg < 6) cons.push({ id: "sales-flat", kind: "con", text: `Sales grew only ${pct(sg)} a year over ${span} years` });
    }

    // Profit, same exercise over 1,636 usable pairs: p25 2.7%, median 16.6%,
    // p75 35.3%. 30% ≈ p70; the 3% floor is almost exactly p25.
    const pg = cagr(latest.net_profit, base.net_profit, span);
    if (pg !== null) {
      if (pg >= 30) pros.push({ id: "profit-up", kind: "pro", text: `Profit compounded ${pct(pg)} a year over ${span} years` });
      else if (pg < 3) cons.push({ id: "profit-flat", kind: "con", text: `Profit grew only ${pct(pg)} a year over ${span} years` });
    } else {
      // cagr() refused the pair. Say which end broke it rather than going
      // silent — "was loss-making N years ago" is itself information.
      const np = num(latest.net_profit);
      const bp = num(base.net_profit);
      if (np !== null && bp !== null && bp <= 0 && np > 0 && !flattered) {
        pros.push({ id: "turnaround", kind: "pro", text: `Back in profit — was loss-making ${span} years ago` });
      } else if (np !== null && bp !== null && bp > 0 && np <= 0) {
        cons.push({ id: "into-loss", kind: "con", text: `Now loss-making — was profitable ${span} years ago` });
      }
    }
  }

  // ── Margin: latest vs its own history, not vs an absolute bar ───────────
  // A 6% operating margin is healthy for a distributor and alarming for a
  // software company, so there is no cross-sector threshold worth writing. The
  // comparison is against the company's OWN median, where the sector cancels.
  //
  // The coherence guard is not theoretical. 284 of 2,592 symbols (11%) carry a
  // NEGATIVE operating_profit alongside a healthy positive net_profit in their
  // latest year — TITAN reads −11,515 on sales of 87,584 with a profit of
  // 5,073, which is not a business condition, it is a broken field. Other
  // income cannot bridge a gap that size. Without this guard the card told a
  // Titan holder their operating margin was −13%, in the same typeface as the
  // numbers that are right. A field that is wrong 11% of the time is not a
  // field you quietly average; the row is dropped and the check goes silent.
  const opmOf = (r: AnnualRow): number | null => {
    const s = num(r.sales);
    const op = num(r.operating_profit);
    const np = num(r.net_profit);
    if (s === null || op === null || s <= 0) return null;
    if (op < 0 && np !== null && np > 0) return null; // incoherent — see above
    return (op / s) * 100;
  };
  //
  // Lenders are excluded outright. A bank's "sales" is interest income and its
  // operating profit is that minus operating expense, so the ratio is a
  // cost-to-income figure wearing a margin's name — 68% for Karur Vysya, which
  // reads as a spectacular manufacturer and means nothing of the kind. It also
  // tracks the rate cycle rather than the business. Cost-to-income, computed
  // below, is the same arithmetic reported honestly.
  const opmLatest = isFinancial ? null : opmOf(latest);
  const opmHist = isFinancial ? [] : rows.slice(1, 6).map(opmOf).filter((v): v is number => v !== null);
  if (opmLatest !== null && opmHist.length >= 3) {
    const med = median(opmHist)!;
    const d = opmLatest - med;
    if (d >= 2) pros.push({ id: "margin-up", kind: "pro", text: `Operating margin ${opmLatest.toFixed(0)}%, up from a ${med.toFixed(0)}% norm` });
    else if (d <= -2) cons.push({ id: "margin-down", kind: "con", text: `Operating margin ${opmLatest.toFixed(0)}%, down from a ${med.toFixed(0)}% norm` });
  }

  // ── Returns ─────────────────────────────────────────────────────────────
  const eq = equityOf(latest);
  const npLatest = num(latest.net_profit);
  if (eq !== null && npLatest !== null) {
    if (eq <= 0) {
      cons.push({ id: "negative-networth", kind: "con", text: "Negative net worth — accumulated losses exceed capital" });
    } else {
      // ROE across 2,457 symbols with positive net worth: p25 3.6%, median
      // 9.4%, p75 15.0%. 18% is ≈p80 and stays. The weak-ROE floor moved from
      // 8% (≈p42 — it fired on 41 of a 149-symbol sample, i.e. on the merely
      // average) down to 5%, which is genuinely the bottom third.
      const roe = (npLatest / eq) * 100;
      // Gated on `flattered` for the same reason as the turnaround bullet: a
      // one-off gain divided by equity is a high ROE that will not repeat.
      if (roe >= 18 && !flattered) pros.push({ id: "roe-high", kind: "pro", text: `Return on equity ${roe.toFixed(0)}%` });
      else if (roe < 5 && roe >= 0) cons.push({ id: "roe-low", kind: "con", text: `Return on equity only ${roe.toFixed(0)}%` });
    }
  }
  if (npLatest !== null && npLatest < 0) {
    cons.push({ id: "loss", kind: "con", text: `Loss-making in ${out.latestPeriod ?? "the latest year"}` });
  }

  // ── Lenders: the two measures that survive a borrowed balance sheet ─────
  // Everything a bank looks bad or brilliant at under the checks above is an
  // artefact of the business model — it borrows for a living, its revenue IS
  // interest, and its cash flow IS the loan book moving. Rather than abstain
  // on all four and leave a near-empty card, two measures run instead. They
  // are chosen for being computable from what we already store: total_assets
  // is populated for all 293 financials, expenses for 288.
  //
  // ROA, not ROE. Leverage is what makes a bank's ROE look like a great
  // company's, so ROE flatters every lender equally and discriminates between
  // none of them. Return on ASSETS is the measure the RBI, the rating agencies
  // and any bank analyst actually use.
  //
  // Two different bands, because banks and NBFCs are not the same trade. Bank
  // ROA across the 41 listed: p25 0.74%, median 1.00%, p75 1.25% — so 1.5% is
  // genuinely top-decile (Karur Vysya 1.84%, ICICI 1.86%, HDFC 1.55%). NBFC ROA
  // across 177: p25 0.68%, median 2.29%, p75 4.00% — they lend at higher
  // spreads on less leverage, so the same 1.5% bar would be a participation
  // trophy and the top-quartile line is 4%.
  //
  // Capital Markets, Insurance and Fintech get NEITHER check. A broker or an
  // AMC holds almost no assets against its earnings, so its ROA is arithmetic
  // rather than performance; an insurer's expense line is claims. Their cards
  // fall back to growth, returns, dividend and ownership, which is thinner but
  // not wrong — and thin beats confident and wrong.
  //
  // What is still missing, and worth saying plainly: NIM, GNPA/NNPA, provision
  // coverage, CASA and capital adequacy are the measures that would actually
  // tell you whether a bank is healthy, and this table holds none of them.
  // These two are the honest subset, not a complete picture.
  if (isBank || isNbfc) {
    const ta = num(latest.total_assets);
    if (npLatest !== null && ta !== null && ta > 0) {
      const roa = (npLatest / ta) * 100;
      const strong = isBank ? 1.5 : 4.0;
      const weak = isBank ? 0.5 : 0.7;
      const what = isBank ? "a bank" : "a lender";
      if (roa >= strong) pros.push({ id: "roa-high", kind: "pro", text: `Return on assets ${roa.toFixed(2)}% — strong for ${what}` });
      else if (roa > 0 && roa < weak) cons.push({ id: "roa-low", kind: "con", text: `Return on assets only ${roa.toFixed(2)}%` });
    }
  }
  // Cost-to-income: operating expense over total income (interest + other).
  // The denominator has to include other income, because fee and treasury
  // revenue pays for the same branch network — omitting it would overstate the
  // ratio for exactly the banks that earn most of their fees.
  //
  // BANKS ONLY. NBFC cost-to-income runs p25 21.8% to p75 74.6%, a spread that
  // wide is a sign the inputs are not comparable across the group rather than a
  // sign the group varies that much — interest expense lands in different lines
  // for different filers. A ratio you cannot compare is not a ratio worth
  // printing. Bank quartiles are tight by comparison (p25 26.9%, p75 47.2%) and
  // the thresholds below are exactly those, so this fires on a quarter of banks
  // in each direction by construction.
  if (isBank) {
    const exp = num(latest.expenses);
    const salesLatest = num(latest.sales);
    if (exp !== null && salesLatest !== null && oiLatest !== null) {
      const income = salesLatest + oiLatest;
      if (income > 0 && exp >= 0) {
        const cti = (exp / income) * 100;
        if (cti <= 27) pros.push({ id: "cost-income-low", kind: "pro", text: `Spends ${cti.toFixed(0)}% of income running the bank — lean` });
        else if (cti >= 47) cons.push({ id: "cost-income-high", kind: "con", text: `Spends ${cti.toFixed(0)}% of income just running the bank` });
      }
    }
  }

  // ── Leverage (skipped for financials, rule 3) ───────────────────────────
  if (!isFinancial) {
    const borr = num(latest.borrowings);
    if (borr !== null && eq !== null && eq > 0) {
      const de = borr / eq;
      if (de <= 0.1) pros.push({ id: "debt-free", kind: "pro", text: `Almost debt-free — borrowings are ${(de * 100).toFixed(0)}% of net worth` });
      else if (de >= 1.5) cons.push({ id: "debt-high", kind: "con", text: `Borrowings are ${de.toFixed(1)}× net worth` });
    }
    // Interest cover only makes sense when there IS interest to cover; at
    // interest = 0 the ratio is infinite and the debt-free bullet above has
    // already said the useful thing.
    const intr = num(latest.interest);
    const pbt = num(latest.profit_before_tax);
    if (intr !== null && intr > 0 && pbt !== null) {
      const cover = (pbt + intr) / intr;
      if (cover < 2.5) {
        cons.push({ id: "interest-cover", kind: "con", text: `Profit covers interest only ${cover.toFixed(1)}× — thin cushion` });
      }
    }
  }

  // ── Cash conversion — the one that catches profits that are not real ────
  // Summed over the window rather than taken year by year: a single year's
  // working-capital swing is normal and would fire this constantly. Five years
  // of profit that never arrives as cash is the actual signal.
  //
  // Skipped for lenders, and this was the most misleading of the four. A bank's
  // operating cash flow is deposits and loan-book movement, not earnings
  // quality: Bajaj Finance scored −416% and was told its profit never arrived
  // as cash, when what the number describes is a loan book growing. Karur Vysya
  // scored 107% and was awarded a green tick for the same non-fact. A check
  // that hands out both a reward and a punishment for the same neutral
  // behaviour is worse than no check.
  if (!isFinancial && base && span >= 3) {
    const win = rows.slice(0, span);
    const cfos = win.map((r) => num(r.cash_from_operating));
    const nps = win.map((r) => num(r.net_profit));
    if (!cfos.includes(null) && !nps.includes(null)) {
      const sumCfo = (cfos as number[]).reduce((a, b) => a + b, 0);
      const sumNp = (nps as number[]).reduce((a, b) => a + b, 0);
      if (sumNp > 0) {
        const conv = (sumCfo / sumNp) * 100;
        if (conv < 60) cons.push({ id: "cash-poor", kind: "con", text: `Only ${pct(conv)} of ${span}-year profit came through as operating cash` });
        else if (conv >= 100) pros.push({ id: "cash-good", kind: "pro", text: `Operating cash is ${pct(conv)} of ${span}-year profit` });
      }
    }
  }

  // ── Dilution: DELIBERATELY NOT CHECKED ──────────────────────────────────
  // A share-count check was written, tested, and removed. `no_of_equity_shares`
  // rises for three reasons that this table cannot tell apart:
  //   • a fresh issue, which genuinely dilutes existing holders;
  //   • a BONUS issue, which capitalises reserves and dilutes nobody;
  //   • a stock SPLIT, which changes nothing but the face value.
  // On a six-name spot check it flagged Reliance ("share count up 100% — holders
  // diluted") for a 1:1 bonus and HDFC Bank ("up 179%") for the HDFC merger.
  // Both are wrong, and both are wrong about the largest companies on the
  // exchange, where a reader is most likely to know better and stop trusting
  // the rest of the card. Distinguishing the three needs the corporate-action
  // history (app.corporate_action), not the balance sheet — until this reads
  // that, it stays out. An absent bullet costs nothing; a confidently wrong one
  // costs the credibility of the four bullets next to it.

  // ── Dividend: only counts as a pro if it is a RECORD, not one payment ───
  {
    const win = rows.slice(0, Math.min(5, rows.length));
    const paid = win.filter((r) => (num(r.dividend_amount) ?? 0) > 0).length;
    const npSum = win.map((r) => num(r.net_profit) ?? 0).reduce((a, b) => a + b, 0);
    const divSum = win.map((r) => num(r.dividend_amount) ?? 0).reduce((a, b) => a + b, 0);
    if (win.length >= 4 && paid === win.length && npSum > 0) {
      const payout = (divSum / npSum) * 100;
      if (payout >= 15) {
        pros.push({ id: "dividend", kind: "pro", text: `Paid a dividend every year for ${win.length} years — ${pct(payout)} of profit` });
      }
    }
  }

  // ── Ownership ───────────────────────────────────────────────────────────
  const shareRows = shares.filter((s) => s.period_end);
  const sLatest = shareRows[0] ?? null;
  const sOld = shareRows.length >= 4 ? shareRows[Math.min(shareRows.length - 1, 7)] : null;
  if (sLatest && sOld) {
    const a = num(sLatest.promoter_pct);
    const b = num(sOld.promoter_pct);
    if (a !== null && b !== null) {
      const d = a - b;
      // 2pp, not any movement: creeping-acquisition rules and ESOP issuance
      // move promoter stake by fractions of a point every year without meaning
      // anything. Two points over two years is a decision someone made.
      if (d <= -2) cons.push({ id: "promoter-down", kind: "con", text: `Promoters cut their stake from ${b.toFixed(0)}% to ${a.toFixed(0)}%` });
      else if (d >= 1) pros.push({ id: "promoter-up", kind: "pro", text: `Promoters raised their stake from ${b.toFixed(0)}% to ${a.toFixed(0)}%` });
    }
  }
  if (sLatest) {
    const pl = num(sLatest.pledge_pct);
    // Only ever a con. The absence of a pledge is the normal case and saying
    // "shares not pledged" as a positive would pad every card in the universe.
    if (pl !== null && pl >= 10) {
      cons.push({ id: "pledge", kind: "con", text: `${pl.toFixed(0)}% of promoter holding is pledged` });
    }
  }

  return out;
}
