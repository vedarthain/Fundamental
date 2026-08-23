import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTradebook,
  toIso,
  buildTradeUniverse,
  resolveTradeSymbol,
  type ParsedTrade,
} from "@/lib/tradebookImport";

const FIX = join(__dirname, "fixtures");
function bytes(file: string): ArrayBuffer {
  const b = readFileSync(join(FIX, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

// ─────────────────────────────── toIso ─────────────────────────────────────
describe("toIso date normalisation", () => {
  it("passes through ISO", () => {
    expect(toIso("2026-08-19")).toBe("2026-08-19");
    expect(toIso("2026-08-19T09:22:30")).toBe("2026-08-19");
  });
  it("handles DD-MM-YYYY and DD/MM/YYYY", () => {
    expect(toIso("19-08-2026")).toBe("2026-08-19");
    expect(toIso("19/08/2026")).toBe("2026-08-19");
  });
  it("handles the 5paisa month-name form 'Mon DD YYYY'", () => {
    // Regression: previously returned "Aug", failing the route's date gate.
    expect(toIso("Aug 19 2026")).toBe("2026-08-19");
    expect(toIso("Jul 02 2026")).toBe("2026-07-02");
    expect(toIso("January 5, 2026")).toBe("2026-01-05");
  });
  it("handles the 'DD Mon YYYY' form", () => {
    expect(toIso("19 Aug 2026")).toBe("2026-08-19");
    expect(toIso("02-Jul-2026")).toBe("2026-07-02");
  });
});

// ─────────────────────────── Zerodha tradebook ─────────────────────────────
describe("parseTradebook: zerodha", () => {
  it("reads the XLSX export (Title Case headers)", async () => {
    // Regression: header detection only matched CSV's lowercase_underscore keys.
    const t = await parseTradebook("zerodha", "zerodha-tradebook.xlsx", bytes("zerodha-tradebook.xlsx"));
    expect(t.length).toBe(3);
    const first = t[0];
    expect(first.rawSymbol).toBe("INFY");
    expect(first.isin).toBe("INE009A01021");
    expect(first.side).toBe("buy");
    expect(first.quantity).toBe(10);
    expect(first.price).toBe(1500.5);
    expect(first.tradeDate).toBe("2026-06-19");
  });

  it("still reads the CSV export (lowercase_underscore headers)", async () => {
    const t = await parseTradebook("zerodha", "zerodha-tradebook.csv", bytes("zerodha-tradebook.csv"));
    expect(t.length).toBe(2);
    expect(t[0].rawSymbol).toBe("INFY");
    expect(t[1].side).toBe("sell");
  });
});

// ─────────────────────────── 5paisa tradebook ──────────────────────────────
describe("parseTradebook: fivepaisa", () => {
  it("reads the Equity Transaction Report and normalises 'Aug 19 2026' dates", async () => {
    const t = await parseTradebook("fivepaisa", "fivepaisa-trade-report.xls", bytes("fivepaisa-trade-report.xls"));
    expect(t.length).toBe(3);
    // Every row must carry an ISO date — the whole file regressed on this.
    for (const row of t) expect(row.tradeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t[0].rawName).toBe("Redington");
    expect(t[0].tradeDate).toBe("2026-08-19");
    expect(t[0].side).toBe("sell");
  });
});

// ─────────────────────────── Fyers tradebook ───────────────────────────────
describe("parseTradebook: fyers", () => {
  it("reads the CSV export (preamble, 'Date & time', full company names)", async () => {
    // Regression: the whole file parsed to 0 rows — a Status filter dropped every
    // Status-less row, and the "Date & Time" key missed the real "Date & time".
    const t = await parseTradebook("fyers", "fyers-tradebook.csv", bytes("fyers-tradebook.csv"));
    expect(t.length).toBe(4);
    for (const row of t) expect(row.tradeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Two partial fills of one order must survive as distinct trades (empty
    // tradeId → dedup falls back to the qty/price/time composite).
    const steel = t.filter((r) => r.rawName === "STEELCAST LIMITED");
    expect(steel.length).toBe(2);
    expect(steel.every((r) => r.tradeId === "")).toBe(true);
    expect(new Set(steel.map((r) => r.quantity))).toEqual(new Set([30, 15]));
    expect(steel[0].tradeDate).toBe("2026-08-05");
    expect(steel[0].side).toBe("buy");
  });
});

// ────────────────────── name resolution (exact-match fix) ───────────────────
describe("resolveTradeSymbol", () => {
  const uni = buildTradeUniverse([
    { symbol: "RAYMOND", isin: "INE301A01014", company_name: "Raymond Limited" },
    { symbol: "RAYMONDLSL", isin: "INE0BS701011", company_name: "Raymond Lifestyle Limited" },
    { symbol: "RAYMONDREL", isin: "INE0OZ801011", company_name: "Raymond Realty Limited" },
    { symbol: "REDINGTON", isin: "INE891D01026", company_name: "Redington Limited" },
    { symbol: "INFY", isin: "INE009A01021", company_name: "Infosys Limited" },
    { symbol: "CHOLAFIN", isin: "INE121A01024", company_name: "Cholamandalam Investment and Finance Company Limited" },
    { symbol: "CHOLAHLDNG", isin: "INE149A01033", company_name: "Cholamandalam Financial Holdings Limited" },
  ]);
  const trade = (over: Partial<ParsedTrade>): ParsedTrade => ({
    broker: "fivepaisa", rawSymbol: "", rawName: "", isin: "", side: "sell",
    quantity: 1, price: 1, tradeDate: "2026-08-19", tradeTime: "", tradeId: "", orderId: "",
    ...over,
  });

  it("prefers an EXACT normalised-name match over a shorter prefix collision", () => {
    // Regression: "Raymond Lifestyle" also prefix-matched "Raymond" and dropped.
    expect(resolveTradeSymbol(trade({ rawName: "Raymond Lifestyle" }), uni)).toBe("RAYMONDLSL");
    expect(resolveTradeSymbol(trade({ rawName: "Raymond" }), uni)).toBe("RAYMOND");
    expect(resolveTradeSymbol(trade({ rawName: "Redington" }), uni)).toBe("REDINGTON");
  });

  it("resolves a broker-TRUNCATED name via the token-prefix fallback", () => {
    // Fyers abbreviates: "CHOLAMANDALAM IN & FIN CO" for "Cholamandalam
    // Investment and Finance Company". Each trade token prefixes a distinct
    // universe token → CHOLAFIN, and it stays ambiguous-safe against CHOLAHLDNG
    // (Financial Holdings), where "IN"/"CO" match nothing.
    expect(resolveTradeSymbol(trade({ rawName: "CHOLAMANDALAM IN & FIN CO" }), uni)).toBe("CHOLAFIN");
  });

  it("resolves by ISIN when present", () => {
    expect(resolveTradeSymbol(trade({ isin: "INE009A01021", rawName: "Something Else" }), uni)).toBe("INFY");
  });

  it("returns null for an out-of-universe instrument (ETF)", () => {
    expect(resolveTradeSymbol(trade({ rawName: "CPSE ETF" }), uni)).toBeNull();
  });
});
