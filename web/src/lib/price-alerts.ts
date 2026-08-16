/**
 * User price alerts — "draw a line on the chart, ping me when price reaches it".
 * See 0052_price_alerts.sql for the lifecycle (armed → triggered → dismissed).
 *
 * This module owns app.price_alert end to end:
 *   • loadPriceAlertsForSymbol — the chart's live lines (armed + triggered).
 *   • createPriceAlert / deletePriceAlert — the chart's create/remove controls.
 *   • evaluatePriceAlerts — flip armed → triggered when the latest EOD close has
 *     crossed the level. Called from evaluateAlerts (cron + "Check now").
 *   • loadPriceAlertRows / dismissPriceAlert — feed + ack the Alerts tab's
 *     "Price alerts" category. These map to the same AlertRow shape the tab
 *     already renders, with ruleKey = 'price_level'.
 *
 * EOD-only by design (v1): golden ships daily closes; intraday ticks exist only
 * for the 1D chart and aren't reliably complete. An intraday-cross alert is a
 * separate, bigger build.
 */
import "server-only";
import { sql, golden } from "@/lib/db";
import type { AlertRow } from "@/lib/alerts";

export type PriceAlertDirection = "above" | "below";
export type PriceAlertStatus = "armed" | "triggered" | "dismissed";

/** Chart-facing shape (a single line). */
export type PriceAlert = {
  id: number;
  symbol: string;
  price: number;
  direction: PriceAlertDirection;
  status: Exclude<PriceAlertStatus, "dismissed">; // chart only shows live lines
  triggeredAt: string | null;
};

export const PRICE_ALERT_RULE = "price_level"; // ruleKey used in the Alerts tab
const MAX_PER_SYMBOL = 10; // guardrail against a user carpeting one chart

const inr = (n: number): string =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Latest EOD close per bare symbol, from golden. Empty map on failure. */
async function loadLatestClose(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (symbols.length === 0) return out;
  const ns = symbols.map((s) => `${s}.NS`);
  const rows = await golden<{ symbol: string; close: number }[]>`
    SELECT symbol, close::float8 AS close FROM (
      SELECT symbol, close,
             row_number() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
        FROM golden.price_history_1d
       WHERE symbol = ANY(${ns}) AND interval = '1d' AND close IS NOT NULL
    ) t WHERE rn = 1
  `.catch(() => [] as { symbol: string; close: number }[]);
  for (const r of rows) out.set(r.symbol.replace(/\.NS$/, ""), r.close);
  return out;
}

/** The chart's live lines for one symbol: armed (green) + triggered (orange). */
export async function loadPriceAlertsForSymbol(
  userId: number,
  symbol: string,
): Promise<PriceAlert[]> {
  const rows = await sql<
    {
      id: number;
      symbol: string;
      price: number;
      direction: PriceAlertDirection;
      status: PriceAlert["status"];
      triggered_at: string | null;
    }[]
  >`
    SELECT id, symbol, price::float8 AS price, direction, status,
           triggered_at::text AS triggered_at
      FROM app.price_alert
     WHERE user_id = ${userId} AND symbol = ${symbol.toUpperCase()}
       AND status IN ('armed', 'triggered')
     ORDER BY price ASC
  `.catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    price: r.price,
    direction: r.direction,
    status: r.status,
    triggeredAt: r.triggered_at,
  }));
}

/**
 * Every live line the user has across ALL symbols (armed + triggered), keyed
 * for the scanner graph so each candlestick card can draw its own alert lines
 * and show the grey "A" once a symbol has any. One query, not one-per-card.
 */
export async function loadLivePriceAlerts(userId: number): Promise<PriceAlert[]> {
  const rows = await sql<
    {
      id: number;
      symbol: string;
      price: number;
      direction: PriceAlertDirection;
      status: PriceAlert["status"];
      triggered_at: string | null;
    }[]
  >`
    SELECT id, symbol, price::float8 AS price, direction, status,
           triggered_at::text AS triggered_at
      FROM app.price_alert
     WHERE user_id = ${userId} AND status IN ('armed', 'triggered')
     ORDER BY symbol ASC, price ASC
  `.catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    price: r.price,
    direction: r.direction,
    status: r.status,
    triggeredAt: r.triggered_at,
  }));
}

