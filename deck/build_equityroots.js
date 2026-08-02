// EquityRoots — final-state platform deck. Run: NODE_PATH=/opt/homebrew/lib/node_modules node build_equityroots.js
const P = require("pptxgenjs");
const pptx = new P();
pptx.defineLayout({ name: "W", width: 13.333, height: 7.5 });
pptx.layout = "W";

// ── Palette (Ocean / fintech, data-informed) ──
const NAVY = "0B1F33";      // dark bg
const NAVY2 = "12324D";     // dark card
const TEAL = "0E8390";      // primary accent
const BLUE = "12507A";      // deep blue
const AMBER = "F2A73B";     // signal accent
const INK = "13232F";       // dark text on light
const MUTE = "5C6B78";      // muted
const MUTE_L = "AFC2D1";    // muted on dark
const PANEL = "F2F6F9";     // light panel
const LINE = "DCE5EC";      // hairline
const WHITE = "FFFFFF";
const UP = "1B9E64";

const HF = "Georgia";       // header font
const BF = "Calibri";       // body font

const W = 13.333, H = 7.5, M = 0.7;

// helpers
const slide = (bg) => { const s = pptx.addSlide(); s.background = { color: bg }; return s; };
const eyebrow = (s, t, x, y, col) => s.addText(t.toUpperCase(), {
  x, y, w: 8, h: 0.3, fontFace: BF, fontSize: 12, bold: true, color: col, charSpacing: 3, align: "left",
});
const title = (s, t, x, y, col, sz = 34) => s.addText(t, {
  x, y, w: 11.9, h: 0.9, fontFace: HF, fontSize: sz, bold: true, color: col, align: "left",
});

// card with thick left accent border
function card(s, x, y, w, h, opts = {}) {
  const fill = opts.fill || WHITE;
  const accent = opts.accent || TEAL;
  s.addShape("roundRect", { x, y, w, h, rectRadius: 0.06, fill: { color: fill }, line: { color: opts.line || LINE, width: 1 } });
  s.addShape("rect", { x, y: y + 0.02, w: 0.055, h: h - 0.04, fill: { color: accent }, line: { type: "none" } });
}

// ══════════════════ SLIDE 1 — TITLE ══════════════════
{
  const s = slide(NAVY);
  // faint motif: teal vertical rule
  s.addShape("rect", { x: 0, y: 0, w: 0.18, h: H, fill: { color: TEAL }, line: { type: "none" } });
  eyebrow(s, "NSE Equity Intelligence Platform", M, 1.35, TEAL);
  s.addText("EquityRoots", { x: M - 0.03, y: 1.75, w: 11, h: 1.4, fontFace: HF, fontSize: 68, bold: true, color: WHITE, align: "left" });
  s.addText("Peer-relative scoring and daily signal scanners for the Indian equity market — insight-first, split-safe, and rebuilt weekly.",
    { x: M, y: 3.25, w: 9.6, h: 0.9, fontFace: BF, fontSize: 18, color: MUTE_L, align: "left", lineSpacingMultiple: 1.15 });

  // stat strip
  const stats = [["2,132", "scored stocks"], ["46", "peer clusters"], ["8", "daily scanners"], ["~1 yr", "signal history"]];
  const sw = 2.65, gap = 0.35, sx = M, sy = 5.0;
  stats.forEach(([n, l], i) => {
    const x = sx + i * (sw + gap);
    s.addText(n, { x, y: sy, w: sw, h: 0.75, fontFace: HF, fontSize: 40, bold: true, color: AMBER, align: "left" });
    s.addText(l.toUpperCase(), { x, y: sy + 0.78, w: sw, h: 0.3, fontFace: BF, fontSize: 11, bold: true, color: MUTE_L, charSpacing: 2, align: "left" });
  });
  s.addText("Final-state platform review  ·  August 2026", { x: M, y: 6.75, w: 8, h: 0.3, fontFace: BF, fontSize: 12, color: MUTE, align: "left" });
}

