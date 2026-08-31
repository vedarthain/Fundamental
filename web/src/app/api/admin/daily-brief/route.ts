/**
 * Admin-only Morning Brief API.
 *
 *   POST   json { paper, date, pages[] }     → filter+synthesize+store one brief
 *   GET    ?paper=&date=                     → one brief (both) | list (neither)
 *   DELETE ?id=                              → remove one brief
 *
 * Every method is gated on isAdminRequest(). The PDF is extracted to text IN THE
 * BROWSER — only the per-page text reaches this API, never the binary — so a
 * 10-50 MB epaper doesn't hit Vercel's ~4.5 MB serverless body limit, and the
 * source PDF never leaves the admin's machine. Only the derived brief JSON is
 * persisted (see src/lib/dailyBrief.ts + migration 0065). Notices are filtered
 * out before synthesis; symbols are resolved to app.universe server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import {
  processBriefPages,
  getBrief,
  latestBrief,
  listBriefs,
  deleteBrief,
  isBriefPaper,
  BRIEF_PAPERS,
} from "@/lib/dailyBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // synthesis can take a while on a big edition

// Defensive ceiling on the extracted text payload (the client already extracts).
// ~5M chars is far more than any real edition and still well under the body limit.
const MAX_TEXT_CHARS = 5_000_000;

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  let body: { paper?: unknown; date?: unknown; pages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const paper = String(body.paper ?? "").trim();
  if (!isBriefPaper(paper)) {
    return NextResponse.json(
      { error: `unknown paper — expected one of ${Object.keys(BRIEF_PAPERS).join(", ")}` },
      { status: 400 },
    );
  }

  const date = String(body.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (date > new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: "edition date can't be in the future" }, { status: 400 });
  }

  if (!Array.isArray(body.pages) || body.pages.length === 0) {
    return NextResponse.json({ error: "no extracted page text (client-side extraction failed?)" }, { status: 400 });
  }
  const pages = body.pages.map((p) => String(p ?? ""));
  const totalChars = pages.reduce((n, p) => n + p.length, 0);
  if (totalChars === 0) {
    return NextResponse.json(
      { error: "extracted text was empty — likely a scanned-image PDF (no text layer)" },
      { status: 400 },
    );
  }
  if (totalChars > MAX_TEXT_CHARS) {
    return NextResponse.json({ error: "extracted text too large" }, { status: 413 });
  }

  try {
    const brief = await processBriefPages(paper, date, pages);
    return NextResponse.json({ ok: true, brief });
  } catch (e) {
    return NextResponse.json(
      { error: "brief generation failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  const paper = req.nextUrl.searchParams.get("paper");
  const date = req.nextUrl.searchParams.get("date");

  // ?latest=1 → newest full brief (any paper). Powers the /news card.
  if (req.nextUrl.searchParams.get("latest")) {
    const brief = await latestBrief();
    return NextResponse.json({ brief });
  }

  if (paper && date) {
    if (!isBriefPaper(paper)) {
      return NextResponse.json({ error: "unknown paper" }, { status: 400 });
    }
    const brief = await getBrief(paper, date);
    if (!brief) return NextResponse.json({ error: "no brief for that day" }, { status: 404 });
    return NextResponse.json({ brief });
  }

  const briefs = await listBriefs();
  return NextResponse.json({ briefs, papers: BRIEF_PAPERS });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "valid numeric id required" }, { status: 400 });
  }
  const ok = await deleteBrief(id);
  if (!ok) return NextResponse.json({ error: "no such brief" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
