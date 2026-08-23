import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileToMatrix, parseHoldings, PortfolioImportError } from "@/lib/portfolioImport";

const FIX = join(__dirname, "fixtures");
function bytes(file: string): ArrayBuffer {
  const b = readFileSync(join(FIX, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

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
