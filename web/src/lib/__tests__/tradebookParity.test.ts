/**
 * tradebookParity.test.ts — proves the TypeScript and Python tradebook parsers
 * agree, record for record, on the SAME fixture files.
 *
 * Why this exists:
 *   `web/src/lib/tradebookImport.ts` (the web upload path) and
 *   `scripts/import-tradebooks.py` (the CLI bulk-import path) are two
 *   independent implementations of the same five broker formats. Nothing at
 *   runtime keeps them in step, and they drifted badly: the Fyers Sep-2026
 *   header rename was fixed in TS while Python still died on a bare
 *   StopIteration; Python additionally could not read a Groww CSV, could not
 *   read a real BIFF `.xls` at all, was blind to Zerodha's Title-Case XLSX
 *   headers, and emitted non-ISO trade dates for Upstox and 5paisa.
 *
 *   Every one of those was invisible until someone ran the CLI on a real file.
 *   This test makes the drift fail in CI instead.
 *
 * How:
 *   `import-tradebooks.py --dump-json <broker> <file>` parses with the Python
 *   parsers and prints the normalized records as JSON without touching the DB.
 *   Exit codes are part of that contract — 0 = parsed (possibly zero rows),
 *   3 = TradebookFormatError (not this broker's file). We diff that against
 *   `parseTradebook()` on the identical bytes.
 *
 * If Python is unavailable (no etl venv), the whole suite skips rather than
 * failing — a missing interpreter is an environment gap, not a parser bug.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseTradebook, TradebookFormatError } from "@/lib/tradebookImport";

const REPO = join(__dirname, "..", "..", "..", "..");
const FIX = join(__dirname, "fixtures");
const PY = join(REPO, "etl", ".venv", "bin", "python");
const SCRIPT = join(REPO, "scripts", "import-tradebooks.py");

const canRun = existsSync(PY) && existsSync(SCRIPT);

function bytes(file: string): ArrayBuffer {
  const b = readFileSync(join(FIX, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

type PyRec = Record<string, unknown>;

/** Run the Python dumper. Returns the exit code plus parsed stdout. */
function runPython(broker: string, file: string): { code: number; recs: PyRec[] } {
  const r = spawnSync(PY, [SCRIPT, "--dump-json", broker, join(FIX, file)], {
    encoding: "utf8",
  });
  const code = r.status ?? -1;
  if (code === 3) return { code, recs: [] };
  if (code !== 0) {
    throw new Error(
      `python dumper failed (${broker}/${file}) rc=${code}\n${r.stderr}\n${r.stdout}`,
    );
  }
  return { code, recs: JSON.parse(r.stdout) as PyRec[] };
}

/**
 * Both sides describe the same trade but name fields differently (Python
 * snake_case, TS camelCase) and differ in how they carry the raw clock string.
 * Compare the fields that actually drive downstream behaviour — broker,
 * symbol/name, ISIN, side, quantity, price, date — and leave trade_time out:
 * it is a cosmetic passthrough of the broker's own string and is not used for
 * matching or dedup keys in a way the two runtimes must agree on.
 */
type Norm = {
  broker: string;
  rawSymbol: string;
  rawName: string;
  isin: string;
  side: string;
  quantity: number | null;
  price: number | null;
  tradeDate: string;
};

function normPy(r: PyRec): Norm {
  return {
    broker: String(r.broker ?? ""),
    rawSymbol: String(r.raw_symbol ?? ""),
    rawName: String(r.raw_name ?? ""),
    isin: String(r.isin ?? ""),
    side: String(r.side ?? ""),
    quantity: r.quantity == null ? null : Number(r.quantity),
    price: r.price == null ? null : round4(Number(r.price)),
    tradeDate: String(r.trade_date ?? ""),
  };
}

function normTs(r: {
  broker: string;
  rawSymbol: string;
  rawName: string;
  isin: string;
  side: string;
  quantity: number | null;
  price: number | null;
  tradeDate: string;
}): Norm {
  return {
    broker: r.broker,
    rawSymbol: r.rawSymbol ?? "",
    rawName: r.rawName ?? "",
    isin: r.isin ?? "",
    side: r.side ?? "",
    quantity: r.quantity == null ? null : Number(r.quantity),
    price: r.price == null ? null : round4(Number(r.price)),
    tradeDate: r.tradeDate ?? "",
  };
}

/** Groww derives price as value/qty; the two runtimes' float tails can differ
 *  in the last ulp. Four decimals is finer than any Indian tick size. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

const describeIf = canRun ? describe : describe.skip;

describeIf("TS ↔ Python tradebook parser parity", () => {
  const CASES: Array<{ broker: string; file: string }> = [
    { broker: "zerodha", file: "zerodha-tradebook.csv" },
    { broker: "zerodha", file: "zerodha-tradebook.xlsx" },
    { broker: "fyers", file: "fyers-tradebook.csv" },
    { broker: "fyers", file: "fyers-tradebook-symbolname.csv" },
    { broker: "groww", file: "groww-order-history-empty.csv" },
    { broker: "fivepaisa", file: "fivepaisa-trade-report.xls" },
  ];

  for (const { broker, file } of CASES) {
    it(`${broker} / ${file} — same records from both runtimes`, async () => {
      const { code, recs } = runPython(broker, file);
      expect(code).toBe(0);
      const ts = await parseTradebook(
        broker as Parameters<typeof parseTradebook>[0],
        file,
        bytes(file),
      );
      expect(recs.length).toBe(ts.length);
      expect(recs.map(normPy)).toEqual(ts.map(normTs));
    });
  }

  it("both runtimes reject a wrong-broker file (py rc=3 / ts throws)", async () => {
    const WRONG = "groww-order-history-empty.csv";
    for (const broker of ["zerodha", "fyers", "upstox"] as const) {
      expect(runPython(broker, WRONG).code).toBe(3);
      await expect(parseTradebook(broker, WRONG, bytes(WRONG))).rejects.toBeInstanceOf(
        TradebookFormatError,
      );
    }
  });

  it("an empty-but-valid export is zero rows, not an error, on both sides", async () => {
    const EMPTY = "groww-order-history-empty.csv";
    const { code, recs } = runPython("groww", EMPTY);
    expect(code).toBe(0);
    expect(recs).toEqual([]);
    expect(await parseTradebook("groww", EMPTY, bytes(EMPTY))).toEqual([]);
  });
});
