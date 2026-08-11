/**
 * POST /api/portfolio/import-trades — import a broker TRADEBOOK (trade history).
 *
 * multipart/form-data: { broker, file }. Session-gated (401 otherwise).
 *
 * Distinct from /api/portfolio/import, which loads a CURRENT-HOLDINGS snapshot.
 * A tradebook is the per-trade log. We APPEND trades (never replace) — each
 * export is a slice of history — and dedup on dedup_key so re-uploading an
 * overlapping window is idempotent (ON CONFLICT DO NOTHING).
 *
 * After the trades land we recompute the derived holding for every affected
 * symbol (derivedHoldings.ts): a symbol with NO real broker snapshot gets a
 * synthetic broker='derived' position computed from its trades; a symbol that
 * DOES have a snapshot keeps the snapshot (snapshot-wins) and its derived row is
 * dropped. So the same import updates both the B/S chart markers (transactions)
 * and the Holdings table (derived positions) in one shot.
 *
 * Rows that don't resolve to app.universe (ETFs/MF units) are skipped — the
 * equity universe has none, and a transaction with no symbol can't be priced.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { BROKERS, BROKER_LABEL, type UploadBroker } from "@/lib/portfolioImport";
import {
  parseTradebook,
  buildTradeUniverse,
  resolveTradeSymbol,
  tradeDedupKey,
  type TradeUniverse,
} from "@/lib/tradebookImport";
import { recomputeDerivedHoldings } from "@/lib/derivedHoldings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — tradebooks can span years

function isBroker(x: string): x is UploadBroker {
  return (BROKERS as readonly string[]).includes(x);
}

async function loadUniverse(): Promise<TradeUniverse> {
  const rows = await sql<{ symbol: string; isin: string | null; company_name: string | null }[]>`
    SELECT symbol, isin, company_name FROM app.universe WHERE is_active
  `;
  return buildTradeUniverse(rows);
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
    return NextResponse.json({ error: "file too large (max 5 MB)" }, { status: 400 });
  }

  const buf = await file.arrayBuffer();

  let parsed;
  try {
    parsed = await parseTradebook(broker, file.name, buf);
  } catch {
    return NextResponse.json(
      { error: "couldn't read that file — is it the tradebook export for this broker?" },
      { status: 400 },
    );
  }

  // Keep only real buys/sells (parsers may pass through other statuses/sides).
  parsed = parsed.filter((t) => t.side === "buy" || t.side === "sell");

  if (parsed.length === 0) {
    return NextResponse.json(
      {
        error: `no trades found — this doesn't look like a ${BROKER_LABEL[broker]} tradebook export. Check you picked the right broker.`,
      },
      { status: 400 },
    );
  }

  const uni = await loadUniverse();

  // Resolve symbols; drop rows we can't map (ETFs/MF units) or that are missing
  // the fields we need to record a trade.
  const skippedSymbols = new Set<string>();
  const rows = parsed
    .map((t) => {
      const symbol = resolveTradeSymbol(t, uni);
      return { t, symbol };
    })
    .filter(({ t, symbol }) => {
      if (!symbol) {
        skippedSymbols.add(t.rawSymbol || t.rawName || "?");
        return false;
      }
      if (t.quantity == null || t.quantity <= 0 || t.price == null || t.price < 0) return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.tradeDate)) return false;
      return true;
    })
    .map(({ t, symbol }) => ({
      ...t,
      symbol: symbol!,
      dedupKey: tradeDedupKey({ ...t, symbol: symbol! }),
    }));

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "no usable trades — every row was outside coverage or missing a date/quantity/price.",
      },
      { status: 400 },
    );
  }

  // De-dupe within this file on dedup_key (an export can repeat a trade row).
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byKey.set(r.dedupKey, r);
  const uniqueRows = [...byKey.values()];

  const coveredSymbols = [...new Set(uniqueRows.map((r) => r.symbol))];

  let inserted = 0;
  await sql.begin(async (tx) => {
    for (const r of uniqueRows) {
      const res = await tx`
        INSERT INTO app.portfolio_transaction
          (user_id, broker, trade_date, trade_time, side, symbol, raw_symbol,
           raw_name, isin, quantity, price, trade_id, order_id, source_file, dedup_key)
        VALUES
          (${session.userId}, ${broker}, ${r.tradeDate}, ${r.tradeTime || null}, ${r.side},
           ${r.symbol}, ${r.rawSymbol || r.symbol}, ${r.rawName || null},
           ${r.isin || null}, ${r.quantity}, ${r.price}, ${r.tradeId || null},
           ${r.orderId || null}, ${file.name}, ${r.dedupKey})
        ON CONFLICT (dedup_key) DO NOTHING
      `;
      inserted += res.count;
    }
    await recomputeDerivedHoldings(tx, session.userId, coveredSymbols);
  });

  const dates = uniqueRows.map((r) => r.tradeDate).sort();

  return NextResponse.json({
    ok: true,
    broker,
    brokerLabel: BROKER_LABEL[broker],
    parsed: parsed.length,
    imported: inserted,
    skipped: uniqueRows.length - inserted, // already-present (deduped) trades
    mappedSymbols: coveredSymbols.length,
    outsideCoverage: [...skippedSymbols],
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
  });
}
