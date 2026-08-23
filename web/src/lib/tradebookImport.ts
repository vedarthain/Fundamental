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
 *   fyers    — CSV, preamble then header starting "Name"; Name is a full
 *              company name; datetime in "Date & time" as "DD Mon YYYY, hh:mm:ss AM"
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

/** Month-name → 2-digit, keyed on the first three letters (Jan…Dec). */
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Normalise a date token to YYYY-MM-DD. Accepts ISO (incl. "…T…"), DD-MM-YYYY,
 *  DD/MM/YYYY, and month-name forms "Mon DD YYYY" / "DD Mon YYYY" (5paisa's
 *  Trade Report writes "Aug 19 2026"). Anything else is returned as-is (caller
 *  may drop it). */
export function toIso(s: string): string {
  const raw = String(s).trim();
  // Month-name forms first — they contain spaces, so they must be matched on the
  // whole string BEFORE the space-split below turns "Aug 19 2026" into "Aug".
  let mm = raw.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/); // Mon DD YYYY
  if (mm) {
    const mo = MONTHS[mm[1].slice(0, 3).toLowerCase()];
    if (mo) return `${mm[3]}-${mo}-${mm[2].padStart(2, "0")}`;
  }
  mm = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})\.?,?[-\s](\d{4})$/); // DD Mon YYYY
  if (mm) {
    const mo = MONTHS[mm[2].slice(0, 3).toLowerCase()];
    if (mo) return `${mm[3]}-${mo}-${mm[1].padStart(2, "0")}`;
  }
  const head = raw.split(/[ T]/)[0];
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

/** snake_case a header cell: "Trade Type" → "trade_type", "ISIN" → "isin". */
function snake(s: string): string {
  return s.trim().toLowerCase().replace(/[\s.]+/g, "_");
}

function parseZerodha(rows: string[][]): ParsedTrade[] {
  // Zerodha ships TWO shapes: the CSV export uses lowercase_underscore headers
  // (symbol, trade_type, …); the XLSX export uses Title Case with spaces
  // (Symbol, Trade Type, …). Normalise every header cell to snake_case so both
  // map to the same keys — otherwise the XLSX yields "no trades found".
  const h = headerIndex(rows, (r) => {
    const s = r.map(snake);
    return s.includes("symbol") && s.includes("trade_type");
  });
  if (h < 0) return [];
  const hdr = rows[h].map(snake);
  const out: ParsedTrade[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const d: Record<string, string> = {};
    for (let c = 0; c < hdr.length; c++) if (hdr[c]) d[hdr[c]] = (r[c] ?? "").trim();
    if (!d.symbol) continue;
    out.push({
      broker: "zerodha" as const,
      rawSymbol: d.symbol, rawName: d.symbol, isin: (d.isin ?? "").trim(),
      side: normalizeSide(d.trade_type ?? ""),
      quantity: num(d.quantity), price: num(d.price),
      tradeDate: toIso(d.trade_date ?? ""), tradeTime: (d.order_execution_time ?? "").trim(),
      tradeId: (d.trade_id ?? "").trim(), orderId: (d.order_id ?? "").trim(),
    });
  }
  return out;
}

