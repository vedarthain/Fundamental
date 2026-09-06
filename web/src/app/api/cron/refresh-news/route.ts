/**
 * POST|GET /api/cron/refresh-news — reliably trigger the news refresh.
 *
 * WHY: the `refresh-news` GitHub Actions schedule (`0 2-17 * * *`) kept getting
 * dropped — GitHub sheds load on top-of-the-hour scheduled events, so whole
 * batches of hourly runs silently never fire (observed: nothing ran one
 * morning between 02:00–05:00 UTC). Scheduled events are best-effort;
 * `workflow_dispatch` events are NOT load-shed and fire reliably.
 *
 * So instead of trusting GitHub's scheduler, a reliable external pinger
 * (cron-job.org — the same pattern that fixed intraday prices) hits this route,
 * and the route dispatches the existing workflow via the GitHub API. The Python
 * RSS + tagging job (scripts/fetch-news.py) is reused unchanged; only the
 * trigger moves off GitHub's flaky cron.
 *
 * Auth: bearer INTRADAY_CRON_TOKEN (falls back to REVALIDATE_TOKEN) — same
 * token cron-job.org already carries for the intraday pingers, so no new
 * secret on that side.
 *
 * Requires env GH_DISPATCH_TOKEN: a GitHub fine-grained PAT with
 * "Actions: read and write" on this repo. Lives in Vercel env (never in
 * cron-job.org), so the trigger secret and the GitHub token are separated.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER = "vedarthain";
const REPO = "Fundamental";
const WORKFLOW = "refresh-news.yml";
const REF = "main";

// Indian-market news has no weekend cadence — markets are shut Sat/Sun and the
// broadcaster RSS goes quiet — so we skip weekend dispatches entirely. "Weekend"
// is Sat/Sun in IST (UTC+5:30), not UTC: shift the clock by +5:30h and read the
// day-of-week off the shifted timestamp. cron-job.org may still ping hourly 7
// days a week; this guard makes a weekend ping a cheap, logged no-op rather than
// firing a pointless workflow run. Weekday cadence (hourly, once) is set on the
// cron-job.org side (schedule '0 * * * 1-5').
function isWeekendIST(): boolean {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const dow = new Date(istMs).getUTCDay(); // 0 = Sunday … 6 = Saturday, in IST
  return dow === 0 || dow === 6;
}

function authOk(req: NextRequest): boolean {
  const expected = process.env.INTRADAY_CRON_TOKEN || process.env.REVALIDATE_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const given = m?.[1] ?? req.nextUrl.searchParams.get("token") ?? "";
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

async function trigger(): Promise<NextResponse> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "GH_DISPATCH_TOKEN not set" }, { status: 500 });
  }
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "equityroots-cron",
    },
    body: JSON.stringify({ ref: REF }),
  });
  // GitHub returns 204 No Content on a successful dispatch.
  if (r.status === 204) {
    return NextResponse.json({ ok: true, dispatched: WORKFLOW });
  }
  const detail = await r.text().catch(() => "");
  return NextResponse.json(
    { ok: false, status: r.status, detail: detail.slice(0, 300) },
    { status: 502 },
  );
}

// 200 (not an error) so cron-job.org records a healthy ping and doesn't retry
// or alert; `skipped` makes the weekend no-op visible in its response log.
function weekendSkip(): NextResponse {
  return NextResponse.json({ ok: true, skipped: "weekend", dispatched: null });
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isWeekendIST()) return weekendSkip();
  return trigger();
}

// GET form so cron-job.org's default GET works too (?token=… or bearer).
export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isWeekendIST()) return weekendSkip();
  return trigger();
}