// ══════════════════ SLIDE 2 — WHAT SHIPPED ══════════════════
{
  const s = slide(WHITE);
  eyebrow(s, "The product surface", M, 0.6, TEAL);
  title(s, "What shipped", M, 0.95, INK);
  s.addText("Eight product areas — from single-stock research to whole-universe rotation.", { x: M, y: 1.72, w: 11, h: 0.4, fontFace: BF, fontSize: 14, italic: true, color: MUTE });

  const items = [
    ["Scanner", "Eight daily signal tabs under one tabbed roof", TEAL],
    ["Stock detail", "Quality / Valuation / Momentum pillars + narrative", BLUE],
    ["Screener", "Filterable universe — P/E, ROE, composite score", TEAL],
    ["Market dashboard", "Indices, FII/DII flows, price levels", BLUE],
    ["Sectors & Indices", "Heatmaps + Nifty 50/100/200/500 constituents", TEAL],
    ["Watchlist & Portfolio", "Holdings tracker, equity curve vs NIFTY 500", BLUE],
    ["Ideas feed", "Conviction-gated weekly picks (4+ weeks)", TEAL],
    ["History / Today", "Historical market snapshots by date", BLUE],
  ];
  const cols = 4, cw = 2.87, ch = 1.75, gx = 0.24, gy = 0.3;
  const x0 = M, y0 = 2.35;
  items.forEach((it, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = x0 + c * (cw + gx), y = y0 + r * (ch + gy);
    card(s, x, y, cw, ch, { accent: it[2] });
    s.addText(it[0], { x: x + 0.2, y: y + 0.22, w: cw - 0.35, h: 0.6, fontFace: HF, fontSize: 16, bold: true, color: INK });
    s.addText(it[1], { x: x + 0.2, y: y + 0.85, w: cw - 0.35, h: 0.75, fontFace: BF, fontSize: 11.5, color: MUTE, lineSpacingMultiple: 1.05 });
  });
}

// ══════════════════ SLIDE 3 — THE SCANNER ══════════════════
{
  const s = slide(WHITE);
  eyebrow(s, "Flagship tool", M, 0.6, TEAL);
  title(s, "The Scanner — eight signals, one clock face", M, 0.95, INK);
  s.addText("Each tab answers “where’s the move?” on a different horizon, every name carrying its fundamental score.", { x: M, y: 1.72, w: 12, h: 0.4, fontFace: BF, fontSize: 14, italic: true, color: MUTE });

  const tabs = [
    ["01", "Igniting today", "One-day volume explosion"],
    ["02", "Trend Leaders", "Fresh golden cross, slow burn"],
    ["03", "At Support", "Multi-year tested floors"],
    ["04", "Fallen Leaders", "Beaten-down quality reversing"],
    ["05", "Peer groups", "Cluster rotation heatmap"],
    ["06", "Sectors", "Top-down sector rotation"],
    ["07", "Graph", "Split-safe candlesticks, 4-up"],
    ["08", "All stocks", "Full ranked universe, sortable"],
  ];
  const cols = 4, cw = 2.87, ch = 1.85, gx = 0.24, gy = 0.32, x0 = M, y0 = 2.35;
  tabs.forEach((t, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = x0 + c * (cw + gx), y = y0 + r * (ch + gy);
    card(s, x, y, cw, ch, { accent: i % 2 ? BLUE : TEAL });
    // number badge circle
    s.addShape("ellipse", { x: x + 0.2, y: y + 0.22, w: 0.5, h: 0.5, fill: { color: i % 2 ? BLUE : TEAL }, line: { type: "none" } });
    s.addText(t[0], { x: x + 0.2, y: y + 0.28, w: 0.5, h: 0.36, fontFace: BF, fontSize: 13, bold: true, color: WHITE, align: "center" });
    s.addText(t[1], { x: x + 0.2, y: y + 0.85, w: cw - 0.35, h: 0.45, fontFace: HF, fontSize: 15.5, bold: true, color: INK });
    s.addText(t[2], { x: x + 0.2, y: y + 1.3, w: cw - 0.35, h: 0.5, fontFace: BF, fontSize: 11.5, color: MUTE, lineSpacingMultiple: 1.05 });
  });
}

