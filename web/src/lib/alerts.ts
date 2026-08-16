/**
 * Portfolio alerts — ring 1 (holdings discipline). See 0051_alerts.sql.
 *
 * Two entry points:
 *   • evaluateAlerts(userId) — re-check the rules against the LIVE portfolio and
 *     reconcile app.alert (open new episodes, retire cleared ones). Called by the
 *     daily cron and the tab's "Check now" button.
 *   • loadAlerts(userId)     — read the tab payload: active cards (severity-first,
 *     capped) + dismissed cards (greyed).
 *
 * We reuse loadPortfolio — the same valuation the /portfolio page and snapshot
 * cron already trust — so alerts can never disagree with what the user sees on
 * their holdings.
 *
 * Rules (v1 + v2):
 *   target_hit     price ≥ avgCost×1.25, below an implausible-multiple guard.
 *   big_down_day   today's move ≤ −k·σ (20d) AND past a floor — σ-scaled so a
 *                  −6% on a quiet largecap trips but −6% noise on a smallcap
 *                  doesn't. Reads golden for the vol baseline.
 *   deep_drawdown  price ≤ avgCost×0.80 (−20% from cost).
 *   composite_slip composite RANK fell ≥12 pts vs ~1wk ago (panel-cache WoW).
 *   hold_limit     ONE aggregate digest card listing holdings past the 4-month
 *                  limit — not one card per name (that's a day-one flood).
 */
import "server-only";
import { sql, golden } from "@/lib/db";
import { loadPortfolio } from "@/lib/portfolio";

export type Severity = "info" | "warn" | "urgent";
export type AlertStatus = "active" | "dismissed";

export type AlertRow = {
  id: number;
  ruleKey: string;
  symbol: string;
  severity: Severity;
  title: string;
  reason: string;
  context: Record<string, unknown>;
  status: AlertStatus;
  triggeredAt: string; // ISO
};

// ── rule thresholds ─────────────────────────────────────────────────────────
const TARGET_MULT = 1.25; // +25% profit target off blended avg cost
// Above this multiple a target-hit is suppressed: it's almost always a stale
// cost basis (split/demerger artifact, e.g. RAYMONDLSL showing 22×), and even
// when real, a "you're up 25%" nudge is worthless on a 6-bagger you clearly
// already know about. Heuristic, not a data fix — trivially tunable.
const TARGET_MAX_MULT = 6;
const DRAWDOWN_MULT = 0.8; // −20% below avg cost → review thesis
const DOWN_DAY_K = 2.5; // today's move must be ≥ this many σ below zero…
const DOWN_DAY_FLOOR = 0.04; // …AND at least −4%, so low-vol names don't trip on noise
const VOL_WINDOW = 20; // trading days of daily-return σ (excludes today)
// composite (0–100 rank) fall vs ~1wk ago. Set at ~1.5σ of the measured
// universe-wide WoW jitter (delta stdev = 7.80, so 8 was only ~1σ/p85 — noise).
// 12 ≈ p95 region: fires on ~4% of the universe / ~5 held names, cleanly
// separating a real slide (e.g. JKTYRE −36, ~4.6σ) from weekly rank churn.
// Note: composite_pct is percentile-ish, so a drop is partly peers rising —
// read it as "losing relative standing", not "the business deteriorated".
const COMPOSITE_DROP = 12;
const WOW_MIN_GAP_DAYS = 5; // baseline = latest snapshot at least this many days older
const HOLD_LIMIT_MONTHS = 4; // matches the Holdings "over hold limit" overlay
const HOLD_LIST_MAX = 6; // names to spell out in the aggregate card before "+N more"
const HOLD_LIMIT_KEY = "__ALL__"; // sentinel symbol for the single aggregate card
// Anti-flood cap applied PER severity, not globally: a market-wide selloff can
// still only surface 15 'urgent' cards, but a drawdown-heavy book can't starve
// the 'info' target-hit ("book profit") signals out of the list entirely.
const CAP_PER_SEVERITY = 15;

const inr = (n: number): string =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;

type Candidate = {
  ruleKey: string;
  symbol: string;
  severity: Severity;
  title: string;
  reason: string;
  context: Record<string, number | string | null>;
};

/**
 * Per-symbol daily-return vol baseline for the σ-scaled down-day rule.
 * Returns today's return (`ret`) and the sample stdev of the prior VOL_WINDOW
 * days' returns (`sigma`, excluding today so a spike can't inflate its own
 * baseline). Both as fractions. Golden failure → empty map → rule just no-ops.
 */
