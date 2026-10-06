/**
 * Headline clustering for /news. Same story across outlets should read as
 * one card with a related count — not ten near-copies.
 *
 * Wire lanes (Market / Economy / Policy / Others) use a looser same-day
 * fold; Watchlist keeps a tighter match so distinct events on one name
 * do not collapse into a single row.
 */

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "its",
  "into", "after", "over", "amid", "say", "says", "will", "has", "have",
  "been", "than", "also", "just", "more", "about",
]);

const BOILER_RE =
  /\b(today|latest|breaking|exclusive|live|updates?|highlights?|wrap(?:-?up)?|closing bell)\b/gi;

/** Same templates watchlist extras already drop — price tickers, not stories. */
export const LIVE_NOISE_RE =
  /((?:share|stock) price live update)|((?:sensex|nifty|stock market|market crash).{0,40}live update)|\bstock\s+market\s+live\b|\blive (?:blog|updates?:)|\bmarkets? (?:today|wrap|highlights)\b|\bclosing bell\b/i;

export function isNoiseHeadline(title: string): boolean {
  return LIVE_NOISE_RE.test(title);
}

/**
 * Buy/sell tips and price-progress tickers — not news. Display-time
 * defence for rows that already landed in `app.news`. Keep the
 * alternation list in sync with `RECO_RE` in `scripts/fetch-news.py`.
 *
 * Deliberately does not match "stock in focus": that phrase tags a
 * real corporate story as often as a tip list, and ingest was written
 * to leave those through.
 */
const TIP_OR_PROGRESS_RE = new RegExp(
  [
    String.raw`\b(?:stocks?|shares?)\s+to\s+(?:buy|sell|bet|grab|add|watch)\b`,
    String.raw`\b\d+\s+(?:stocks?|shares?)\s+to\s+(?:buy|sell|bet|grab|add|watch)\b`,
    String.raw`\brecommends?\s+(?:\w+\s+){0,3}(?:stocks?|shares?)\s+to\s+(?:buy|sell)\b`,
    String.raw`\btop\s+(?:stock\s+)?picks?\b`,
    String.raw`\bstock\s+picks?\b`,
    String.raw`\bbuy\s+or\s+sell\b`,
    String.raw`\bshould\s+you\s+(?:buy|sell|invest|subscribe|apply)\b`,
    String.raw`\bmulti-?bagger\w*`,
    String.raw`\bstock\s+tips?\b`,
    String.raw`\b(?:stock|share)\s+recommendations?\b`,
    String.raw`\btrade\s+setups?\b`,
    String.raw`\btrading\s+guide\b`,
    String.raw`\bf&o\s+(?:strateg|pick|trade)\w*`,
    String.raw`\bintraday\s+(?:pick|tip|trade|levels?)\b`,
    String.raw`\bbuy\s+this\s+stock\b`,
    String.raw`\bbest\s+(?:stocks?|shares?)\s+to\b`,
    String.raw`\bhot\s+stocks?\b`,
    String.raw`\bstock\s+of\s+the\s+day\b`,
    String.raw`\bwhat\s+to\s+(?:buy|sell|trade)\b`,
    String.raw`\bportfolio\s+picks?\b`,
    String.raw`\bnifty\s+prediction\b`,
    String.raw`\btop\s+(?:gainer|loser|performer)s?\b`,
    String.raw`\b(?:gainers?|losers?)\s+today\b`,
    String.raw`\bmost\s+active\s+stocks?\b`,
    String.raw`\bgrey\s+market\b`,
    String.raw`\bgmp\b`,
    String.raw`\blisting\s+gains?\b`,
    String.raw`\b(?:share|stock)\s+price\s+(?:live|today|update|latest)\b`,
    String.raw`\bstock\s+market\s+live\b`,
    String.raw`\bwhat\s+should\s+investors?\b`,
    String.raw`\bbest\s+ipo\b`,
    String.raw`\bstocks?\s+in\s+news\b`,
    String.raw`\bbuy\s+rating\b`,
    String.raw`\bsell\s+rating\b`,
    String.raw`\btechnical\s+(?:view|analysis|breakout|outlook)\b`,
  ].join("|"),
  "i",
);

