import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MoatInput = {
  symbol: string;
  moat_strength: string;
  moat_type: string;
  moat_points: string[];
  model?: string | null;
};

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const expected = process.env.REVALIDATE_TOKEN;
  const tokenOk = Boolean(expected && token && token === expected);
  if (!tokenOk && !(await isAdminRequest())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { items?: MoatInput[] } | null;
  const items = body?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items array required" }, { status: 400 });
  }

  await sql`
    CREATE TABLE IF NOT EXISTS app.company_moat (
      symbol TEXT PRIMARY KEY,
      moat_strength TEXT NOT NULL DEFAULT 'Narrow',
      moat_type TEXT NOT NULL DEFAULT 'Niche / Operational',
      moat_points JSONB NOT NULL DEFAULT '[]'::jsonb,
      model TEXT,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  let upserted = 0;
  for (const item of items) {
    if (!item.symbol || !Array.isArray(item.moat_points)) continue;
    await sql`
      INSERT INTO app.company_moat (symbol, moat_strength, moat_type, moat_points, model, generated_at)
      VALUES (
        ${item.symbol.toUpperCase()},
        ${item.moat_strength || "Narrow"},
        ${item.moat_type || "Niche / Operational"},
        ${JSON.stringify(item.moat_points)}::jsonb,
        ${item.model ?? null},
        now()
      )
      ON CONFLICT (symbol) DO UPDATE SET
        moat_strength = EXCLUDED.moat_strength,
        moat_type = EXCLUDED.moat_type,
        moat_points = EXCLUDED.moat_points,
        model = EXCLUDED.model,
        generated_at = now()
    `;
    upserted++;
  }

  return NextResponse.json({ ok: true, upserted });
}
