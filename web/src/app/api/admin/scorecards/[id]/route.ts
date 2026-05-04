/** POST /api/admin/scorecards/{cluster_id}
 * Saves a NEW versioned row in app.cluster_scorecard. Loader picks up the
 * latest on the next scoring run.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";

type Body = {
  pillar_weights: Record<string, number>;
  quality: Record<string, number>;
  valuation: Record<string, number>;
  momentum: Record<string, number>;
  loss_maker_val_fallback: [string, number][];
  edited_by?: string | null;
  notes?: string | null;
};

function sumWeights(obj: Record<string, number>): number {
  return Object.values(obj).reduce((s, n) => s + Number(n || 0), 0);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id || id.length > 60) {
    return NextResponse.json({ error: "invalid cluster id" }, { status: 400 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Validation
  const errs: string[] = [];
  const pwSum = sumWeights(body.pillar_weights || {});
  if (Math.abs(pwSum - 100) > 0.5) errs.push(`pillar weights sum to ${pwSum} (need 100)`);

  for (const [pillar, comps] of [
    ["quality", body.quality],
    ["valuation", body.valuation],
    ["momentum", body.momentum],
  ] as const) {
    const s = sumWeights(comps || {});
    if (Math.abs(s - 100) > 0.5) errs.push(`${pillar} sum to ${s} (need 100)`);
    if (!comps || Object.keys(comps).length === 0) errs.push(`${pillar} has no components`);
  }

  if (body.loss_maker_val_fallback?.length) {
    const fbSum = body.loss_maker_val_fallback.reduce((s, [, w]) => s + Number(w), 0);
    if (Math.abs(fbSum - 1.0) > 0.05) errs.push(`fallback shares sum to ${fbSum.toFixed(2)} (need ~1.0)`);
  }

  if (errs.length) {
    return NextResponse.json({ error: errs.join("; ") }, { status: 400 });
  }

  // Verify the cluster exists
  const c = await sql<{ id: string }[]>`SELECT id FROM app.cluster WHERE id = ${id}`;
  if (c.length === 0) {
    return NextResponse.json({ error: "cluster not found" }, { status: 404 });
  }

  // Insert new versioned row
  await sql`
    INSERT INTO app.cluster_scorecard
      (cluster_id, pillar_weights, quality, valuation, momentum,
       loss_maker_val_fallback, edited_by, notes)
    VALUES (${id},
            ${sql.json(body.pillar_weights)},
            ${sql.json(body.quality)},
            ${sql.json(body.valuation)},
            ${sql.json(body.momentum)},
            ${sql.json(body.loss_maker_val_fallback ?? [])},
            ${body.edited_by ?? null},
            ${body.notes ?? null})
  `;

  return NextResponse.json({ ok: true });
}