export function isTipOrProgressHeadline(
  title: string,
  summary?: string | null,
): boolean {
  return TIP_OR_PROGRESS_RE.test(`${title} ${summary ?? ""}`);
}

/** Drop live-ticker noise and tip/progress headlines at display time. */
export function dropDisplayHeadline(
  title: string,
  summary?: string | null,
): boolean {
  return isNoiseHeadline(title) || isTipOrProgressHeadline(title, summary);
}

/** Normalised title key — case/punctuation/whitespace-insensitive so the
 *  same story syndicated across sources collapses to one row. */
export function newsTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Per-stock feed: drop tip/progress/live noise, then de-duplicate by
 * normalised title (keeping the first, so callers should pass newest-first).
 * Used by /stock/[symbol], /api/watchlist/extras, and anything else that
 * shows "news for this name" — one filter, one list.
 */
export function cleanStockNews<T extends { title: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const n of rows) {
    if (!n.title || dropDisplayHeadline(n.title, null)) continue;
    const key = newsTitleKey(n.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/**
 * Price-progress tickers that only look like news because they mention
 * Nifty/Sensex/IPO. Applied to the Market lane after classify — the same
 * wording on a company story ("share price falls after FSSAI action")
 * stays in Others.
 */
const MARKET_PROGRESS_RE = new RegExp(
  [
    String.raw`\b(?:share|stock)\s+price\s+(?:rises?|falls?|jumps?|tanks?|surges?|gains?|hits|tumbles?|rally|prediction)\b`,
    String.raw`\bwhat\s+is\s+driving\b.{0,60}\bshare\s+price\b`,
    String.raw`\bdoubled\s+investors['’]?\s+money\b`,
  ].join("|"),
  "i",
);

export function isMarketProgressHeadline(
  title: string,
  summary?: string | null,
): boolean {
  return MARKET_PROGRESS_RE.test(`${title} ${summary ?? ""}`);
}

export function titleTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(BOILER_RE, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function dayKey(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

type Clusterable = {
  title: string;
  symbols?: string[];
  related?: number;
  published_at?: string | null;
};

function mergeInto<T extends Clusterable>(rep: T & { related: number }, r: T): void {
  rep.related += 1 + (r.related ?? 0);
  if (r.symbols?.length) {
    const u = new Set([...(rep.symbols ?? []), ...r.symbols]);
    rep.symbols = [...u];
  }
}

/**
 * Keep the first (most recent, if rows are newest-first) of each near-dup
 * cluster. `sameDay` folds weaker overlaps that landed on the same calendar
 * day — used on the wires, not on Watchlist.
 */
export function clusterByTitle<T extends Clusterable>(
  rows: T[],
  threshold = 0.45,
  sameDay = 0,
): (T & { related: number })[] {
  const reps: (T & { related: number })[] = [];
  const repTokens: Set<string>[] = [];
  const repDays: string[] = [];
  for (const r of rows) {
    const tk = titleTokens(r.title);
    const d = dayKey(r.published_at);
    const hit = repTokens.findIndex((k, i) => {
      const j = jaccard(k, tk);
      if (j >= threshold) return true;
      return sameDay > 0 && d !== "" && d === repDays[i] && j >= sameDay;
    });
    if (hit >= 0) {
      mergeInto(reps[hit], r);
      continue;
    }
    repTokens.push(tk);
    repDays.push(d);
    reps.push({ ...r, related: r.related ?? 0 });
  }
  return reps;
}

/** Readable wire: cluster, then keep the newest N. */
export const WIRE_MAX = 32;

export function compactWire<T extends Clusterable>(rows: T[]): (T & { related: number })[] {
  return clusterByTitle(rows, 0.4, 0.32).slice(0, WIRE_MAX);
}
