/**
 * Broker TRANSACTION exports (tradebooks) → normalised trade rows.
 *
 * Distinct from portfolioImport.ts, which reads CURRENT-HOLDINGS snapshots.
 * A tradebook is the per-trade history (buy/sell, date, price) that drives the
 * B/S chart markers AND, for symbols without a snapshot, the derived holding
 * (see derivedHoldings.ts). Ported 1:1 from scripts/import-tradebooks.py — the
 * column mappings were validated against real exports; don't "tidy" them
 * without re-checking a real file (headers and column order differ per broker).
 *
 * Five formats:
 *   zerodha  — CSV, header row has "symbol"+"trade_type"
 *   fyers    — CSV, header row starts "Name"; symbol as "NSE:SYM-EQ"
 *   groww    — XLSX (first sheet), header "Stock name"; price = Value/Qty
 *   upstox   — XLSX (sheet "TRADE"), header "Date"
 *   fivepaisa— XLS  (first sheet), header "Transaction Date"
 */
import "server-only";
import { createHash } from "crypto";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { parseCsv, bareSymbol, type UploadBroker } from "@/lib/portfolioImport";

export type ParsedTrade = {
  broker: UploadBroker;
  rawSymbol: string;
  rawName: string;
  isin: string;
  side: string; // 'buy' | 'sell' after normalisation (others dropped upstream)
  quantity: number | null;
  price: number | null;
  tradeDate: string; // YYYY-MM-DD
  tradeTime: string;
  tradeId: string;
  orderId: string;
};

// ─────────────────────────── cell / number / date ──────────────────────────

function cellToString(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("text" in o && typeof o.text === "string") return o.text.trim();
    if ("result" in o && o.result != null) return String(o.result).trim();
    if ("richText" in o && Array.isArray(o.richText)) {
      return o.richText.map((t) => (t as { text?: string }).text ?? "").join("").trim();
    }
  }
  return String(v).trim();
}

function num(x: string | undefined): number | null {
  if (x == null) return null;
  const s = String(x).replace(/,/g, "").trim();
  if (s === "" || s === "-") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** Normalise a date token to YYYY-MM-DD. Accepts ISO (incl. "…T…"), DD-MM-YYYY
 *  and DD/MM/YYYY. Anything else is returned as-is (caller may drop it). */
export function toIso(s: string): string {
  const head = String(s).trim().split(/[ T]/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  let m = head.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = head.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return head;
}

function normalizeSide(s: string): string {
  const v = s.trim().toLowerCase();
  if (v === "b" || v === "buy" || v === "bought") return "buy";
  if (v === "s" || v === "sell" || v === "sold") return "sell";
  return v;
}

// ─────────────────────────── matrix loaders ────────────────────────────────

async function xlsxMatrix(buf: ArrayBuffer, sheet?: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = (sheet && wb.getWorksheet(sheet)) || wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    const n = row.cellCount;
    for (let c = 1; c <= n; c++) cells.push(cellToString(row.getCell(c).value));
    out.push(cells);
  });
  return out;
}

function xlsMatrix(buf: ArrayBuffer, sheet?: string): string[][] {
  const wb = XLSX.read(buf, { type: "array" });
  const name = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1, blankrows: true, raw: false, defval: "",
  });
  return rows.map((r) => r.map((c) => String(c ?? "").trim()));
}

async function toMatrix(filename: string, buf: ArrayBuffer, sheet?: string): Promise<string[][]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) return xlsxMatrix(buf, sheet);
  if (lower.endsWith(".xls")) return xlsMatrix(buf, sheet);
  return parseCsv(new TextDecoder("utf-8").decode(buf));
}

// ─────────────────────────── header → objects ──────────────────────────────

function headerIndex(rows: string[][], pred: (r: string[]) => boolean): number {
  for (let i = 0; i < rows.length; i++) if (pred(rows[i])) return i;
  return -1;
}

