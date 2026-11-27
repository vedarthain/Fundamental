/**
 * GET|POST /api/cron/evaluate-alerts — daily re-evaluation of ring-1 portfolio
 * alerts for every user with holdings (see lib/alerts.ts + 0051_alerts.sql).
 *
 * Idempotent by construction: evaluateAlerts opens new episodes, leaves open
 * ones untouched, and retires cleared ones — so a same-day re-run is a noop.
 * Scheduled after the market's EOD prices land (bhavcopy top-up) so the
 * day-change and price rules see the latest close.
 *
 * Auth mirrors the other crons: `Authorization: Bearer $CRON_SECRET` (also
 * accepts REVALIDATE_TOKEN for the shared external pinger). No token → 401.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sql } from "@/lib/db";
import { evaluateAlerts, type NewlyTriggeredAlert } from "@/lib/alerts";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authOk(req: NextRequest): boolean {
  const candidates = [process.env.CRON_SECRET, process.env.REVALIDATE_TOKEN].filter(
    (x): x is string => !!x,
  );
  if (candidates.length === 0) return false;
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const given = m?.[1] ?? req.nextUrl.searchParams.get("token") ?? "";
  if (!given) return false;
  return candidates.some(
    (exp) => given.length === exp.length && timingSafeEqual(Buffer.from(given), Buffer.from(exp)),
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderAlertEmailHtml(name: string | null, alerts: NewlyTriggeredAlert[]): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const rows = alerts
    .map((a) => {
      const badgeColor =
        a.severity === "urgent"
          ? "#dc2626"
          : a.severity === "warn"
            ? "#d97706"
            : "#059669";
      const stockLink =
        a.symbol && a.symbol !== "__PORTFOLIO__"
          ? `<a href="https://equityroots.in/stock/${encodeURIComponent(a.symbol)}" style="color:#1d4ed8;font-weight:600;text-decoration:none;">${escapeHtml(a.symbol)}</a>`
          : "<strong>Portfolio</strong>";
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;background:${badgeColor};text-transform:uppercase;">
              ${escapeHtml(a.severity)}
            </span>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
            <div style="font-size:14px;color:#0f172a;margin-bottom:2px;">${stockLink} — ${escapeHtml(a.title)}</div>
            <div style="font-size:13px;color:#475569;">${escapeHtml(a.reason)}</div>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#0f172a;">
      <h2 style="margin:0 0 8px;font-size:18px;">EquityRoots Alert Digest</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#475569;">${greeting} ${alerts.length} new alert${alerts.length === 1 ? "" : "s"} triggered after today's market close:</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        ${rows}
      </table>
      <p style="margin:18px 0 0;font-size:13px;">
        <a href="https://equityroots.in/tools/alerts" style="display:inline-block;padding:9px 16px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
          Review in EquityRoots Alerts →
        </a>
      </p>
    </div>`;
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sendEmails = req.nextUrl.searchParams.get("email") !== "0";

  const userRows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT user_id::text AS user_id FROM app.portfolio_holding
    UNION
    SELECT DISTINCT user_id::text AS user_id FROM app.price_alert WHERE status = 'armed'
  `;

  let triggered = 0;
  let resolved = 0;
  let emailsSent = 0;
  const results: {
    userId: number;
    triggered: number;
    resolved: number;
    emailSent?: boolean;
    emailError?: string;
  }[] = [];

  for (const u of userRows) {
    const userId = Number(u.user_id);
    const r = await evaluateAlerts(userId);
    triggered += r.triggered;
    resolved += r.resolved;

    let emailSent: boolean | undefined;
    let emailError: string | undefined;

    if (sendEmails && r.newAlerts.length > 0) {
      const userInfo = await sql<{ email: string; display_name: string | null }[]>`
        SELECT email::text AS email, display_name
          FROM app.users
         WHERE id = ${userId}
      `.catch(() => []);

      if (userInfo.length > 0 && userInfo[0].email) {
        const subject =
          r.newAlerts.length === 1
            ? `🔔 EquityRoots Alert: ${r.newAlerts[0].title} (${r.newAlerts[0].symbol})`
            : `🔔 EquityRoots: ${r.newAlerts.length} New Portfolio & Price Alerts`;
        const res = await sendEmail({
          to: userInfo[0].email,
          subject,
          html: renderAlertEmailHtml(userInfo[0].display_name, r.newAlerts),
        });
        emailSent = res.ok;
        if (res.ok) emailsSent++;
        else emailError = res.error;
      }
    }

    results.push({
      userId,
      triggered: r.triggered,
      resolved: r.resolved,
      ...(emailSent !== undefined ? { emailSent } : {}),
      ...(emailError ? { emailError } : {}),
    });
  }

  return NextResponse.json({
    ok: true,
    users: userRows.length,
    triggered,
    resolved,
    emailsSent,
    results,
  });
}
