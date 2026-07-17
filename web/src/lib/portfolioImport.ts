/**
 * Broker holdings CSV/XLSX → normalised rows.
 *
 * Five brokers, five slightly-different export shapes. Each is a CURRENT
 * holdings snapshot (no transaction history) — see 0041_portfolio.sql. We
 * parse to a common `ParsedHolding`, then resolve each row to our scoring
 * universe by ISIN first (reliable 1:1 join) then bare symbol.
 *
 * Column mappings below were validated against real exports from each
 * broker; do not "tidy" them without re-checking a real file — headers and
 * column order differ per broker and a wrong index silently mis-imports.
 *
 * Format layer: broker portals hand out .csv or .xlsx. exceljs reads both
 * .xlsx and .csv, but NOT legacy binary .xls — 5paisa's default. Callers
 * must re-save .xls as .csv/.xlsx before upload (the import route rejects
 * .xls with a clear message).
 */
import "server-only";
import ExcelJS from "exceljs";

export const BROKERS = ["upstox", "zerodha", "fyers", "fivepaisa", "groww"] as const;
export type Broker = (typeof BROKERS)[number];

export const BROKER_LABEL: Record<Broker, string> = {
  upstox: "Upstox",
  zerodha: "Zerodha",
  fyers: "Fyers",
  fivepaisa: "5paisa",
  groww: "Groww",
};

/** One holding as pulled from a broker file, before universe resolution. */
export type ParsedHolding = {
  rawSymbol: string; // the broker's own identifier (audit + fallback key)
  isin: string | null; // present for fyers/groww; null otherwise
  quantity: number;
  avgCost: number | null; // per-share buy price
  brokerLtp: number | null; // broker's last price at export
  brokerCurValue: number | null; // broker's current value at export
  brokerDayPct: number | null; // broker's day-change % at export
};

// ─────────────────────────── CSV / XLSX → rows ─────────────────────────────

/** RFC-ish CSV parser: handles quoted fields, escaped quotes, commas inside
 *  quotes. Returns a matrix of trimmed string cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // swallow — \r\n handled by the \n branch
    } else {
      cell += ch;
    }
  }
  // trailing cell / row (no final newline)
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

/** Read an uploaded .xlsx into the same matrix shape parseCsv produces.
 *  Reads the first worksheet only — broker exports are single-sheet. */
async function xlsxToMatrix(buf: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    // row.values is 1-indexed with a leading hole; walk columns explicitly.
    const n = row.cellCount;
    for (let c = 1; c <= n; c++) {
      const v = row.getCell(c).value;
      cells.push(cellToString(v));
    }
    out.push(cells);
  });
  return out;
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    // rich text / hyperlink / formula result objects
    const o = v as unknown as Record<string, unknown>;
    if ("text" in o && typeof o.text === "string") return o.text.trim();
    if ("result" in o && o.result != null) return String(o.result).trim();
    if ("richText" in o && Array.isArray(o.richText)) {
      return o.richText.map((t) => (t as { text?: string }).text ?? "").join("").trim();
    }
  }
  return String(v).trim();
}

/** Turn an uploaded file into a cell matrix, from filename + bytes. */
export async function fileToMatrix(filename: string, buf: ArrayBuffer): Promise<string[][]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) return xlsxToMatrix(buf);
  if (lower.endsWith(".xls")) {
    throw new PortfolioImportError(
      "Legacy .xls files aren't supported. Open it in Excel/Sheets and re-save as .csv or .xlsx, then upload again.",
    );
  }
  // default: treat as CSV (also covers .txt exports)
  const text = new TextDecoder("utf-8").decode(buf);
  return parseCsv(text);
}

export class PortfolioImportError extends Error {}

// ─────────────────────────── number cleaning ───────────────────────────────

/** Broker numerics carry commas, %, +, and use "" / "-" for null. */
function n(x: string | undefined): number | null {
  if (x == null) return null;
  const s = x.replace(/[,%+]/g, "").replace(/\s/g, "").trim();
  if (s === "" || s === "-" || s === "—") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** Find the index of the header row matching `pred`, or -1. */
function findRow(rows: string[][], pred: (r: string[]) => boolean): number {
  for (let i = 0; i < rows.length; i++) if (pred(rows[i])) return i;
  return -1;
}

// ─────────────────────────── per-broker parsers ────────────────────────────

function parseFyers(rows: string[][]): ParsedHolding[] {
  // header: r[0]==="Name" && last==="ISIN". Cols: Name,Qty,Buy,Invested,
  // Current,UPL,UPL%,PrevClose,ISIN. Name like "NSE:NTPC-EQ".
  const h = findRow(rows, (r) => r[0] === "Name" && r[r.length - 1] === "ISIN");
  if (h < 0) return [];
  const out: ParsedHolding[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || r.length < 9) continue;
    const qty = n(r[1]);
    if (qty == null) continue;
    const cur = n(r[4]);
    out.push({
      rawSymbol: r[0],
      isin: r[8] || null,
      quantity: qty,
      avgCost: n(r[2]),
      brokerLtp: cur != null && qty ? Math.round((cur / qty) * 100) / 100 : null,
      brokerCurValue: cur,
      brokerDayPct: null,
    });
  }
  return out;
}