/** Rows below the matched header, each as an object keyed by header cell. */
function asObjects(rows: string[][], hidx: number): Record<string, string>[] {
  const hdr = rows[hidx].map((c) => c.trim());
  const out: Record<string, string>[] = [];
  for (let i = hidx + 1; i < rows.length; i++) {
    const r = rows[i];
    const o: Record<string, string> = {};
    for (let c = 0; c < hdr.length; c++) if (hdr[c]) o[hdr[c]] = (r[c] ?? "").trim();
    out.push(o);
  }
  return out;
}

// ─────────────────────────── per-broker parsers ────────────────────────────

function parseZerodha(rows: string[][]): ParsedTrade[] {
  const h = headerIndex(rows, (r) => r.includes("symbol") && r.includes("trade_type"));
  if (h < 0) return [];
  return asObjects(rows, h)
    .filter((d) => d.symbol)
    .map((d) => ({
      broker: "zerodha" as const,
      rawSymbol: d.symbol, rawName: d.symbol, isin: (d.isin ?? "").trim(),
      side: normalizeSide(d.trade_type ?? ""),
      quantity: num(d.quantity), price: num(d.price),
      tradeDate: toIso(d.trade_date ?? ""), tradeTime: (d.order_execution_time ?? "").trim(),
      tradeId: (d.trade_id ?? "").trim(), orderId: (d.order_id ?? "").trim(),
    }));
}

function parseFyers(rows: string[][]): ParsedTrade[] {
  const h = headerIndex(rows, (r) => r[0] === "Name");
  if (h < 0) return [];
  const out: ParsedTrade[] = [];
  for (const d of asObjects(rows, h)) {
    if (!d.Name) continue;
    if ((d.Status ?? "").trim() !== "Executed") continue;
    const m = d.Name.match(/^[A-Z]+:(.+)-[A-Z]+$/);
    const sym = m ? m[1] : d.Name;
    out.push({
      broker: "fyers", rawSymbol: sym, rawName: sym, isin: "",
      side: normalizeSide(d.Side ?? ""),
      quantity: num(d.Qty), price: num(d["Traded price"]),
      tradeDate: toIso(d["Date & Time"] ?? ""),
      tradeTime: (d["Date & Time"] ?? "").split(" ").slice(1).join(" ").trim(),
      tradeId: (d["Exchange order ID"] ?? "").replace(/[^0-9.]/g, ""),
      orderId: (d["OMS order ID"] ?? "").replace(/[^0-9.]/g, ""),
    });
  }
  return out;
}

function parseGroww(rows: string[][]): ParsedTrade[] {
  const h = headerIndex(rows, (r) => (r[0] ?? "").trim() === "Stock name");
  if (h < 0) return [];
  const out: ParsedTrade[] = [];
  for (const d of asObjects(rows, h)) {
    if (!d.Symbol) continue;
    if ((d["Order status"] ?? "").trim() !== "Executed") continue;
    const q = num(d.Quantity);
    const val = num(d.Value);
    out.push({
      broker: "groww", rawSymbol: d.Symbol.trim(), rawName: (d["Stock name"] ?? "").trim(),
      isin: (d.ISIN ?? "").trim(), side: normalizeSide(d.Type ?? ""),
      quantity: q, price: val != null && q ? val / q : null,
      tradeDate: toIso(d["Execution date and time"] ?? ""),
      tradeTime: (d["Execution date and time"] ?? "").trim(),
      tradeId: "", orderId: (d["Exchange Order Id"] ?? "").trim(),
    });
  }
  return out;
}

function parseUpstox(rows: string[][]): ParsedTrade[] {
  const h = headerIndex(rows, (r) => (r[0] ?? "").trim() === "Date");
  if (h < 0) return [];
  return asObjects(rows, h)
    .filter((d) => d.Company)
    .map((d) => ({
      broker: "upstox" as const,
      rawSymbol: (d["Scrip Code"] ?? "").trim(), rawName: d.Company.trim(), isin: "",
      side: normalizeSide(d.Side ?? ""),
      quantity: num(d.Quantity), price: num(d.Price),
      tradeDate: toIso(d.Date ?? ""), tradeTime: (d["Trade Time"] ?? "").trim(),
      tradeId: (d["Trade Num"] ?? "").trim(), orderId: "",
    }));
}