function parseFyers(rows: string[][]): ParsedTrade[] {
  const h = headerIndex(rows, (r) => r[0] === "Name");
  if (h < 0) return [];
  const out: ParsedTrade[] = [];
  for (const d of asObjects(rows, h)) {
    if (!d.Name) continue;
    // A Tradebook lists executed trades only. Some exports carry a Status
    // column, the current one does NOT — so filter on it ONLY when present,
    // otherwise every row (no Status) was being dropped as "not Executed".
    if ("Status" in d && (d.Status ?? "").trim() !== "Executed") continue;
    // Date column casing drifted: the current export uses "Date & time" and
    // packs the clock after a comma ("05 Aug 2026, 09:49:14 AM"); older ones
    // used "Date & Time". Split on the comma so toIso sees only "05 Aug 2026".
    const when = (d["Date & time"] ?? d["Date & Time"] ?? "").trim();
    const [datePart, ...timeParts] = when.split(",");
    // Name is either a Fyers symbol ("NSE:STEELCAS-EQ") or, in this export, a
    // full company name ("STEELCAST LIMITED"). Strip the exchange wrapper when
    // present; otherwise keep the name for name-based universe resolution.
    const m = d.Name.match(/^[A-Z]+:(.+)-[A-Z]+$/);
    const sym = m ? m[1] : "";
    out.push({
      broker: "fyers",
      rawSymbol: sym,
      rawName: m ? "" : d.Name,
      isin: "",
      side: normalizeSide(d.Side ?? ""),
      quantity: num(d.Qty),
      price: num(d["Traded price"]),
      tradeDate: toIso(datePart.trim()),
      tradeTime: timeParts.join(",").trim(),
      // Exchange/OMS order IDs are ORDER ids — shared across the partial fills
      // of one order (e.g. STEELCAST 30+15 under one id). Using them as a trade
      // id would collapse those fills on dedup and silently drop quantity. Leave
      // tradeId empty so dedup falls back to the date|qty|price|time composite,
      // which keeps distinct fills distinct.
      tradeId: "",
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
    // Exact normalized-name match wins outright — this disambiguates a family of
    // near-names where a SHORTER universe name is a prefix of the trade name
    // (e.g. "Raymond Lifestyle" would otherwise also match "Raymond" via the
    // loose prefix rule and be dropped as ambiguous). Only fall back to prefix
    // matching when there's no exact hit at all.
    const exact = new Set<string>();
    const prefix = new Set<string>();
    for (const { norm, symbol } of uni.byName) {
      if (!norm) continue;
      if (norm === nn) exact.add(symbol);
      else if (norm.startsWith(nn) || nn.startsWith(norm)) prefix.add(symbol);
    }
    if (exact.size === 1) return [...exact][0];
    if (exact.size === 0 && prefix.size === 1) return [...prefix][0];

    // Token-prefix fallback for BROKER-TRUNCATED names. Fyers abbreviates:
    // "CHOLAMANDALAM IN & FIN CO" for "Cholamandalam Investment and Finance
    // Company". String-prefix can't bridge that, but every trade token IS a
    // prefix of a distinct universe token. Require each trade token (≥2 of them)
    // to greedily match a distinct universe token by prefix, and accept only a
    // UNIQUE hit — so "…IN & FIN CO" resolves CHOLAFIN but stays ambiguous-safe
    // against CHOLAHLDNG (Financial Holdings), where "IN"/"CO" match nothing.
    const tks = nn.split(" ").filter(Boolean);
    if (tks.length >= 2) {
      const tokenHits = new Set<string>();
      for (const { norm, symbol } of uni.byName) {
        if (!norm) continue;
        const utoks = norm.split(" ").filter(Boolean);
        const used = new Array(utoks.length).fill(false);
        let allMatched = true;
        for (const tk of tks) {
          let found = -1;
          for (let i = 0; i < utoks.length; i++) {
            if (!used[i] && utoks[i].startsWith(tk)) { found = i; break; }
          }
          if (found < 0) { allMatched = false; break; }
          used[found] = true;
        }
        if (allMatched) tokenHits.add(symbol);
      }
      if (tokenHits.size === 1) return [...tokenHits][0];
    }
  }
  return null;
}

/**
 * Trade-level dedup key: trade_id when present, else the natural composite.
 *
 * MUST be scoped to the user. A broker trade_id is only unique within one
 * account, and the composite fallback (broker|date|symbol|side|qty|price|time)
 * collides trivially across users — two people buying 10 INFY at the same price
 * on the same day produce identical tuples. Without user_id in the key, the
 * second user's real trade gets swallowed by ON CONFLICT DO NOTHING.
 */
export function tradeDedupKey(
  t: ParsedTrade & { symbol: string },
  userId: number | string,
): string {
  const raw = t.tradeId
    ? `${userId}|${t.broker}|tid|${t.tradeId}`
    : `${userId}|${t.broker}|${t.tradeDate}|${t.symbol}|${t.side}|${t.quantity}|${t.price}|${t.tradeTime}`;
  return createHash("md5").update(raw).digest("hex");
}
