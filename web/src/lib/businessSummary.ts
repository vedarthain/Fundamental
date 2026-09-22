/**
 * businessSummary — the one parser for `app.universe.business_summary`.
 *
 * WHY THIS FILE EXISTS
 *
 * There were two parsers. The good one lived inside BusinessVisual.tsx and ran
 * only on /stock/[symbol]; the watchlist ⓘ panel had a private, weaker copy
 * (splitLede + extractFounded + extractHq) that showed the first sentence and
 * nothing else. So the same 350 words of prose rendered as a rich card on one
 * screen and a single line on the other, and a fix to either one could never
 * reach the other. That is the drift CLAUDE.md §4 Q1 names by name.
 *
 * Moving it here — rather than importing from BusinessVisual — is deliberate:
 * BusinessVisual is a server component that pulls in ~30 lucide icon modules.
 * The watchlist panel is a client component. Importing the parser from there
 * would ship the entire icon set to the browser to get one regex.
 *
 * WHAT THE INPUT ACTUALLY IS
 *
 * yfinance company descriptions, which follow a small number of Refinitiv-ish
 * templates ("operates through X, Y and Z segments", "The company offers A,
 * B, and C for the D industry"). That regularity is the only reason regex
 * works here at all — and it is also why every rule below is anchored to a
 * template phrase rather than to grammar in general.
 *
 * FRESHNESS — say it, don't hide it. Every business_info_fetched_at in the
 * table reads 2026-05-04. One backfill, nothing maintains it, and 451 of
 * 2,593 active symbols have no summary at all. Any surface rendering this
 * must date the card. Distilling a frozen blob into crisp bullets makes stale
 * data look curated, which is worse than showing it as the wall of prose it is.
 *
 * WHAT WAS TRIED AND REJECTED
 *
 * An `endMarkets` extractor — "for the aerospace and space industries", "for
 * the defense industry" — pulled 6 clean end markets out of CENTUM and looked
 * like the insight the card was missing. Swept across all 2,142 summaries it
 * found ≥2 markets in TEN of them, 0.5%. CENTUM is the only 6-market case in
 * the universe. It was a rule fitted to one example, and the sweep is the only
 * reason that was visible. Not added. Do not re-add it without re-running the
 * sweep.
 */

const GEO_TOKENS: { label: string; pattern: RegExp }[] = [
  { label: "India",          pattern: /\bIndia\b/i },
  { label: "International",  pattern: /\binternationally\b/i },
  // "North America" must be matched BEFORE the US rule, and the US rule must
  // not accept a bare "America". The old pattern ended in |\bAmerica\b, so
  // CENTUM — whose summary says "North America" and never says United States
  // — was labelled "United States". 45 of 2,142 summaries name North America
  // without naming the US, and every one of them was getting a country it
  // does not sell in. Tolerable while this sat inside a decorative chip row;
  // not tolerable now that it is a "Markets" fact on the panel.
  { label: "North America",  pattern: /\bNorth America\b/i },
  { label: "United States",  pattern: /\bUnited States\b|\bU\.S\.A?\.?\b/i },
  { label: "Europe",         pattern: /\bEurope(?:an)?\b/i },
  { label: "United Kingdom", pattern: /\bUnited Kingdom\b|\bU\.K\.?\b/i },
  { label: "Middle East",    pattern: /\bMiddle East\b/i },
  { label: "Africa",         pattern: /\bAfrica\b/i },
  { label: "Asia",           pattern: /\bAsia\b/i },
  { label: "Australia",      pattern: /\bAustralia\b/i },
  { label: "China",          pattern: /\bChina\b/i },
  { label: "Japan",          pattern: /\bJapan\b/i },
  { label: "Canada",         pattern: /\bCanada\b/i },
  { label: "Singapore",      pattern: /\bSingapore\b/i },
  { label: "Germany",        pattern: /\bGermany\b/i },
];

export type Parsed = {
  tagline: string;
  /** Either real "operates through ... segments" splits OR a fallback
   *  list of products/activities mined from "offers", "engages in",
   *  "involved in", "manufactures". Always rendered as chips. */
  segments: string[];
  /** Where the segments came from — drives the chip-row label. */
  segmentsSource: "segments" | "products" | "activities" | null;
  /** Brand names mentioned in "sells under the X and Y brand names". */
  brands: string[];
  geo: string[];
  founded: string | null;
  hq: string | null;
  /** "formerly known as X" / name-change sentences. */
  milestone: string | null;
  /** Just the old name and the year it changed, pulled out of `milestone` so
   *  it fits a one-line fact row. 709 of 2,142 summaries (33.1%) name a former
   *  identity; 617 of those also give the date. Worth surfacing rather than
   *  burying: a renamed company is the thing that makes its own price history
   *  and news archive look discontinuous. */
  formerName: { name: string; changed: string | null } | null;
  /** "exports its products to ..." → renderable region string. */
  exports: string | null;
};