// ══════════════════ SLIDE 4 — ARCHITECTURE ══════════════════
{
  const s = slide(PANEL);
  eyebrow(s, "How it fits together", M, 0.6, TEAL);
  title(s, "Architecture — three layers, two databases", M, 0.95, INK);

  const laneY = 2.15, laneH = 2.5, laneW = 3.75, gap = 0.55;
  const lanes = [
    ["WEB", "Next.js 16 · App Router", ["React Server Components", "ISR cache 6–10h", "Tailwind 4 + Radix UI", "Recharts + SVG sparklines"], TEAL],
    ["DATA", "Two Postgres DBs (Neon)", ["app — scores, users, watchlist,", "portfolio, universe", "golden — read-only OHLCV,", "split-adjusted, multi-year"], BLUE],
    ["ETL", "Python · Typer CLI", ["fetch → Screener.in XLSX", "compute-metrics", "score (percentile + composite)", "cluster assignment"], AMBER],
  ];
  lanes.forEach((L, i) => {
    const x = M + i * (laneW + gap);
    card(s, x, laneY, laneW, laneH, { accent: L[3], fill: WHITE });
    s.addShape("rect", { x: x, y: laneY, w: laneW, h: 0.62, fill: { color: L[3] }, line: { type: "none" } });
    s.addText(L[0], { x: x + 0.25, y: laneY + 0.08, w: laneW - 0.4, h: 0.45, fontFace: HF, fontSize: 18, bold: true, color: WHITE });
    s.addText(L[1], { x: x + 0.25, y: laneY + 0.75, w: laneW - 0.45, h: 0.4, fontFace: HF, fontSize: 13.5, bold: true, color: INK });
    L[2].forEach((r, j) => s.addText("•  " + r, { x: x + 0.25, y: laneY + 1.2 + j * 0.31, w: laneW - 0.45, h: 0.3, fontFace: BF, fontSize: 11.5, color: MUTE }));
    if (i < 2) s.addText("→", { x: x + laneW + 0.04, y: laneY + 0.95, w: gap - 0.06, h: 0.5, fontFace: BF, fontSize: 26, bold: true, color: MUTE, align: "center" });
  });

  // data sources strip
  const srcY = laneY + laneH + 0.45;
  s.addText("DATA SOURCES", { x: M, y: srcY, w: 3, h: 0.3, fontFace: BF, fontSize: 11, bold: true, color: MUTE, charSpacing: 2 });
  const srcs = ["Screener.in — quarterly financials", "NSE bhavcopy — daily OHLCV", "NSE API — IPO / micro-cap gap-fill", "Index rebalance CSVs"];
  srcs.forEach((t, i) => {
    const x = M + i * 3.02;
    s.addShape("roundRect", { x, y: srcY + 0.32, w: 2.85, h: 0.55, rectRadius: 0.08, fill: { color: WHITE }, line: { color: LINE, width: 1 } });
    s.addText(t, { x: x + 0.15, y: srcY + 0.32, w: 2.6, h: 0.55, fontFace: BF, fontSize: 11, color: INK, valign: "middle" });
  });
}

// ══════════════════ SLIDE 5 — SCORING ENGINE ══════════════════
{
  const s = slide(WHITE);
  eyebrow(s, "The differentiator", M, 0.6, TEAL);
  title(s, "Scoring engine — peer-relative, not absolute", M, 0.95, INK);
  s.addText("Cement is judged against cement, a bank against banks. Percentiles are computed inside each (cluster, maturity-tier) bucket.", { x: M, y: 1.72, w: 12, h: 0.4, fontFace: BF, fontSize: 14, italic: true, color: MUTE });

  // Left: three pillars
  const px = M, pw = 5.7, py = 2.4;
  s.addText("THREE-PILLAR COMPOSITE", { x: px, y: py, w: pw, h: 0.3, fontFace: BF, fontSize: 11, bold: true, color: MUTE, charSpacing: 2 });
  const pillars = [
    ["Quality", "ROE 3y/5y, profit CAGR, margins, ROCE, FCF", TEAL],
    ["Valuation", "P/E TTM, P/B, EV/EBITDA, EV/Sales · windfall-guarded", BLUE],
    ["Momentum", "12m relative return, trend strength, breadth", AMBER],
  ];
  pillars.forEach((p, i) => {
    const y = py + 0.4 + i * 1.0;
    card(s, px, y, pw, 0.85, { accent: p[2] });
    s.addText(p[0], { x: px + 0.2, y: y + 0.12, w: 2.0, h: 0.6, fontFace: HF, fontSize: 16, bold: true, color: INK, valign: "middle" });
    s.addText("33%", { x: px + pw - 1.15, y: y + 0.12, w: 0.95, h: 0.6, fontFace: HF, fontSize: 16, bold: true, color: p[2], align: "right", valign: "middle" });
    s.addText(p[1], { x: px + 1.65, y: y + 0.12, w: pw - 2.9, h: 0.6, fontFace: BF, fontSize: 10.5, color: MUTE, valign: "middle", lineSpacingMultiple: 0.95 });
  });

  // Right: hierarchy + pipeline
  const rx = M + pw + 0.6, rw = 5.55, ry = 2.4;
  s.addText("UNIVERSE HIERARCHY", { x: rx, y: ry, w: rw, h: 0.3, fontFace: BF, fontSize: 11, bold: true, color: MUTE, charSpacing: 2 });
  const hier = [["9", "meta-clusters"], ["46", "peer clusters"], ["2,132", "scored stocks"]];
  hier.forEach(([n, l], i) => {
    const y = ry + 0.4 + i * 0.62;
    s.addText(n, { x: rx, y, w: 1.4, h: 0.55, fontFace: HF, fontSize: 24, bold: true, color: BLUE, align: "right" });
    s.addText(l, { x: rx + 1.55, y, w: rw - 1.6, h: 0.55, fontFace: BF, fontSize: 14, color: INK, valign: "middle" });
    if (i < 2) s.addText("↘", { x: rx + 0.55, y: y + 0.5, w: 0.4, h: 0.25, fontFace: BF, fontSize: 12, color: MUTE });
  });
  // pipeline chip row
  const flowY = ry + 2.5;
  s.addText("SCORING PIPELINE", { x: rx, y: flowY, w: rw, h: 0.3, fontFace: BF, fontSize: 11, bold: true, color: MUTE, charSpacing: 2 });
  const steps = ["Percentile in bucket", "Shrink thin buckets → 50", "Loss-maker splice", "composite_pct 0–100"];
  steps.forEach((t, i) => {
    const y = flowY + 0.38 + i * 0.5;
    s.addShape("roundRect", { x: rx, y, w: rw, h: 0.42, rectRadius: 0.06, fill: { color: PANEL }, line: { type: "none" } });
    s.addText(t, { x: rx + 0.2, y, w: rw - 0.3, h: 0.42, fontFace: BF, fontSize: 12, color: INK, valign: "middle" });
  });
}

