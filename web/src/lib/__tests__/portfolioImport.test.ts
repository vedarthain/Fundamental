import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileToMatrix, parseHoldings, PortfolioImportError } from "@/lib/portfolioImport";

const FIX = join(__dirname, "fixtures");
function bytes(file: string): ArrayBuffer {
  const b = readFileSync(join(FIX, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe("parseHoldings: zerodha", () => {
  it("reads the Holdings Statement XLSX and sums split quantity buckets", async () => {
    // Regression: parser only knew the Console CSV `Instrument` header, so the
    // XLSX statement (Symbol/Quantity Available/Pledged/...) dropped every row.
    const m = await fileToMatrix("zerodha-holdings.xlsx", bytes("zerodha-holdings.xlsx"));
    const rows = parseHoldings("zerodha", m);
    expect(rows.length).toBe(3);

    const infy = rows.find((r) => r.rawSymbol === "INFY")!;
    expect(infy.isin).toBe("INE009A01021");
    expect(infy.quantity).toBe(10);
    expect(infy.avgCost).toBe(1500.5);
    expect(infy.brokerLtp).toBe(1620); // Previous Closing Price

    // Pledged-only position (0 available, 4 pledged margin) must still count.
    const tcs = rows.find((r) => r.rawSymbol === "TCS")!;
    expect(tcs.quantity).toBe(4);

    // "Quantity Long Term" is a subset of Available — must NOT be double-counted.
    const one = rows.find((r) => r.rawSymbol === "360ONE")!;
    expect(one.quantity).toBe(8);
  });
});

describe("parseHoldings: fivepaisa", () => {
  it("reads the Equity Portfolio report (two-row header)", async () => {
    const m = await fileToMatrix("fivepaisa-equity-portfolio.xls", bytes("fivepaisa-equity-portfolio.xls"));
    const rows = parseHoldings("fivepaisa", m);
    expect(rows.length).toBe(3);
    const cyient = rows.find((r) => r.rawSymbol === "CYIENT")!;
    expect(cyient).toBeDefined();
    expect(cyient.quantity).toBe(8);
    expect(cyient.avgCost).toBe(1684.05);
    expect(cyient.brokerLtp).toBe(892.65);
  });

  it("REJECTS the Holding Statement with a pointer to the right report", async () => {
    const m = await fileToMatrix("fivepaisa-holding-statement.xls", bytes("fivepaisa-holding-statement.xls"));
    expect(() => parseHoldings("fivepaisa", m)).toThrow(PortfolioImportError);
    expect(() => parseHoldings("fivepaisa", m)).toThrow(/Equity Portfolio/);
  });
});
