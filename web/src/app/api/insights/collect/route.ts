import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOT_RE = /bot|crawler|spider|headless|slurp|bingpreview|facebookexternalhit|curl|wget|python-requests|go-http-client|uptime|pingdom/i;

let schemaReady: Promise<void> | null = null;
let lastPruneAt = 0;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS app.web_insight_event (
          id BIGSERIAL PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          event_type TEXT NOT NULL,
          path TEXT NOT NULL,
          device TEXT,
          referrer TEXT,
          session_id TEXT,
          ttfb_ms DOUBLE PRECISION,
          fcp_ms DOUBLE PRECISION,
          lcp_ms DOUBLE PRECISION,
          cls DOUBLE PRECISION,
          inp_ms DOUBLE PRECISION,
          load_ms DOUBLE PRECISION,
          dwell_ms INTEGER
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_web_insight_created
        ON app.web_insight_event (created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_web_insight_path
        ON app.web_insight_event (path, created_at DESC)
      `;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function cleanNum(v: unknown, max = 600_000): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 1000) / 1000;
}

function cleanReferrer(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.trim()) return null;
  try {
    const u = new URL(ref);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!host || host === "equityroots.in" || host === "localhost") return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const ua = req.headers.get("user-agent") || "";
    if (BOT_RE.test(ua)) {
      return new NextResponse(null, { status: 204 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return new NextResponse(null, { status: 204 });
    }

    const eventType = String(body.event_type || "").slice(0, 24);
    if (!["pageview", "vital", "engaged"].includes(eventType)) {
      return new NextResponse(null, { status: 204 });
    }

    const rawPath = typeof body.path === "string" ? body.path : "/";
    const path = rawPath.split("?")[0].slice(0, 200) || "/";
    const device = body.device === "mobile" ? "mobile" : "desktop";
    const referrer = cleanReferrer(body.referrer);
    const sessionId = typeof body.session_id === "string" ? body.session_id.slice(0, 64) : null;

    const ttfbMs = cleanNum(body.ttfb_ms, 120_000);
    const fcpMs = cleanNum(body.fcp_ms, 120_000);
    const lcpMs = cleanNum(body.lcp_ms, 120_000);
    const cls = cleanNum(body.cls, 10);
    const inpMs = cleanNum(body.inp_ms, 60_000);
    const loadMs = cleanNum(body.load_ms, 120_000);
    const dwellMs = body.dwell_ms != null ? Math.min(3_600_000, Math.max(0, Math.round(Number(body.dwell_ms) || 0))) : null;

    await ensureSchema();

    await sql`
      INSERT INTO app.web_insight_event (
        event_type, path, device, referrer, session_id,
        ttfb_ms, fcp_ms, lcp_ms, cls, inp_ms, load_ms, dwell_ms
      ) VALUES (
        ${eventType}, ${path}, ${device}, ${referrer}, ${sessionId},
        ${ttfbMs}, ${fcpMs}, ${lcpMs}, ${cls}, ${inpMs}, ${loadMs}, ${dwellMs}
      )
    `;

    // Lazy retention prune (at most once every 6 hours): keep 60 days
    const now = Date.now();
    if (now - lastPruneAt > 6 * 60 * 60 * 1000) {
      lastPruneAt = now;
      sql`DELETE FROM app.web_insight_event WHERE created_at < NOW() - INTERVAL '60 days'`.catch(() => {});
    }

    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