async function loadDailyVol(
  symbols: string[],
): Promise<Map<string, { ret: number; sigma: number }>> {
  const out = new Map<string, { ret: number; sigma: number }>();
  if (symbols.length === 0) return out;
  const ns = symbols.map((s) => `${s}.NS`);
  const rows = await golden<{ symbol: string; ret: number | null; sigma: number | null }[]>`
    WITH r AS (
      SELECT symbol, date,
             close / NULLIF(lag(close) OVER (PARTITION BY symbol ORDER BY date), 0) - 1 AS ret
        FROM golden.price_history_1d
       WHERE symbol = ANY(${ns}) AND interval = '1d' AND close IS NOT NULL
    ),
    ranked AS (
      SELECT symbol, ret,
             row_number() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
        FROM r WHERE ret IS NOT NULL
    )
    SELECT symbol,
           max(ret) FILTER (WHERE rn = 1)::float8                              AS ret,
           stddev_samp(ret) FILTER (WHERE rn BETWEEN 2 AND ${VOL_WINDOW + 1})::float8 AS sigma
      FROM ranked
     WHERE rn <= ${VOL_WINDOW + 1}
     GROUP BY symbol
  `.catch(() => [] as { symbol: string; ret: number | null; sigma: number | null }[]);
  for (const r of rows) {
    const bare = r.symbol.replace(/\.NS$/, "");
    if (r.ret != null && r.sigma != null) out.set(bare, { ret: r.ret, sigma: r.sigma });
  }
  return out;
}

/**
 * Per-symbol composite score now vs ~1 week ago (panel-cache WoW). Baseline is
 * the most recent snapshot at least WOW_MIN_GAP_DAYS older than the latest, so
 * mid-week cache refreshes don't collapse the window to a day.
 */
async function loadCompositeWoW(
  symbols: string[],
): Promise<Map<string, { cur: number; prev: number }>> {
  const out = new Map<string, { cur: number; prev: number }>();
  if (symbols.length === 0) return out;
  const rows = await sql<{ symbol: string; cur: number; prev: number }[]>`
    WITH latest AS (
      SELECT max(snapshot_date) AS d FROM app.cluster_stocks_panel_cache
    ),
    prior AS (
      SELECT max(snapshot_date) AS d
        FROM app.cluster_stocks_panel_cache, latest
       WHERE snapshot_date <= latest.d - ${WOW_MIN_GAP_DAYS}
    )
    SELECT cur.symbol,
           cur.composite_pct::float8  AS cur,
           prev.composite_pct::float8 AS prev
      FROM app.cluster_stocks_panel_cache cur
      JOIN latest ON cur.snapshot_date = latest.d
      JOIN prior  ON TRUE
      JOIN app.cluster_stocks_panel_cache prev
        ON prev.symbol = cur.symbol AND prev.snapshot_date = prior.d
     WHERE cur.symbol = ANY(${symbols})
       AND cur.composite_pct IS NOT NULL AND prev.composite_pct IS NOT NULL
  `.catch(() => [] as { symbol: string; cur: number; prev: number }[]);
  for (const r of rows) out.set(r.symbol, { cur: r.cur, prev: r.prev });
  return out;
}

/**
 * Re-evaluate the ring-1 rules for one user and reconcile app.alert.
 * Idempotent: safe to run repeatedly (the partial unique index dedupes open
 * episodes; a cleared condition retires its episode so it can re-fire later).
 */