// ══════════════════ SLIDE 6 — PIPELINE / CRON ══════════════════
{
  const s = slide(NAVY);
  eyebrow(s, "Always fresh", M, 0.6, TEAL);
  title(s, "The pipeline runs itself", M, 0.95, WHITE);
  s.addText("A dozen GitHub Actions workflows chain fetch → compute → refresh → alert, staggered around the NSE close.", { x: M, y: 1.72, w: 12, h: 0.4, fontFace: BF, fontSize: 14, italic: true, color: MUTE_L });

  const rows = [
    ["Daily 18:30 IST", "Refresh LTP", "NSE bhavcopy → prices, market cap, panel cache, golden OHLC", TEAL],
    ["Weekdays 20:30 IST", "Scanner signals", "Fire momentum, trend-leaders, support-floor cron routes", AMBER],
    ["Sat 18:30 IST", "Weekly fetch", "Scrape Screener.in → raw XLSX blobs to Neon", BLUE],
    ["Sun", "Weekly compute", "compute-metrics + score + rebuild market cache + purge CDN", TEAL],
    ["Every 12h", "Freshness check", "Alert if scores >8d or prices >4d stale", AMBER],
    ["Monthly", "Universe sync", "Onboard new NSE listings into the scored universe", BLUE],
  ];
  const y0 = 2.4, rh = 0.72;
  rows.forEach((r, i) => {
    const y = y0 + i * rh;
    s.addShape("rect", { x: M, y: y + rh - 0.03, w: W - 2 * M, h: 0.012, fill: { color: NAVY2 }, line: { type: "none" } });
    s.addShape("ellipse", { x: M, y: y + 0.16, w: 0.24, h: 0.24, fill: { color: r[3] }, line: { type: "none" } });
    s.addText(r[0], { x: M + 0.45, y: y + 0.05, w: 2.6, h: 0.5, fontFace: BF, fontSize: 12.5, bold: true, color: MUTE_L, valign: "middle" });
    s.addText(r[1], { x: M + 3.15, y: y + 0.05, w: 2.9, h: 0.5, fontFace: HF, fontSize: 15, bold: true, color: WHITE, valign: "middle" });
    s.addText(r[2], { x: M + 6.05, y: y + 0.05, w: W - 2 * M - 6.05, h: 0.5, fontFace: BF, fontSize: 12.5, color: MUTE_L, valign: "middle" });
  });
}

