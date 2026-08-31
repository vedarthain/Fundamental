/**
 * Admin-only Morning Brief API.
 *
 *   POST   multipart { paper, date, file }  → extract+synthesize+store one brief
 *   GET    ?paper=&date=                     → one brief (both) | list (neither)
 *   DELETE ?id=                              → remove one brief
 *
 * Every method is gated on isAdminRequest(). The uploaded PDF is processed in
 * memory and DISCARDED — only the derived brief JSON is persisted (see
 * src/lib/dailyBrief.ts + migration 0065). ETFs/notices are filtered out before
 * synthesis; symbols are resolved to app.universe server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import {
  processBriefUpload,
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

const MAX_BYTES = 40 * 1024 * 1024; // 40 MB — a full epaper PDF is chunky

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const paper = String(form.get("paper") ?? "").trim();
  if (!isBriefPaper(paper)) {
    return NextResponse.json(
      { error: `unknown paper — expected one of ${Object.keys(BRIEF_PAPERS).join(", ")}` },
      { status: 400 },
    );
  }

  const date = String(form.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (date > new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: "edition date can't be in the future" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no PDF uploaded" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "upload the epaper PDF (.pdf)" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "PDF too large (max 40 MB)" }, { status: 400 });
  }

  try {
    const buf = await file.arrayBuffer();
    const brief = await processBriefUpload(paper, date, buf);
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
