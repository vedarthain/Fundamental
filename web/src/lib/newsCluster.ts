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
  /((?:share|stock) price live update)|((?:sensex|nifty|stock market|market crash).{0,40}live update)|\blive (?:blog|updates?:)|\bmarkets? (?:today|wrap|highlights)\b|\bclosing bell\b/i;

export function isNoiseHeadline(title: string): boolean {
  return LIVE_NOISE_RE.test(title);
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
