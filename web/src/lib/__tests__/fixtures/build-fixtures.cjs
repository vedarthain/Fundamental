/**
 * Regenerates the broker-export fixture files used by the parser tests.
 *
 *   node src/lib/__tests__/fixtures/build-fixtures.cjs
 *
 * These are SYNTHETIC files that reproduce each broker's real export SHAPE
 * (preamble rows, header casing, date formats, name-vs-ticker columns) with
 * fake account IDs and a handful of well-known tickers. We deliberately do NOT
 * commit real brokerage statements — they carry personal holdings + client IDs.
 *
 * When a broker changes its export format, drop a fresh (sanitised) sample's
 * structure in here, regenerate, and update the matching assertions.
 */
const XLSX = require("xlsx");
const path = require("path");

const DIR = __dirname;
const write = (aoa, file, sheetName = "Sheet1") => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  XLSX.writeFile(wb, path.join(DIR, file));
  console.log("wrote", file);
};

// ── Zerodha tradebook — XLSX export (Title Case headers, spaces) ─────────────
// The variant that regressed: header detection expected CSV's lowercase keys.
write(
  [
    ["Zerodha Broking Ltd."],
    ["Client ID", "AB1234"],
    [],
    ["Tradebook for Equity from 2026-04-01 to 2026-08-23"],
    [],
    [
      "Symbol", "ISIN", "Trade Date", "Exchange", "Segment", "Series",
      "Trade Type", "Auction", "Quantity", "Price", "Trade ID", "Order ID",
      "Order Execution Time",
    ],
    ["INFY", "INE009A01021", "2026-06-19", "NSE", "EQ", "EQ", "buy", "FALSE", "10", "1500.5", "111", "9001", "2026-06-19T09:22:30"],
    ["INFY", "INE009A01021", "2026-08-04", "NSE", "EQ", "EQ", "sell", "FALSE", "4", "1620", "112", "9002", "2026-08-04T11:40:29"],
    ["TCS", "INE467B01029", "2026-08-19", "BSE", "EQ", "A", "sell", "FALSE", "3", "3900.25", "113", "9003", "2026-08-19T11:15:53"],
  ],
  "zerodha-tradebook.xlsx",
  "Equity",
);

// ── Zerodha tradebook — CSV export (lowercase_underscore headers) ────────────
// Proves the parser still accepts the original CSV shape after the fix.
const csv = [
  "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time",
  "INFY,INE009A01021,2026-06-19,NSE,EQ,EQ,buy,FALSE,10,1500.5,111,9001,2026-06-19T09:22:30",
  "TCS,INE467B01029,2026-08-19,BSE,EQ,A,sell,FALSE,3,3900.25,113,9003,2026-08-19T11:15:53",
  "",
].join("\n");
require("fs").writeFileSync(path.join(DIR, "zerodha-tradebook.csv"), csv);
console.log("wrote zerodha-tradebook.csv");

// ── Zerodha holdings — "Holdings Statement" XLSX (Symbol/Quantity split) ─────
// The variant that regressed: parser only knew the Console CSV `Instrument`
// shape. The statement carries a long preamble, then a header where quantity is
// split across Available + Long Term (subset) + Pledged (Margin)/(Loan) buckets.
write(
  [
    ["Zerodha Broking Ltd."],
    ["Holdings Statement"],
    ["Client ID", "AB1234"],
    ...Array(18).fill([]),
    [
      "Symbol", "ISIN", "Sector", "Quantity Available", "Quantity Discrepant",
      "Quantity Long Term", "Quantity Pledged (Margin)", "Quantity Pledged (Loan)",
      "Average Price", "Previous Closing Price", "Unrealized P&L", "Unrealized P&L Pct.",
    ],
    ["360ONE", "INE466L01038", "FINANCIAL SERVICES", "8", "0", "8", "0", "0", "1029.825", "1199", "1353.4", "16.4275"],
    ["INFY", "INE009A01021", "IT", "10", "0", "0", "0", "0", "1500.5", "1620", "1195", "7.96"],
    // Pledged-only position: 0 available, 4 pledged (margin) — must still count.
    ["TCS", "INE467B01029", "IT", "0", "0", "0", "4", "0", "3800", "3900.25", "401", "2.63"],
  ],
  "zerodha-holdings.xlsx",
  "Equity",
);

// ── 5paisa tradebook — "Equity Transaction Report" (.xls, "Aug 19 2026") ─────
// The date format ("Mon DD YYYY") + name-only Company column that regressed.
write(
  [
    [""],
    ["Tel:+91-89766 89766. E-mail : support@5paisa.com , Website : www.5paisa.com"],
    [],
    ["Client ID : AB1234"],
    [],
    ["Report Name : Equity Transaction Report From 01-04-2026 to 23-08-2026"],
    [],
    ["Transaction Date", "Company Name", "Exchange", "Type", "Quantity", "Price", "Tax/Charges", "Brokerage", "Remarks"],
    ["Aug 19 2026", "Redington", "BSE", "Sell", "65", "324.25", "25.64", "20", "Sell Trade"],
    ["Aug 11 2026", "Raymond Lifestyle", "NSE", "Sell", "1", "729.6", "4.04", "18.24", "Sell Trade"],
    ["Jul 02 2026", "CPSE ETF", "BSE", "Sell", "1", "97.03", "0.44", "2.43", "Sell Trade"],
  ],
  "fivepaisa-trade-report.xls",
);

// ── 5paisa holdings — "Equity Portfolio" (.xls, two-row header) ──────────────
write(
  [
    [""],
    ["Tel:+91-89766 89766. E-mail : support@5paisa.com , Website : www.5paisa.com"],
    [],
    ["Report Name : Equity Portfolio"],
    ["Client Code : AB1234"],
    [],
    ["Company", "Quantity", "Avg.Price", "Total Investment", "Current Market Value", "Current Market Value", "Unrealized Gain/Loss", "Unrealized Gain/Loss", "Day's Gain/Loss", "Day's Gain/Loss"],
    ["Company", "Quantity", "Avg.Price", "Total Investment", "Price", "Value", "Value", "%", "Value", "%"],
    ["CYIENT", "8", "1684.05", "13472.4", "892.65", "7141.2", "-6331.2", "-46.99", "-83.2", "-1.15"],
    ["JKCEMENT", "3", "4879.98", "14639.94", "5250", "15750", "1110.06", "7.58", "-48", "-0.3"],
    ["WIPRO", "50", "301.5", "15075", "180.79", "9039.5", "-6035.5", "-40.04", "-10.5", "-0.12"],
  ],
  "fivepaisa-equity-portfolio.xls",
);

// ── 5paisa holdings — "Holding Statement" (.xls, must be REJECTED) ───────────
write(
  [
    [""],
    ["Tel:+91-89766 89766. E-mail : support@5paisa.com , Website : www.5paisa.com"],
    [],
    ["Report Name : Holding Statement As On 2026-03-31"],
    ["Client Code : AB1234"],
    [],
    ["Company", "Quantity", "Market Price As On 2025-04-01", "Market Value As On 2025-04-01"],
    ["Cyient Ltd.", "8", "752.85", "6022.8"],
    ["JK Cement Ltd.", "3", "5080", "15240"],
  ],
  "fivepaisa-holding-statement.xls",
);