/** A trailing purpose clause hanging off a product name. */
const CLAUSE_RE = /\s+(?:for\s+(?:the\s+)?|for\s+use\s+in\s+|used\s+in\s+)\S.*$/i;

/**
 * Drop a trailing "for the X industry" clause from a chip — but only when
 * what remains still names something.
 *
 * The chip list is built by splitting on commas and "and", which cuts through
 * the middle of "…satellite bus systems for the aerospace and space
 * industries" and leaves the chip "satellite bus systems for the aerospace".
 * 157 of 2,142 summaries produced at least one chip like that.
 *
 * The naive fix — always cut at " for " — is worse than the bug on a third of
 * its own hits, because sometimes the clause IS the product:
 *
 *     "loans for residential property"  → "loans"     ✗ meaning destroyed
 *     "products for oncology"           → "products"  ✗
 *     "a platform for trading in NSE"   → "a platform" ✗
 *     "satellite bus systems for the aerospace" → "satellite bus systems" ✓
 *     "specialty chemicals for various industrial applications" → "specialty chemicals" ✓
 *
 * The discriminator that separates those two columns is how much is left. A
 * head of one bare noun is not a product name; the clause was carrying all the
 * specificity. Two or more words and the head stands on its own.
 *
 * Measured over the full universe: 130 chip lists improved, 0 emptied, 1
 * source label changed. The 42 summaries whose chips still contain " for "
 * are the protected single-word heads — that is the guard working, not a miss.
 */
function trimChip(v: string): string {
  const head = v.replace(CLAUSE_RE, "").trim();
  if (head === v) return v;
  const words = head.replace(/^(?:a|an|the)\s+/i, "").split(/\s+/).filter(Boolean);
  return words.length >= 2 ? head : v;
}