function parseFivepaisa(rows: string[][]): ParsedTrade[] {
  const h = headerIndex(rows, (r) => (r[0] ?? "").trim() === "Transaction Date");
  if (h < 0) return [];
  return asObjects(rows, h)
    .filter((d) => d["Company Name"])
    .map((d) => ({
      broker: "fivepaisa" as const,
      rawSymbol: "", rawName: d["Company Name"].trim(), isin: "",
      side: normalizeSide(d.Type ?? ""),
      quantity: num(d.Quantity), price: num(d.Price),
      tradeDate: toIso(d["Transaction Date"] ?? ""), tradeTime: "",
      tradeId: "", orderId: "",
    }));
}

const SHEET: Partial<Record<UploadBroker, string>> = { upstox: "TRADE" };

/** Parse a tradebook file for a known broker into normalised trade rows. */
export async function parseTradebook(
  broker: UploadBroker,
  filename: string,
  buf: ArrayBuffer,
): Promise<ParsedTrade[]> {
  const rows = await toMatrix(filename, buf, SHEET[broker]);
  switch (broker) {
    case "zerodha": return parseZerodha(rows);
    case "fyers": return parseFyers(rows);
    case "groww": return parseGroww(rows);
    case "upstox": return parseUpstox(rows);
    case "fivepaisa": return parseFivepaisa(rows);
  }
}

// ─────────────────────────── universe resolution ───────────────────────────

export type TradeUniverse = {
  byIsin: Map<string, string>;
  bySym: Map<string, string>;
  byName: { norm: string; symbol: string }[];
};

/** Strip company-name noise for the fuzzy name-prefix fallback. */
export function normalizeName(n: string | null): string {
  if (!n) return "";
  let s = n.toUpperCase();
  for (const junk of [" LIMITED", " LTD", " INDUSTRIES", " INDIA", ".", ",", "-", "&"]) {
    s = s.split(junk).join(" ");
  }
  return s.replace(/\s+/g, " ").trim();
}

export function buildTradeUniverse(
  rows: { symbol: string; isin: string | null; company_name: string | null }[],
): TradeUniverse {
  const byIsin = new Map<string, string>();
  const bySym = new Map<string, string>();
  const byName: { norm: string; symbol: string }[] = [];
  for (const r of rows) {
    if (r.isin) byIsin.set(r.isin.trim().toUpperCase(), r.symbol);
    bySym.set(r.symbol.toUpperCase(), r.symbol);
    byName.push({ norm: normalizeName(r.company_name), symbol: r.symbol });
  }
  return { byIsin, bySym, byName };
}

/** ISIN → exact symbol → unique normalized-name prefix. null if unresolved
 *  (ETFs/MF units never resolve — the equity universe has none). */
export function resolveTradeSymbol(t: ParsedTrade, uni: TradeUniverse): string | null {
  if (t.isin) {
    const s = uni.byIsin.get(t.isin.trim().toUpperCase());
    if (s) return s;
  }
  if (t.rawSymbol) {
    const s = uni.bySym.get(bareSymbol(t.rawSymbol).toUpperCase()) ?? uni.bySym.get(t.rawSymbol.trim().toUpperCase());
    if (s) return s;
  }
  const nn = normalizeName(t.rawName);
  if (nn.length >= 4) {
    const hits = new Set<string>();
    for (const { norm, symbol } of uni.byName) {
      if (norm && (norm.startsWith(nn) || nn.startsWith(norm))) hits.add(symbol);
    }
    if (hits.size === 1) return [...hits][0];
  }
  return null;
}

/** Trade-level dedup key: trade_id when present, else the natural composite. */
export function tradeDedupKey(t: ParsedTrade & { symbol: string }): string {
  const raw = t.tradeId
    ? `${t.broker}|tid|${t.tradeId}`
    : `${t.broker}|${t.tradeDate}|${t.symbol}|${t.side}|${t.quantity}|${t.price}|${t.tradeTime}`;
  return createHash("md5").update(raw).digest("hex");
}
