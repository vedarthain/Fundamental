/**
 * NIFTY 500 Scorecard — server-side Excel report.
 *
 * Reads live from Neon on demand (no local step). Every column except 1D comes
 * from the latest `app.cluster_stocks_panel_cache` snapshot so the sheet matches
 * equityroots.in exactly. The 1D % is the one genuinely-daily figure, computed
 * from golden's last two closes.
 *
 * Data ceiling to keep in mind: the cache snapshot (Q/V/M, rank, price, 1W/1M/1Y)
 * refreshes ~weekly. Only price freshness beyond that lives in golden (1D).
 */
import "server-only";
import ExcelJS from "exceljs";
import { sql, golden } from "@/lib/db";

const TIER_MAP: Record<string, string> = {
  veteran: "Long established",
  mature: "Established",
  mid: "Emerging",
  new: "Emerging",
};

const NAVY = "FF1E2761";
const GREEN = "FF15803D";
const RED = "FFDC2626";
const RET_FMT = "+0.0;-0.0";
// Numeric cell, but displays 8.5M / 234K / 900 (stays sortable/filterable).
const VOL_FMT = '[>=1000000]#,##0.0,,"M";[>=1000]#,##0,"K";#,##0';

type Row = {
  peer_rank: number | null;
  peer_count: number | null;
  symbol: string;
  company: string;
  sector: string;
  industry: string;
  category: string;
  q: number | null;
  v: number | null;
  m: number | null;
  comp: number | null;
  mcap: number | null;
  price: number | null;
  vol: number | null; // latest daily volume (shares)
  d1: number | null; // 1D %, already ×100
  r1w: number | null; // ×100
  r1m: number | null;
  r1y: number | null;
};

