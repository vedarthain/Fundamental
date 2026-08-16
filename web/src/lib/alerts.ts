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
 * their holdings. Rules are pure price-vs-reference (no historical baseline), so
 * v1 needs zero extra data plumbing.
 */
import "server-only";
import { sql } from "@/lib/db";
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

// ── v1 rule thresholds ──────────────────────────────────────────────────────
// Flat constants on purpose: live with the noise first, then (v2) swap the
// down-day cut for a σ-scaled one once real data shows how chatty it is.
const TARGET_MULT = 1.25; // +25% profit target off blended avg cost
const DOWN_DAY_PCT = -6; // single-day drop that warrants a look
const DRAWDOWN_MULT = 0.8; // −20% below avg cost → review thesis
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

  const candidates: Candidate[] = [];
  for (const i of held) {
    const sym = i.symbol!;
    const p = i.price!;
    const a = i.avgCost!;

    // 1. Target reached (+25%) — consider trimming.
    const target = a * TARGET_MULT;
    if (p >= target) {
      candidates.push({
        ruleKey: "target_hit",
        symbol: sym,
        severity: "info",
        title: "Target reached",
        reason: `${sym} hit your +25% target — ${inr(p)} ≥ ${inr(r2(target))} (avg ${inr(a)})`,
        context: { price: p, target: r2(target), avg: a, gainPct: r1((p / a - 1) * 100) },
      });
    }

    // 2. Big down day — a held name fell hard today.
    if (i.dayChangePct != null && i.dayChangePct <= DOWN_DAY_PCT) {
      candidates.push({
        ruleKey: "big_down_day",
        symbol: sym,
        severity: "warn",
        title: "Big down day",
        reason: `${sym} fell ${Math.abs(i.dayChangePct)}% today — now ${inr(p)}`,
        context: { dayChangePct: i.dayChangePct, price: p },
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