export async function evaluateAlerts(
  userId: number,
): Promise<{ triggered: number; resolved: number }> {
  const pf = await loadPortfolio(userId);

  // Only mapped equities with both an avg cost and a live price are checkable
  // (unmapped ETFs/funds carry no golden price → no reference to trip against).
  const held = pf.instruments.filter(
    (i) => i.isMapped && i.symbol && i.avgCost != null && i.price != null,
  );
  const heldSyms = held.map((i) => i.symbol!);

  // Baselines the score/vol rules need, fetched once for the whole held set.
  const vol = await loadDailyVol(heldSyms); // symbol → { ret, sigma }
  const wow = await loadCompositeWoW(heldSyms); // symbol → { cur, prev }

  const candidates: Candidate[] = [];
  for (const i of held) {
    const sym = i.symbol!;
    const p = i.price!;
    const a = i.avgCost!;

    // 1. Target reached (+25%) — consider trimming. Guarded against implausible
    //    multiples (stale cost basis / demerger artifacts).
    const mult = p / a;
    if (mult >= TARGET_MULT && mult <= TARGET_MAX_MULT) {
      const target = a * TARGET_MULT;
      candidates.push({
        ruleKey: "target_hit",
        symbol: sym,
        severity: "info",
        title: "Target reached",
        reason: `${sym} hit your +25% target — ${inr(p)} ≥ ${inr(r2(target))} (avg ${inr(a)})`,
        context: { price: p, target: r2(target), avg: a, gainPct: r1((mult - 1) * 100) },
      });
    }

    // 2. Big down day — σ-scaled: today's move must be both ≥k·σ below zero and
    //    past an absolute floor (so a quiet stock's 2% wobble can't read as 3σ).
    const v = vol.get(sym);
    if (v && v.sigma > 0 && v.ret <= -DOWN_DAY_FLOOR && v.ret <= -DOWN_DAY_K * v.sigma) {
      const z = r1(Math.abs(v.ret / v.sigma));
      candidates.push({
        ruleKey: "big_down_day",
        symbol: sym,
        severity: "warn",
        title: "Big down day",
        reason: `${sym} fell ${r1(Math.abs(v.ret) * 100)}% today — a ${z}σ move (${VOL_WINDOW}d σ ${r1(v.sigma * 100)}%), now ${inr(p)}`,
        context: { retPct: r1(v.ret * 100), sigmaPct: r1(v.sigma * 100), z, price: p },
      });
    }

    // 3. Deep drawdown — ≥20% below your cost basis. Review the thesis.
    if (p <= a * DRAWDOWN_MULT) {
      const lossPct = r1((1 - p / a) * 100);
      candidates.push({
        ruleKey: "deep_drawdown",
        symbol: sym,
        severity: "urgent",
        title: "Deep drawdown",
        reason: `${sym} is ${lossPct}% below your avg cost — ${inr(p)} ≤ avg ${inr(a)}`,
        context: { price: p, avg: a, lossPct },
      });
    }

    // 4. Composite slip — quality/value/momentum RANK fell hard vs ~1wk ago.
    // composite_pct is percentile-ish, so this is relative standing, not an
    // absolute business call: the reason says "slipped … in rank" deliberately.
    const w = wow.get(sym);
    if (w && w.cur - w.prev <= -COMPOSITE_DROP) {
      const drop = Math.round(w.prev - w.cur);
      candidates.push({
        ruleKey: "composite_slip",
        symbol: sym,
        severity: "warn",
        title: "Rank slipping",
        reason: `${sym} slipped ${drop} pts in rank this week — ${Math.round(w.prev)} → ${Math.round(w.cur)}`,
        context: { from: Math.round(w.prev), to: Math.round(w.cur), drop },
      });
    }
  }

  const triggeredKeys = new Set(candidates.map((c) => `${c.ruleKey}|${c.symbol}`));
  let triggered = 0;
  let resolved = 0;

  // Open a fresh episode for each trip. ON CONFLICT against the partial unique
  // index makes this a noop when an episode is already open (active OR dismissed),
  // so a dismissed alert stays dismissed and a still-true one doesn't duplicate.
  for (const c of candidates) {
    const ins = await sql<{ id: number }[]>`
      INSERT INTO app.alert
        (user_id, rule_key, symbol, severity, title, reason, context, dedup_key)
      VALUES
        (${userId}, ${c.ruleKey}, ${c.symbol}, ${c.severity}, ${c.title},
         ${c.reason}, ${JSON.stringify(c.context)}::jsonb, ${`${c.ruleKey}|${c.symbol}`})
      ON CONFLICT (user_id, rule_key, symbol) WHERE status <> 'resolved'
      DO NOTHING
      RETURNING id
    `;
    if (ins.length > 0) triggered++;
  }

  // 5. Hold-limit — ONE aggregate digest card, refreshed daily (DO UPDATE) so
  //    the name list stays current while active; a dismissed card is left as-is
  //    (no re-nag), and an empty set resolves it via the stale sweep below.
  const overLimit = held
    .filter((i) => (i.monthsHeld ?? 0) >= HOLD_LIMIT_MONTHS)
    .sort((a, b) => (b.monthsHeld ?? 0) - (a.monthsHeld ?? 0));
  if (overLimit.length > 0) {
    triggeredKeys.add(`hold_limit|${HOLD_LIMIT_KEY}`);
    const shown = overLimit
      .slice(0, HOLD_LIST_MAX)
      .map((i) => `${i.symbol} (${i.monthsHeld}mo)`)
      .join(", ");
    const more = overLimit.length - HOLD_LIST_MAX;
    const names = overLimit.map((i) => i.symbol);
    const reason =
      `${overLimit.length} holding${overLimit.length === 1 ? "" : "s"} past your ` +
      `${HOLD_LIMIT_MONTHS}-month limit: ${shown}${more > 0 ? `, +${more} more` : ""}`;
    const ins = await sql<{ inserted: boolean }[]>`
      INSERT INTO app.alert
        (user_id, rule_key, symbol, severity, title, reason, context, dedup_key)
      VALUES
        (${userId}, 'hold_limit', ${HOLD_LIMIT_KEY}, 'info', 'Past hold limit',
         ${reason}, ${JSON.stringify({ count: overLimit.length, names })}::jsonb,
         ${`hold_limit|${HOLD_LIMIT_KEY}`})
      ON CONFLICT (user_id, rule_key, symbol) WHERE status <> 'resolved'
      DO UPDATE SET reason = EXCLUDED.reason, context = EXCLUDED.context, updated_at = now()
        WHERE app.alert.status = 'active'
      RETURNING (xmax = 0) AS inserted
    `;
    if (ins.length > 0 && ins[0].inserted) triggered++;
  }

  // Retire every open episode whose condition is no longer true — this covers
  // both a cleared rule AND a fully-exited position (its symbol drops out of the
  // candidate set). Retiring re-arms the (user, rule, symbol) slot for next time.
  const open = await sql<{ id: number; rule_key: string; symbol: string }[]>`
    SELECT id, rule_key, symbol
      FROM app.alert
     WHERE user_id = ${userId} AND status <> 'resolved'
  `;
  const staleIds = open
    .filter((o) => !triggeredKeys.has(`${o.rule_key}|${o.symbol}`))
    .map((o) => o.id);
  if (staleIds.length > 0) {
    await sql`
      UPDATE app.alert
         SET status = 'resolved', resolved_at = now(), updated_at = now()
       WHERE id = ANY(${staleIds})
    `;
    resolved = staleIds.length;
  }

  return { triggered, resolved };
}