function parseZerodha(rows: string[][]): ParsedHolding[] {
  // header: r[0]==="Instrument". Cols: Instrument,Qty.,Avg. cost,LTP,
  // Invested,Cur. val,P&L,Net chg.,Day chg.
  const h = findRow(rows, (r) => r[0] === "Instrument");
  if (h < 0) return [];
  const out: ParsedHolding[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    const qty = n(r[1]);
    if (qty == null) continue;
    out.push({
      rawSymbol: r[0],
      isin: null,
      quantity: qty,
      avgCost: n(r[2]),
      brokerLtp: n(r[3]),
      brokerCurValue: n(r[5]),
      brokerDayPct: n(r[8]),
    });
  }
  return out;
}

function parseFivepaisa(rows: string[][]): ParsedHolding[] {
  // two-row header; detect r[0]==="Company" && r[4]==="Price". Cols:
  // Company,Quantity,Avg.Price,Total Investment,Price,Value,UGL val,UGL%,
  // Day val,Day%.
  const h = findRow(rows, (r) => r[0] === "Company" && r[4] === "Price");
  if (h < 0) return [];
  const out: ParsedHolding[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || r[0] === "Company") continue;
    const qty = n(r[1]);
    if (qty == null) continue;
    out.push({
      rawSymbol: r[0],
      isin: null,
      quantity: qty,
      avgCost: n(r[2]),
      brokerLtp: n(r[4]),
      brokerCurValue: n(r[5]),
      brokerDayPct: n(r[9]),
    });
  }
  return out;
}

function parseUpstox(rows: string[][]): ParsedHolding[] {
  // header: r[0].startsWith("Symbol") && r[1]==="Category". Cols: Symbol,
  // Category,Net Qty,Avg. Price,LTP,Current Value,Day P&L,Day %,Overall P&L,
  // Overall %.
  const h = findRow(rows, (r) => (r[0] ?? "").startsWith("Symbol") && r[1] === "Category");
  if (h < 0) return [];
  const out: ParsedHolding[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    const qty = n(r[2]);
    if (qty == null) continue;
    out.push({
      rawSymbol: r[0],
      isin: null,
      quantity: qty,
      avgCost: n(r[3]),
      brokerLtp: n(r[4]),
      brokerCurValue: n(r[5]),
      brokerDayPct: n(r[7]),
    });
  }
  return out;
}

function parseGroww(rows: string[][]): ParsedHolding[] {
  // header: r[0]==="Stock Name" && r[1]==="ISIN". Cols: Stock Name,ISIN,
  // Quantity,Average buy price,Buy value,Closing price,Closing value,UPL.
  const h = findRow(rows, (r) => r[0] === "Stock Name" && r[1] === "ISIN");
  if (h < 0) return [];
  const out: ParsedHolding[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || r.length < 7) continue;
    const qty = n(r[2]);
    if (qty == null) continue;
    out.push({
      rawSymbol: r[0],
      isin: r[1] || null,
      quantity: qty,
      avgCost: n(r[3]),
      brokerLtp: n(r[5]),
      brokerCurValue: n(r[6]),
      brokerDayPct: null,
    });
  }
  return out;
}

const PARSERS: Record<Broker, (rows: string[][]) => ParsedHolding[]> = {
  fyers: parseFyers,
  zerodha: parseZerodha,
  fivepaisa: parseFivepaisa,
  upstox: parseUpstox,
  groww: parseGroww,
};

/** Parse an already-loaded matrix for a known broker. */
export function parseHoldings(broker: Broker, rows: string[][]): ParsedHolding[] {
  return PARSERS[broker](rows);
}

// ─────────────────────────── universe resolution ───────────────────────────

/** Strip broker decoration to a bare NSE symbol for the symbol-fallback join.
 *  Fyers uses "NSE:NTPC-EQ"; the rest are already close to bare. */
export function bareSymbol(raw: string): string {
  let s = raw.toUpperCase().trim();
  const colon = s.lastIndexOf(":");
  if (colon >= 0) s = s.slice(colon + 1); // drop "NSE:" prefix
  s = s.replace(/-EQ$/, "").replace(/-BE$/, "");
  return s.trim();
}

export type UniverseMap = {
  byIsin: Map<string, string>; // isin → symbol
  bySym: Map<string, string>; // symbol → symbol (identity, for membership)
};

/** Resolve a parsed holding to an app.universe symbol, or null if outside
 *  our scoring coverage (ETFs, gold/silver funds, AMC index funds). */
export function resolveSymbol(h: ParsedHolding, uni: UniverseMap): string | null {
  if (h.isin && uni.byIsin.has(h.isin)) return uni.byIsin.get(h.isin)!;
  const bare = bareSymbol(h.rawSymbol);
  if (uni.bySym.has(bare)) return uni.bySym.get(bare)!;
  return null;
}