function num(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
/** cache returns are stored as fractions (0.339 = +33.9%) → ×100, 1 dp */
function pctx(x: unknown): number | null {
  const n = num(x);
  return n == null ? null : Math.round(n * 1000) / 10;
}

async function loadRows(): Promise<{ rows: Row[]; snapshot: string | null }> {
  const raw = await sql<
    {
      symbol: string;
      company_name: string | null;
      sector: string | null;
      industry: string | null;
      maturity_tier: string | null;
      peer_rank: number | null;
      peer_count: number | null;
      quality_pct: number | null;
      valuation_pct: number | null;
      momentum_pct: number | null;
      composite_pct: number | null;
      market_cap: number | null;
      current_price: number | null;
      ret_1w: number | null;
      ret_1m: number | null;
      ret_1y: number | null;
      snapshot_date: string | null;
    }[]
  >`
    WITH ranked AS (
      SELECT p.symbol, p.cluster_id, p.maturity_tier, p.market_cap_cr, p.current_price,
             p.quality_pct, p.valuation_pct, p.momentum_pct, p.composite_pct,
             p.ret_1w, p.ret_1m, p.ret_1y, p.snapshot_date,
             RANK() OVER (PARTITION BY p.cluster_id, p.maturity_tier
                          ORDER BY p.composite_pct DESC NULLS LAST) AS peer_rank,
             COUNT(*) OVER (PARTITION BY p.cluster_id, p.maturity_tier) AS peer_count
      FROM app.cluster_stocks_panel_cache p
      WHERE p.snapshot_date = (SELECT max(snapshot_date) FROM app.cluster_stocks_panel_cache)
    )
    SELECT ic.symbol, u.company_name,
           mc.name AS sector, c.name AS industry,
           r.maturity_tier, r.peer_rank, r.peer_count,
           r.quality_pct, r.valuation_pct, r.momentum_pct, r.composite_pct,
           r.market_cap_cr AS market_cap, r.current_price,
           r.ret_1w, r.ret_1m, r.ret_1y, r.snapshot_date::text AS snapshot_date
    FROM app.index_constituent ic
    JOIN app.universe u ON u.symbol = ic.symbol
    LEFT JOIN ranked r ON r.symbol = ic.symbol
    LEFT JOIN app.cluster c ON c.id = r.cluster_id
    LEFT JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
    WHERE ic.index_code = 'NIFTY500'
  `;

  // 1D % from golden: latest close / prior close − 1, per symbol.
  const gsyms = raw.map((r) => r.symbol + ".NS");
  const gp = await golden<
    { symbol: string; close: string; volume: string | null; rn: string }[]
  >`
    SELECT symbol, close::text AS close, volume::text AS volume, rn FROM (
      SELECT symbol, close, volume,
             row_number() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
      FROM golden.price_history_1d
      WHERE symbol = ANY(${gsyms}) AND close IS NOT NULL
    ) t WHERE rn <= 2
  `;
  const last = new Map<string, number>();
  const prev = new Map<string, number>();
  const vol = new Map<string, number>();
  for (const g of gp) {
    const bare = g.symbol.endsWith(".NS") ? g.symbol.slice(0, -3) : g.symbol;
    // rn is bigint → postgres.js returns it as a string; coerce before compare.
    if (Number(g.rn) === 1) {
      last.set(bare, Number(g.close));
      if (g.volume != null) vol.set(bare, Number(g.volume));
    } else {
      prev.set(bare, Number(g.close));
    }
  }

  const snapshot = raw.find((r) => r.snapshot_date)?.snapshot_date ?? null;
  const rows: Row[] = raw.map((r) => {
    const l = last.get(r.symbol);
    const p = prev.get(r.symbol);
    const d1 =
      l != null && p != null && p !== 0 ? Math.round((l / p - 1) * 1000) / 10 : null;
    const pr = num(r.peer_rank);
    const pc = num(r.peer_count);
    return {
      peer_rank: pr == null ? null : Math.round(pr),
      peer_count: pc == null ? null : Math.round(pc),
      symbol: r.symbol,
      company: r.company_name ?? r.symbol,
      sector: r.sector || "(unclassified)",
      industry: r.industry || "(unclassified)",
      category: TIER_MAP[r.maturity_tier ?? ""] ?? (r.maturity_tier || "(none)"),
      q: num(r.quality_pct),
      v: num(r.valuation_pct),
      m: num(r.momentum_pct),
      comp: num(r.composite_pct),
      mcap: num(r.market_cap),
      price: num(r.current_price),
      vol: vol.get(r.symbol) ?? null,
      d1,
      r1w: pctx(r.ret_1w),
      r1m: pctx(r.ret_1m),
      r1y: pctx(r.ret_1y),
    };
  });
  return { rows, snapshot };
}

/** Build the two-sheet workbook and return it as a Buffer. */
export async function buildNifty500Workbook(): Promise<{
  buffer: ArrayBuffer;
  rowCount: number;
  snapshot: string | null;
}> {
  const { rows, snapshot } = await loadRows();
  const wb = new ExcelJS.Workbook();
  wb.creator = "EquityRoots";
  wb.created = new Date();

  const hdrFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  const hdrFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  const retColor = (v: number | null) =>
    v == null ? undefined : ({ argb: v >= 0 ? GREEN : RED } as ExcelJS.Color);

  // ---------------- Sheet 1: flat data ----------------
  const ws = wb.addWorksheet("NIFTY 500", { views: [{ state: "frozen", ySplit: 2 }] });
  const H1 = [
    "Industry Rank", "Peer Group", "Symbol", "Company", "Q", "V", "M", "Composite",
    "Mkt Cap (Cr)", "Price (Rs)", "Vol", "1D %", "1W %", "1M %", "1Y %", "Sector", "Industry", "Category",
  ];
  const title = `NIFTY 500 — Scorecard | snapshot ${snapshot ?? "?"} | matches equityroots.in | 1D from live golden close`;
  ws.mergeCells(1, 1, 1, H1.length);
  const tcell = ws.getCell(1, 1);
  tcell.value = title;
  tcell.font = { bold: true, size: 11, color: { argb: NAVY } };
  ws.getRow(1).height = 22;

  const hrow = ws.getRow(2);
  H1.forEach((h, i) => {
    const c = hrow.getCell(i + 1);
    c.value = h;
    c.fill = hdrFill;
    c.font = hdrFont;
    c.alignment = { horizontal: i === 3 ? "left" : "center", vertical: "middle" };
  });

  const flat = [...rows].sort(
    (a, b) =>
      a.industry.localeCompare(b.industry) ||
      (a.peer_rank ?? 9999) - (b.peer_rank ?? 9999) ||
      a.symbol.localeCompare(b.symbol),
  );
  for (const r of flat) {
    const row = ws.addRow([
      r.peer_rank, r.peer_count, r.symbol, r.company, r.q, r.v, r.m, r.comp,
      r.mcap, r.price, r.vol, r.d1, r.r1w, r.r1m, r.r1y, r.sector, r.industry, r.category,
    ]);
    row.eachCell((c) => (c.border = { bottom: { style: "thin", color: { argb: "FFD9DCE3" } } }));
    ["A", "B", "E", "F", "G", "H"].forEach((col) => (row.getCell(col).alignment = { horizontal: "center" }));
    row.getCell("C").font = { bold: true };
    row.getCell("I").numFmt = "#,##0";
    row.getCell("I").alignment = { horizontal: "right" };
    row.getCell("J").numFmt = "#,##0.00";
    row.getCell("J").alignment = { horizontal: "right" };
    row.getCell("K").numFmt = VOL_FMT; // Vol
    row.getCell("K").alignment = { horizontal: "right" };
    // 1D..1Y are columns L,M,N,O
    (["L", "M", "N", "O"] as const).forEach((col) => {
      const cell = row.getCell(col);
      cell.numFmt = RET_FMT;
      cell.alignment = { horizontal: "right" };
      const v = cell.value as number | null;
      const color = retColor(v);
      if (color) cell.font = { color };
    });
  }
  ([13, 11, 13, 34, 5, 5, 5, 10, 12, 11, 10, 8, 8, 8, 8, 22, 26, 16] as const).forEach(
    (w, i) => (ws.getColumn(i + 1).width = w),
  );
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + flat.length, column: H1.length } };

  // ---------------- Sheet 2: pivot (company rows only) ----------------
  const ws2 = wb.addWorksheet("Pivot", { views: [{ state: "frozen", ySplit: 2 }] });
  ws2.properties.outlineLevelRow = 3;
  ws2.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  const PH = [
    "Sector", "Industry", "Category", "Company",
    "Industry Rank", "Price (Rs)", "Vol", "1D %", "1W %", "1M %", "1Y %", "Q", "V", "M",
  ];
  ws2.mergeCells(1, 1, 1, PH.length);
  const t2 = ws2.getCell(1, 1);
  t2.value = `NIFTY 500 — Pivot | Sector › Industry › Category › Company (company detail only)`;
  t2.font = { bold: true, size: 11, color: { argb: NAVY } };
  ws2.getRow(1).height = 20;
  const h2 = ws2.getRow(2);
  PH.forEach((h, i) => {
    const c = h2.getCell(i + 1);
    c.value = h;
    c.fill = hdrFill;
    c.font = hdrFont;
    c.alignment = { horizontal: i <= 3 ? "left" : "center", vertical: "middle" };
  });

  const writeMetrics = (row: ExcelJS.Row, r: Row) => {
    row.getCell(5).value = r.peer_rank;
    row.getCell(5).alignment = { horizontal: "center" };
    row.getCell(6).value = r.price;
    row.getCell(6).numFmt = "#,##0.00";
    row.getCell(6).alignment = { horizontal: "right" };
    row.getCell(7).value = r.vol;
    row.getCell(7).numFmt = VOL_FMT;
    row.getCell(7).alignment = { horizontal: "right" };
    (["d1", "r1w", "r1m", "r1y"] as const).forEach((k, idx) => {
      const cell = row.getCell(8 + idx);
      cell.value = r[k];
      cell.numFmt = RET_FMT;
      cell.alignment = { horizontal: "right" };
      const color = retColor(r[k]);
      if (color) cell.font = { color };
    });
    (["q", "v", "m"] as const).forEach((k, idx) => {
      const cell = row.getCell(12 + idx);
      cell.value = r[k];
      cell.alignment = { horizontal: "center" };
    });
  };

  const sectors = [...new Set(rows.map((r) => r.sector))].sort((a, b) => a.localeCompare(b));
  for (const sec of sectors) {
    const srows = rows.filter((r) => r.sector === sec);
    const sr = ws2.addRow([sec]);
    sr.getCell(1).font = { bold: true, size: 11 };
    sr.outlineLevel = 0;
    for (const ind of [...new Set(srows.map((r) => r.industry))].sort((a, b) => a.localeCompare(b))) {
      const irows = srows.filter((r) => r.industry === ind);
      const ir = ws2.addRow([null, ind]);
      ir.getCell(2).font = { bold: true };
      ir.outlineLevel = 1;
      for (const cat of [...new Set(irows.map((r) => r.category))].sort((a, b) => a.localeCompare(b))) {
        const crows = irows
          .filter((r) => r.category === cat)
          .sort((a, b) => (a.peer_rank ?? 9999) - (b.peer_rank ?? 9999) || a.symbol.localeCompare(b.symbol));
        const cr = ws2.addRow([null, null, cat]);
        cr.getCell(3).font = { bold: true, italic: true };
        cr.outlineLevel = 2;
        for (const r of crows) {
          const dr = ws2.addRow([null, null, null, r.company]);
          dr.outlineLevel = 3;
          writeMetrics(dr, r);
        }
      }
    }
  }
  ([16, 26, 16, 34, 12, 11, 10, 8, 8, 8, 8, 5, 5, 5] as const).forEach(
    (w, i) => (ws2.getColumn(i + 1).width = w),
  );

  const arrayBuf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return { buffer: arrayBuf, rowCount: rows.length, snapshot };
}