/** Tab payload: active (severity-first, capped) + dismissed (greyed) cards. */
export async function loadAlerts(
  userId: number,
): Promise<{ active: AlertRow[]; dismissed: AlertRow[] }> {
  const rows = await sql<
    {
      id: number;
      rule_key: string;
      symbol: string;
      severity: Severity;
      title: string;
      reason: string;
      context: Record<string, unknown>;
      status: AlertStatus;
      triggered_at: string;
    }[]
  >`
    SELECT id, rule_key, symbol, severity, title, reason, context, status,
           triggered_at::text AS triggered_at
      FROM app.alert
     WHERE user_id = ${userId} AND status IN ('active', 'dismissed')
     ORDER BY triggered_at DESC
  `;

  const map = (r: (typeof rows)[number]): AlertRow => ({
    id: r.id,
    ruleKey: r.rule_key,
    symbol: r.symbol,
    severity: r.severity,
    title: r.title,
    reason: r.reason,
    context: r.context ?? {},
    status: r.status,
    triggeredAt: r.triggered_at,
  });

  // Cap each severity bucket independently, then order urgent → warn → info.
  const perSev: Record<Severity, AlertRow[]> = { urgent: [], warn: [], info: [] };
  for (const r of rows) if (r.status === "active") perSev[r.severity].push(map(r));
  const byRecency = (a: AlertRow, b: AlertRow) => (a.triggeredAt < b.triggeredAt ? 1 : -1);
  const active = (["urgent", "warn", "info"] as Severity[]).flatMap((s) =>
    perSev[s].sort(byRecency).slice(0, CAP_PER_SEVERITY),
  );

  const dismissed = rows.filter((r) => r.status === "dismissed").map(map);

  return { active, dismissed };
}

/** Ack one alert → greyed, won't re-fire until the condition clears & re-crosses. */
export async function dismissAlert(userId: number, id: number): Promise<boolean> {
  const upd = await sql<{ id: number }[]>`
    UPDATE app.alert
       SET status = 'dismissed', dismissed_at = now(), updated_at = now()
     WHERE id = ${id} AND user_id = ${userId} AND status = 'active'
    RETURNING id
  `;
  return upd.length > 0;
}