/**
 * Create an armed alert at `price` for `symbol`. Direction is inferred from the
 * latest close (target above → 'above'; at/below → 'below') so it starts armed.
 * Returns the created row, or an error string the API surfaces to the user.
 */
export async function createPriceAlert(
  userId: number,
  symbol: string,
  price: number,
): Promise<{ ok: true; alert: PriceAlert } | { ok: false; error: string }> {
  const sym = symbol.toUpperCase();
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "Enter a price above 0." };
  }

  const count = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM app.price_alert
     WHERE user_id = ${userId} AND symbol = ${sym} AND status <> 'dismissed'
  `.catch(() => [{ n: 0 }]);
  if ((count[0]?.n ?? 0) >= MAX_PER_SYMBOL) {
    return { ok: false, error: `Limit ${MAX_PER_SYMBOL} alerts per stock.` };
  }

  const closes = await loadLatestClose([sym]);
  const cur = closes.get(sym);
  if (cur == null) {
    return { ok: false, error: "No recent price for this stock yet." };
  }
  // Target above current → a "cross above" target; otherwise a "fall to" stop.
  const direction: PriceAlertDirection = price > cur ? "above" : "below";

  const ins = await sql<
    {
      id: number;
      symbol: string;
      price: number;
      direction: PriceAlertDirection;
      status: PriceAlert["status"];
      triggered_at: string | null;
    }[]
  >`
    INSERT INTO app.price_alert (user_id, symbol, price, direction)
    VALUES (${userId}, ${sym}, ${price}, ${direction})
    RETURNING id, symbol, price::float8 AS price, direction, status,
              triggered_at::text AS triggered_at
  `;
  const r = ins[0];
  return {
    ok: true,
    alert: {
      id: r.id,
      symbol: r.symbol,
      price: r.price,
      direction: r.direction,
      status: r.status,
      triggeredAt: r.triggered_at,
    },
  };
}

/**
 * Change an existing alert's price. Re-infers direction from the latest close
 * and re-arms it (clears any triggered/dismissed state) so editing a fired
 * alert puts a fresh line back on the chart. Scoped to the owner.
 */
export async function updatePriceAlert(
  userId: number,
  id: number,
  price: number,
): Promise<{ ok: true; alert: PriceAlert } | { ok: false; error: string }> {
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "Enter a price above 0." };
  }
  // Need the symbol to re-infer direction from its current close.
  const own = await sql<{ symbol: string }[]>`
    SELECT symbol FROM app.price_alert WHERE id = ${id} AND user_id = ${userId}
  `.catch(() => []);
  if (own.length === 0) return { ok: false, error: "Alert not found." };
  const sym = own[0].symbol;

  const closes = await loadLatestClose([sym]);
  const cur = closes.get(sym);
  if (cur == null) return { ok: false, error: "No recent price for this stock yet." };
  const direction: PriceAlertDirection = price > cur ? "above" : "below";

  const upd = await sql<
    {
      id: number;
      symbol: string;
      price: number;
      direction: PriceAlertDirection;
      status: PriceAlert["status"];
      triggered_at: string | null;
    }[]
  >`
    UPDATE app.price_alert
       SET price = ${price}, direction = ${direction},
           status = 'armed', triggered_at = NULL, dismissed_at = NULL
     WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, symbol, price::float8 AS price, direction, status,
              triggered_at::text AS triggered_at
  `.catch(() => []);
  if (upd.length === 0) return { ok: false, error: "Could not update alert." };
  const r = upd[0];
  return {
    ok: true,
    alert: {
      id: r.id,
      symbol: r.symbol,
      price: r.price,
      direction: r.direction,
      status: r.status,
      triggeredAt: r.triggered_at,
    },
  };
}

/** Remove a line entirely (any status). Scoped to the owner. */
export async function deletePriceAlert(userId: number, id: number): Promise<boolean> {
  const del = await sql<{ id: number }[]>`
    DELETE FROM app.price_alert
     WHERE id = ${id} AND user_id = ${userId}
    RETURNING id
  `.catch(() => []);
  return del.length > 0;
}

/**
 * Ack a fired price-alert card → greyed in the tab, line gone from chart.
 * `id` is the EVENT id (loadPriceAlertRows returns event rows). We ack the
 * event AND, if its source line is still triggered, dismiss it so the orange
 * line leaves the chart. A deleted/re-armed line simply has nothing to dismiss.
 */
export async function dismissPriceAlert(userId: number, id: number): Promise<boolean> {
  const upd = await sql<{ alert_id: number }[]>`
    UPDATE app.price_alert_event
       SET acknowledged_at = now()
     WHERE id = ${id} AND user_id = ${userId} AND acknowledged_at IS NULL
    RETURNING alert_id
  `.catch(() => []);
  if (upd.length === 0) return false;

  const alertId = upd[0].alert_id;
  await sql`
    UPDATE app.price_alert
       SET status = 'dismissed', dismissed_at = now()
     WHERE id = ${alertId} AND user_id = ${userId} AND status = 'triggered'
  `.catch(() => {});
  return true;
}

/**
 * Flip every armed alert whose latest EOD close has crossed its level to
 * 'triggered'. Returns how many fired. Evaluated across ALL of the user's
 * symbols (a price alert can sit on a name they don't own).
 */
export async function evaluatePriceAlerts(userId: number): Promise<number> {
  const armed = await sql<
    { id: number; symbol: string; price: number; direction: PriceAlertDirection }[]
  >`
    SELECT id, symbol, price::float8 AS price, direction
      FROM app.price_alert
     WHERE user_id = ${userId} AND status = 'armed'
  `.catch(() => []);
  if (armed.length === 0) return 0;

  const closes = await loadLatestClose([...new Set(armed.map((a) => a.symbol))]);
  const hit: number[] = [];
  for (const a of armed) {
    const c = closes.get(a.symbol);
    if (c == null) continue;
    const crossed = a.direction === "above" ? c >= a.price : c <= a.price;
    if (crossed) hit.push(a.id);
  }
  if (hit.length === 0) return 0;

  const upd = await sql<{ id: number }[]>`
    UPDATE app.price_alert
       SET status = 'triggered', triggered_at = now()
     WHERE id = ANY(${hit}) AND status = 'armed'
    RETURNING id
  `.catch(() => []);
  // Append an immutable fire to the history log for each alert we actually
  // flipped (the RETURNING guards against a race double-firing). This row
  // survives any later edit/delete of the live line — that's the whole point.
  const flipped = new Set(upd.map((r) => r.id));
  const armedById = new Map(armed.map((a) => [a.id, a]));
  const events = hit
    .filter((id) => flipped.has(id) && armedById.has(id))
    .map((id) => armedById.get(id)!)
    .map((a) => ({
      alert_id: a.id,
      user_id: userId,
      symbol: a.symbol,
      price: a.price,
      direction: a.direction,
      close_at_event: closes.get(a.symbol) ?? null,
    }));
  if (events.length > 0) {
    await sql`
      INSERT INTO app.price_alert_event ${sql(
        events,
        "alert_id",
        "user_id",
        "symbol",
        "price",
        "direction",
        "close_at_event",
      )}
    `.catch(() => {});
  }
  return flipped.size;
}

/**
 * The "Price alerts" category for the tab — read straight from the immutable
 * fire log (app.price_alert_event), so every trigger stays here for good even
 * after the source line is edited or deleted. Unacked fire → active card;
 * acked → greyed. severity 'warn' matches the chart's orange triggered line.
 *
 * `id` is the EVENT id (not the alert id): dismissPriceAlert acks by event id.
 */
export async function loadPriceAlertRows(userId: number): Promise<AlertRow[]> {
  const rows = await sql<
    {
      id: number;
      symbol: string;
      price: number;
      direction: PriceAlertDirection;
      acknowledged: boolean;
      event_at: string;
    }[]
  >`
    SELECT id, symbol, price::float8 AS price, direction,
           acknowledged_at IS NOT NULL AS acknowledged,
           event_at::text AS event_at
      FROM app.price_alert_event
     WHERE user_id = ${userId}
     ORDER BY event_at DESC
  `.catch(() => []);

  return rows.map((r) => {
    const verb = r.direction === "above" ? "rose to" : "fell to";
    return {
      id: r.id,
      ruleKey: PRICE_ALERT_RULE,
      symbol: r.symbol,
      severity: "warn" as const,
      title: "Price alert",
      reason: `${r.symbol} ${verb} your ${inr(r.price)} level`,
      context: { price: r.price, direction: r.direction },
      status: r.acknowledged ? ("dismissed" as const) : ("active" as const),
      triggeredAt: r.event_at,
    };
  });
}