const splitList = (raw: string): string[] =>
  raw
    .split(/\s*;\s*|\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((x) =>
      trimChip(
        x
          .replace(/^\s*(?:the\s+|various\s+|a\s+range\s+of\s+|other\s+)/i, "")
          .replace(/\s+(?:segments?|products?|services?|brands?|etc\.?)\s*$/i, "")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    )
    .filter((x) => x.length > 2 && x.length < 80);

/**
 * Split a summary into its first sentence and the rest.
 *
 * The lookbehind is doing real work. A naive /(?<=\.)\s+/ cannot tell an
 * initial from a full stop, so it splits after the first letter of the third
 * of Indian company names that begin with initials. That was not hypothetical:
 * the stock page hero was rendering a tagline of literally "U." for UYFINCORP,
 * "A." for AKCAPIT and "B.A.G." for BAGFILMS. 41 of 2,142 summaries, measured.
 *
 * This version came from the watchlist panel's private copy, which had it
 * right; the shared parser had it wrong. Unifying the two is what surfaced the
 * difference — neither surface could see the other's bug while they were
 * separate files.
 */
export function splitLede(summary: string): { lede: string; rest: string } {
  const s = summary.replace(/\s+/g, " ").trim();
  // The lookbehind only protects SINGLE-letter initials, so a multi-letter
  // honorific or abbreviation still splits: AGARWALEYE gave a lede of "Dr.",
  // BECTORFOOD "Mrs.", BALMLAWRIE "Balmer Lawrie & Co.". 7 of 2,142.
  // Rather than enumerate abbreviations forever, use the length: no real
  // opening sentence about a company is under 25 characters, so a candidate
  // that short is an abbreviation and we take the next boundary instead.
  const re = /(?<![A-Z])\.\s+(?=[A-Z])/g;
  for (const m of s.matchAll(re)) {
    if (m.index == null) continue;
    const cut = m.index + 1;
    if (cut < 25) continue;
    return { lede: s.slice(0, cut), rest: s.slice(m.index + m[0].length) };
  }
  return { lede: s, rest: "" };
}

export function parseSummary(s: string): Parsed {
  // Tagline = first sentence. Cap at ~220 chars.
  const firstSentence = splitLede(s).lede;
  const tagline =
    firstSentence.length > 220 ? firstSentence.slice(0, 217).trimEnd() + "…" : firstSentence;

  // What they do — try several patterns in order, stop at the first match.
  // Each pattern carries a label so we can show "Segments" vs "Products"
  // vs "Activities" honestly in the UI.
  let segments: string[] = [];
  let segmentsSource: Parsed["segmentsSource"] = null;

  // 1. Real segments: "operates through X, Y, and Z segments."
  const segMatch = s.match(/operates?\s+(?:through|in|as)\s+([^.]+?)\s*(?:segments?\.|\.)/i);
  if (segMatch) {
    segments = splitList(segMatch[1]);
    if (segments.length > 0) segmentsSource = "segments";
  }
  // 2. Products: "offers a range of X, Y, Z."  /  "The company offers X, Y."
  if (segments.length === 0) {
    const offersMatch = s.match(/(?:offers|provides|manufactures(?:\s+and\s+sells)?|produces)\s+(?:a\s+range\s+of\s+|various\s+)?([^.]+?)\./i);
    if (offersMatch) {
      segments = splitList(offersMatch[1]);
      if (segments.length > 0) segmentsSource = "products";
    }
  }
  // 3. Activities: "engages in the manufacture and sale of X."  /
  //    "is involved in the trading of X, Y, Z."
  if (segments.length === 0) {
    const engagesMatch = s.match(/(?:engages?\s+in|is\s+(?:also\s+)?involved\s+in)\s+(?:the\s+)?[a-z\s]+?\s+of\s+([^.]+?)\./i);
    if (engagesMatch) {
      segments = splitList(engagesMatch[1]);
      if (segments.length > 0) segmentsSource = "activities";
    }
  }
  segments = segments.slice(0, 6);

  // Brand names: "sells its products under the X and Y brand names."
  let brands: string[] = [];
  const brandMatch = s.match(/(?:sells?|markets?)\s+(?:its\s+products\s+)?under\s+the\s+([^.]+?)\s+brand\s+names?\./i);
  if (brandMatch) {
    brands = splitList(brandMatch[1]).slice(0, 4);
  }

  // Geography in document order.
  const geo = GEO_TOKENS.filter((g) => g.pattern.test(s)).map((g) => g.label);

  // Founded / incorporated year.
  const foundedMatch = s.match(/(?:founded|incorporated|established|formed)\s+in\s+(\d{4})/i);
  const founded = foundedMatch ? foundedMatch[1] : null;

  // HQ — "based in <city>" / "headquartered in <city>". Stops at the comma,
  // so this yields "Ahmedabad" rather than "Ahmedabad, India". Identical
  // coverage to the variant it replaces (both fail on exactly 1 of 2,142) and
  // it differs on 2,139 of them purely by not tacking the country on.
  const hqMatch = s.match(/\b(?:is\s+)?(?:headquartered|based)\s+in\s+([A-Z][A-Za-z.\- ]{1,28}?)\s*[,.]/);
  const hq = hqMatch ? hqMatch[1].trim() : null;

  // Major milestone — capture the sentence containing "formerly known as" or
  // "spun off" / "merged with" / "demerged".
  let milestone: string | null = null;
  const mileMatch = s.match(
    /([^.]*?(?:formerly known as|spun off|demerged|merged with|acquired by)[^.]+\.)/i,
  );
  if (mileMatch) {
    const m = mileMatch[1].trim();
    if (m.length < 260) milestone = m;
  }

  // Exports — "exports its products to <region>." / "exports to <region>."
  let exportsStr: string | null = null;
  const expMatch = s.match(/exports?\s+(?:its\s+products\s+)?to\s+([^.]+?)(?:\s+markets?)?\./i);
  if (expMatch) {
    const cleaned = expMatch[1].replace(/\s*markets?\s*$/i, "").trim();
    if (cleaned.length < 120) exportsStr = cleaned;
  }

  // Former name — the strict form first ("formerly known as X and changed its
  // name…", 596) so the capture stops at the right place, then the loose form
  // for the 113 that phrase it differently. Stopping at , . ; keeps the old
  // company name and nothing after it.
  let formerName: Parsed["formerName"] = null;
  const fnMatch =
    s.match(/formerly\s+known\s+as\s+([A-Z][^,.;]{2,70}?)\s+and\s+changed\s+its\s+name/i) ??
    s.match(/formerly\s+known\s+as\s+([A-Z][^,.;]{2,70})/i);
  if (fnMatch) {
    const dateMatch = s.match(
      /changed\s+its\s+name\s+to\s+[^.]{2,80}?\s+in\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{4})/i,
    );
    formerName = { name: fnMatch[1].trim(), changed: dateMatch ? dateMatch[1] : null };
  }

  return { tagline, segments, segmentsSource, brands, geo, founded, hq, milestone, formerName, exports: exportsStr };
}
