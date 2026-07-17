/**
 * POST /api/portfolio/import — import a broker holdings file.
 *
 * multipart/form-data: { broker, file }. Session-gated (401 otherwise).
 *
 * Each broker export is a CURRENT snapshot, so importing a broker REPLACES
 * that broker's rows for the user (0041_portfolio.sql) — delete-then-insert
 * inside one transaction, keyed by a fresh source_batch uuid. Idempotent:
 * re-uploading the same file yields the same end state.
 *
 * Resolution: ISIN first (reliable 1:1 join to app.universe), then bare
 * symbol. Rows that don't resolve are still stored (is_mapped=false) and
 * carried at broker value on the dashboard — nothing is dropped.
 *
 * Returns a coverage summary so the client can show "39 imported, 37 mapped,
 * 2 outside coverage" without a second round-trip.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  BROKERS,
  BROKER_LABEL,
  type Broker,
  fileToMatrix,
  parseHoldings,
  resolveSymbol,
  bareSymbol,
  PortfolioImportError,
  type UniverseMap,
} from "@/lib/portfolioImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — holdings files are a few KB

function isBroker(x: string): x is Broker {
  return (BROKERS as readonly string[]).includes(x);
}

async function loadUniverse(): Promise<UniverseMap> {
  const rows = await sql<{ symbol: string; isin: string | null }[]>`
    SELECT symbol, isin FROM app.universe WHERE is_active
  `;
  const byIsin = new Map<string, string>();
  const bySym = new Map<string, string>();
  for (const r of rows) {
    if (r.isin) byIsin.set(r.isin, r.symbol);
    bySym.set(r.symbol.toUpperCase().trim(), r.symbol);
  }
  return { byIsin, bySym };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const brokerRaw = String(form.get("broker") ?? "");
  if (!isBroker(brokerRaw)) {
    return NextResponse.json(
      { error: `unknown broker "${brokerRaw}" — expected one of ${BROKERS.join(", ")}` },
      { status: 400 },
    );
  }
  const broker = brokerRaw;

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file too large (max 2 MB)" }, { status: 400 });
  }

  const buf = await file.arrayBuffer();

  let parsed;
  try {
    const matrix = await fileToMatrix(file.name, buf);
    parsed = parseHoldings(broker, matrix);
  } catch (e) {
    const msg =
      e instanceof PortfolioImportError
        ? e.message
        : "couldn't read that file — is it the holdings export for this broker?";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (parsed.length === 0) {
    return NextResponse.json(
      {
        error: `no holdings found — this doesn't look like a ${BROKER_LABEL[broker]} holdings export. Check you picked the right broker.`,
      },
      { status: 400 },
    );
  }

  const uni = await loadUniverse();
  const batch = randomUUID();

  const resolved = parsed.map((h) => {
    const symbol = resolveSymbol(h, uni);
    return {
      raw_symbol: h.rawSymbol,
      isin: h.isin,
      symbol,
      is_mapped: symbol !== null,
      quantity: h.quantity,
      avg_cost: h.avgCost,
      broker_ltp: h.brokerLtp,
      broker_cur_value: h.brokerCurValue,
      broker_day_pct: h.brokerDayPct,
    };
  });

  // De-dupe on (raw_symbol) within this file — a broker shouldn't list the
  // same instrument twice, but the UNIQUE(user,broker,raw_symbol) constraint
  // would otherwise abort the insert. Keep the last occurrence.
  const seen = new Map<string, (typeof resolved)[number]>();
  for (const r of resolved) seen.set(r.raw_symbol, r);
  const rows = [...seen.values()];

  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM app.portfolio_holding
       WHERE user_id = ${session.userId} AND broker = ${broker}
    `;
    for (const r of rows) {
      await tx`
        INSERT INTO app.portfolio_holding
          (user_id, broker, raw_symbol, isin, symbol, is_mapped, quantity,
           avg_cost, broker_ltp, broker_cur_value, broker_day_pct, source_batch)
        VALUES
          (${session.userId}, ${broker}, ${r.raw_symbol}, ${r.isin}, ${r.symbol},
           ${r.is_mapped}, ${r.quantity}, ${r.avg_cost}, ${r.broker_ltp},
           ${r.broker_cur_value}, ${r.broker_day_pct}, ${batch})
      `;
    }
  });

  const mapped = rows.filter((r) => r.is_mapped).length;
  const unmapped = rows
    .filter((r) => !r.is_mapped)
    .map((r) => bareSymbol(r.raw_symbol));

  return NextResponse.json({
    ok: true,
    broker,
    brokerLabel: BROKER_LABEL[broker],
    imported: rows.length,
    mapped,
    unmapped: unmapped.length,
    unmappedSymbols: unmapped,
  });
}

export async function DELETE(req: NextRequest) {
  // Remove one broker's holdings (or all) for the signed-in user.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const brokerRaw = req.nextUrl.searchParams.get("broker");
  if (brokerRaw && !isBroker(brokerRaw)) {
    return NextResponse.json({ error: "unknown broker" }, { status: 400 });
  }
  if (brokerRaw) {
    await sql`
      DELETE FROM app.portfolio_holding
       WHERE user_id = ${session.userId} AND broker = ${brokerRaw}
    `;
  } else {
    await sql`DELETE FROM app.portfolio_holding WHERE user_id = ${session.userId}`;
  }
  return NextResponse.json({ ok: true });
}