// ══════════════════ SLIDE 7 — MOATS ══════════════════
{
  const s = slide(WHITE);
  eyebrow(s, "Why it's defensible", M, 0.6, TEAL);
  title(s, "The moats", M, 0.95, INK);
  s.addText("Not the raw data — the peer framing, the split-safety, and the accumulating snapshot archive.", { x: M, y: 1.72, w: 12, h: 0.4, fontFace: BF, fontSize: 14, italic: true, color: MUTE });

  const moats = [
    ["Peer-relative scoring", "46 fine-grained buckets + shrinkage — compares like-for-like, not one blunt market rank", TEAL],
    ["Split-safe candles", "OHLC scaled by adj_close/close — no phantom split cliffs, consistent platform-wide", BLUE],
    ["Daily snapshot archive", "~1 year of composite + signal history powers conviction gating and rotation reads", AMBER],
    ["Golden price DB", "Authoritative, split-adjusted, multi-year OHLCV — a single source of truth for every chart", TEAL],
    ["Windfall-guarded valuation", "P/E floored by run-rate — penalises decaying super-cycles that other screeners flatter", BLUE],
  ];
  const y0 = 2.35, rh = 0.86;
  moats.forEach((mo, i) => {
    const y = y0 + i * rh;
    s.addShape("ellipse", { x: M, y: y + 0.08, w: 0.56, h: 0.56, fill: { color: mo[2] }, line: { type: "none" } });
    s.addText(String(i + 1), { x: M, y: y + 0.14, w: 0.56, h: 0.42, fontFace: HF, fontSize: 18, bold: true, color: WHITE, align: "center" });
    s.addText(mo[0], { x: M + 0.85, y: y, w: 3.9, h: 0.72, fontFace: HF, fontSize: 17, bold: true, color: INK, valign: "middle" });
    s.addText(mo[1], { x: M + 4.9, y: y, w: W - 2 * M - 4.9, h: 0.72, fontFace: BF, fontSize: 13, color: MUTE, valign: "middle", lineSpacingMultiple: 1.0 });
  });
}

// ══════════════════ SLIDE 8 — WHAT'S NEXT ══════════════════
{
  const s = slide(PANEL);
  eyebrow(s, "The roadmap", M, 0.6, TEAL);
  title(s, "What's next", M, 0.95, INK);
  s.addText("The scoring spine is done. The open edges are execution, breadth, and automation.", { x: M, y: 1.72, w: 12, h: 0.4, fontFace: BF, fontSize: 14, italic: true, color: MUTE });

  const cols = [
    ["EXECUTION", TEAL, [["Live broker orders", "Imports are read-only today — add order/trade execution"], ["Multi-portfolio", "Advisory / group workspaces beyond one book per user"]]],
    ["BREADTH", BLUE, [["Deeper news feed", "Wire the news & announcements pages to a live source"], ["Peer-comparison views", "Direct side-by-side charts within a cluster"]]],
    ["AUTOMATION", AMBER, [["Cookie rotation", "Automate Screener session refresh — still manual"], ["Cache cascade", "Auto-revalidate on scorecard changes, no manual call"]]],
  ];
  const cw = 3.85, gap = 0.24, y0 = 2.4, x0 = M;
  cols.forEach((c, i) => {
    const x = x0 + i * (cw + gap);
    s.addShape("rect", { x, y: y0, w: cw, h: 0.06, fill: { color: c[1] }, line: { type: "none" } });
    s.addText(c[0], { x, y: y0 + 0.18, w: cw, h: 0.4, fontFace: BF, fontSize: 13, bold: true, color: c[1], charSpacing: 2 });
    c[2].forEach((it, j) => {
      const y = y0 + 0.75 + j * 1.75;
      card(s, x, y, cw, 1.55, { accent: c[1], fill: WHITE });
      s.addText(it[0], { x: x + 0.22, y: y + 0.2, w: cw - 0.4, h: 0.5, fontFace: HF, fontSize: 15.5, bold: true, color: INK });
      s.addText(it[1], { x: x + 0.22, y: y + 0.72, w: cw - 0.4, h: 0.7, fontFace: BF, fontSize: 12, color: MUTE, lineSpacingMultiple: 1.05 });
    });
  });
}

// ══════════════════ SLIDE 9 — CLOSING ══════════════════
{
  const s = slide(NAVY);
  s.addShape("rect", { x: 0, y: 0, w: 0.18, h: H, fill: { color: AMBER }, line: { type: "none" } });
  eyebrow(s, "EquityRoots", M, 1.5, TEAL);
  s.addText("Insight-first.\nPeer-relative.\nRebuilt every week.", { x: M - 0.03, y: 2.0, w: 11, h: 2.6, fontFace: HF, fontSize: 46, bold: true, color: WHITE, lineSpacingMultiple: 1.05 });
  s.addText("A full NSE research stack — scoring engine, eight scanners, and a self-refreshing data pipeline — shipped and running.",
    { x: M, y: 5.05, w: 10.5, h: 0.8, fontFace: BF, fontSize: 16, color: MUTE_L, lineSpacingMultiple: 1.15 });
  s.addText("2,132 stocks  ·  46 peer clusters  ·  8 daily scanners  ·  12 automated workflows", { x: M, y: 6.4, w: 11, h: 0.4, fontFace: BF, fontSize: 13, bold: true, color: AMBER });
}

pptx.writeFile({ fileName: "EquityRoots_FinalState.pptx" }).then((f) => console.log("WROTE", f));
