/**
 * /api/feedback — accept user submissions.
 *
 * POST a JSON body { body, name?, email?, page_url? } and we'll store it
 * in app.user_ideas for triage. Includes lightweight spam protection:
 *   - body must be 10-5000 characters
 *   - email (if provided) must look like an email
 *   - IP is SHA-256 hashed so we have a dedup key without retaining the IP
 *
 * Cost (Rule #1): one INSERT per submission, ~1ms. Effectively free.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  body?: unknown;
  name?: unknown;
  email?: unknown;
  page_url?: unknown;
};

function s(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

function hashIp(ip: string): string {
  // SHA-256 with a fixed salt so the same IP produces the same hash across
  // submissions (for dedup) but the raw IP is never recoverable.
  return createHash("sha256").update(`equityroots:${ip}`).digest("hex").slice(0, 32);
}

export async function POST(req: NextRequest) {
  let raw: Body;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const body = s(raw.body, 5000);
  if (!body || body.length < 10) {
    return NextResponse.json(
      { error: "body must be at least 10 characters" },
      { status: 400 },
    );
  }

  const name = s(raw.name, 100);
  const email = s(raw.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  const pageUrl = s(raw.page_url, 500);

  // Vercel passes the client IP via x-forwarded-for. Fall back to a
  // placeholder for local dev. Hash before storing — we never retain the raw IP.
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || "0.0.0.0";
  const ipHash = hashIp(ip);

  const userAgent = s(req.headers.get("user-agent"), 500);

  try {
    await sql`
      INSERT INTO app.user_ideas (body, name, email, page_url, user_agent, ip_hash)
      VALUES (${body}, ${name}, ${email}, ${pageUrl}, ${userAgent}, ${ipHash})
    `;
  } catch (err) {
    console.error("user_ideas insert failed:", err);
    return NextResponse.json({ error: "could not save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
