#!/usr/bin/env python3
"""
Import multi-broker equity tradebooks into app.portfolio_transaction.

- Skips ETFs / mutual-fund units (implicit: a row is kept only if it resolves
  to a symbol in app.universe, the cash-equity master which has no ETFs).
- Unifies all brokers into one portfolio (user_id=1), deduped at trade level.
- Symbol resolution: ISIN -> exact symbol -> normalized company-name prefix.

Usage:
  python scripts/import-tradebooks.py            # dry run, prints summary
  python scripts/import-tradebooks.py --commit    # writes to DB
  DB_URL=... python scripts/import-tradebooks.py --commit   # target DB
  python scripts/import-tradebooks.py --recompute-all --commit  # rebuild all
                                                  # derived holdings, no import
"""
import os, sys, re, glob, hashlib
from datetime import datetime, date
import psycopg as psycopg2
import openpyxl
import csv

DOWNLOADS = os.path.expanduser("~/Downloads")
USER_ID = 1
COMMIT = "--commit" in sys.argv
# Rebuild every transaction-derived holding from scratch, no import. Use when the
# derived rows have drifted or were never generated (e.g. trades loaded before the
# recompute was wired in). Idempotent; still needs --commit to actually write.
RECOMPUTE_ALL = "--recompute-all" in sys.argv

def get_db_url():
    if os.environ.get("DB_URL"):
        return os.environ["DB_URL"]
    # default: prod Neon from etl/.env.local
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    envf = os.path.join(root, "etl", ".env.local")
    with open(envf) as f:
        for line in f:
            if line.startswith("NEON_APP_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("no DB_URL / NEON_APP_URL")

# ---------- reference universe ----------
def load_universe(cur):
    cur.execute("select symbol, isin, company_name from app.universe where is_active")
    by_isin, by_symbol, by_name = {}, {}, []
    for sym, isin, name in cur.fetchall():
        if isin:
            by_isin[isin.strip().upper()] = sym
        by_symbol[sym.upper()] = sym
        by_name.append((normalize_name(name), sym))
    return by_isin, by_symbol, by_name

def normalize_name(n):
    if not n:
        return ""
    n = n.upper()
    for junk in [" LIMITED", " LTD", " INDUSTRIES", " INDIA", ".", ",", "-", "&"]:
        n = n.replace(junk, " ")
    return re.sub(r"\s+", " ", n).strip()

def resolve(rec, ref):
    by_isin, by_symbol, by_name = ref
    # 1. ISIN
    if rec.get("isin"):
        s = by_isin.get(rec["isin"].strip().upper())
        if s:
            return s
    # 2. exact symbol
    if rec.get("raw_symbol"):
        s = by_symbol.get(rec["raw_symbol"].strip().upper())
        if s:
            return s
    # 3. normalized name prefix (unique)
    nn = normalize_name(rec.get("raw_name", ""))
    if len(nn) >= 4:
        hits = {sym for un, sym in by_name if un.startswith(nn) or nn.startswith(un)}
        if len(hits) == 1:
            return next(iter(hits))
    return None

# ---------- parsers: yield normalized dicts ----------
#
# PARITY NOTE. These parsers are the Python twin of
# web/src/lib/tradebookImport.ts. Nothing enforces that at runtime, so the two
# drifted badly once already (the Fyers Sep-2026 header rename was fixed in TS
# while Python still raised a bare StopIteration).
#
# web/src/lib/__tests__/tradebookParity.test.ts now runs BOTH sides over the
# SAME fixtures in web/src/lib/__tests__/fixtures/ — it shells out to
# `--dump-json` below and diffs the records against parseTradebook(). Keep any
# parser change in lockstep and let that test prove it; it runs in `npm test`.


class TradebookFormatError(ValueError):
    """
    No recognisable header row for the chosen broker — the file really isn't
    that broker's tradebook (or the vendor renamed the columns on us).

    Deliberately DISTINCT from "header found, zero data rows". A broker export
    covering a window in which you simply didn't trade has a perfectly good
    header and no rows; that is a successful import of nothing, not an error.
    Collapsing the two is what made the web uploader tell the user "this
    doesn't look like a groww tradebook — check you picked the right broker"
    about a file that was exactly right.
    """


def header_index(rows, broker, pred):
    """Index of the first row matching `pred`. Raises TradebookFormatError.

    Replaces three different failure modes that used to be spread across the
    parsers: a bare next() throwing StopIteration (groww, upstox), a silent
    `return []` (5paisa), and an ad-hoc ValueError (fyers).
    """
    for i, r in enumerate(rows):
        if r and pred([("" if c is None else str(c)) for c in r]):
            return i
    raise TradebookFormatError(f"no {broker} tradebook header row found")


def snake(s):
    """'Trade Type' -> 'trade_type', 'ISIN' -> 'isin'."""
    return re.sub(r"[\s.]+", "_", str(s).strip().lower())


def num(x):
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    return float(str(x).replace(",", "").strip())

def parse_zerodha(path):
    # Zerodha ships TWO shapes: the CSV export uses lowercase_underscore headers
    # (symbol, trade_type, …), the XLSX export Title Case with spaces (Symbol,
    # Trade Type, …). csv.DictReader took row 0 verbatim, so a Title Case file
    # produced keys that matched nothing and silently yielded zero trades —
    # and a wrong file did the same, indistinguishably. Normalise every header
    # cell to snake_case and locate the row explicitly.
    #
    # Read through _xlsx_rows, not csv.reader: this opened the path as UTF-8
    # text unconditionally, so the XLSX export (a zip) died on a
    # UnicodeDecodeError while the TS side read it fine. _xlsx_rows dispatches
    # on extension, which is what toMatrix() does in tradebookImport.ts.
    rows = _xlsx_rows(path)
    hidx = header_index(
        rows, "zerodha",
        lambda r: "symbol" in [snake(c) for c in r] and "trade_type" in [snake(c) for c in r])
    hdr = [snake(c) for c in rows[hidx]]
    out = []
    for r in rows[hidx + 1:]:
        d = dict(zip(hdr, [("" if c is None else str(c)).strip() for c in r]))
        if not d.get("symbol"):
            continue
        out.append(dict(
            broker="zerodha", raw_symbol=d["symbol"],
            raw_name=d["symbol"], isin=d.get("isin", ""),
            side=d.get("trade_type", "").lower(),
            quantity=num(d["quantity"]), price=num(d["price"]),
            trade_date=to_iso(d.get("trade_date", "")),
            trade_time=d.get("order_execution_time", ""),
            trade_id=d.get("trade_id", ""),
            order_id=d.get("order_id", ""),
            source_file=os.path.basename(path)))
    return out

def parse_fyers(path):
    out = []
    with open(path, newline="") as f:
        rows = list(csv.reader(f))
    # Find the header row. Fyers renamed the leading column between exports:
    # files up to Aug 2026 lead with "Name", ones from Sep 2026 lead with
    # "Symbol name" plus a duplicate "Symbol code" beside it. Accept both, and
    # raise a readable error instead of letting next() throw a bare
    # StopIteration when neither is present.
    # Testing r[0] alone is NOT enough: "Name" is also the first cell of other
    # brokers' preambles (Groww's order history opens with `Name,<your name>`),
    # so a Groww file parsed as Fyers matched row 0 and emitted junk trades
    # instead of erroring. Require a real data column alongside it.
    hidx = header_index(
        rows, "fyers",
        lambda r: r[0].strip() in ("Name", "Symbol name") and any(c.strip() == "Qty" for c in r))
    hdr = [c.strip() for c in rows[hidx]]
    for r in rows[hidx + 1:]:
        if not r or not r[0] or r[0] == "":
            continue
        d = dict(zip(hdr, r))
        # A tradebook lists executed trades only. Some exports carry a Status
        # column, the current ones do NOT — so filter on it ONLY when present,
        # otherwise every row (no Status) gets dropped as "not Executed".
        if "Status" in d and d.get("Status", "").strip() != "Executed":
            continue
        name = (d.get("Name") or d.get("Symbol name") or "").strip()
        if not name:
            continue
        # Either a Fyers symbol ("NSE:STEELCAS-EQ") or a full company name
        # ("STEELCAST LIMITED"). Keep the company name in raw_name when there's
        # no exchange wrapper — putting it in raw_symbol defeats name-based
        # universe resolution, which is the only way these map to a ticker.
        m = re.match(r"^[A-Z]+:(.+)-[A-Z]+$", name)
        sym = m.group(1) if m else ""
        # Column casing drifted ("Date & Time" -> "Date & time") and the clock is
        # packed after a comma ("05 Aug 2026, 09:49:14 AM"). Split on the comma so
        # to_iso sees only the date part.
        dt = (d.get("Date & time") or d.get("Date & Time") or "").strip()
        dd, _, tt = dt.partition(",")
        out.append(dict(
            broker="fyers", raw_symbol=sym, raw_name=("" if m else name), isin="",
            side=d.get("Side", "").strip().lower(),
            quantity=num(d["Qty"]), price=num(d["Traded price"]),
            trade_date=to_iso(dd.strip()), trade_time=tt.strip(),
            # Exchange/OMS order IDs are ORDER ids — shared across the partial
            # fills of one order (e.g. STEELCAST 30+15 under one id). Using one
            # as a trade id collapses those fills on dedup and silently drops
            # quantity. Leave it empty so dedup falls back to the
            # date|qty|price|time composite, which keeps distinct fills distinct.
            trade_id="",
            order_id=re.sub(r'[^0-9.]', '', d.get("OMS order ID", "")),
            source_file=os.path.basename(path)))
    return out

def _xlsx_rows(path, sheet=None):
    # Dispatch on extension, mirroring toMatrix() in tradebookImport.ts. This
    # used to assume a workbook unconditionally, so a broker that ships the
    # same report as CSV (Groww does) blew up in openpyxl with an unreadable
    # zipfile error instead of parsing — while the TS side read it fine.
    if path.lower().endswith(".csv"):
        with open(path, newline="") as f:
            return [list(r) for r in csv.reader(f)]
    if path.lower().endswith(".xls"):
        # A genuine legacy .xls is BIFF/OLE2, not a zip — openpyxl cannot read
        # it at all. The old code copied the file to a .xlsx name and handed it
        # to openpyxl, which is a rename, not a conversion: every real .xls
        # (5paisa ships one) died on BadZipFile. Some brokers do mislabel an
        # actual xlsx as .xls, so try the real BIFF reader first and fall back.
        try:
            import xlrd
            book = xlrd.open_workbook(path)
            sh = book.sheet_by_name(sheet) if sheet else book.sheet_by_index(0)
            return [[sh.cell_value(r, c) for c in range(sh.ncols)]
                    for r in range(sh.nrows)]
        except Exception:
            pass  # not BIFF after all — fall through to the zip-based reader
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet] if sheet else wb[wb.sheetnames[0]]
    return [list(r) for r in ws.iter_rows(values_only=True)]

def _fmt_date(v):
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()

MONTHS = {m: f"{i + 1:02d}" for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"])}

def to_iso(s):
    """Normalize a date token to YYYY-MM-DD.

    Accepts ISO, DD-MM-YYYY, DD/MM/YYYY, and the month-name forms Fyers emits
    ("05 Aug 2026"). The month-name branches MUST run before the space-split
    below, which would otherwise reduce "05 Aug 2026" to "05" and return it
    verbatim as the trade date. Mirrors toIso() in web/src/lib/tradebookImport.ts.
    """
    raw = str(s).strip()
    m = re.match(r"^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$", raw)  # Mon DD YYYY
    if m:
        mo = MONTHS.get(m.group(1)[:3].lower())
        if mo:
            return f"{m.group(3)}-{mo}-{int(m.group(2)):02d}"
    m = re.match(r"^(\d{1,2})[-\s]([A-Za-z]{3,})\.?,?[-\s](\d{4})$", raw)  # DD Mon YYYY
    if m:
        mo = MONTHS.get(m.group(2)[:3].lower())
        if mo:
            return f"{m.group(3)}-{mo}-{int(m.group(1)):02d}"
    s = raw.split(" ")[0]
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    m = re.match(r"^(\d{2})-(\d{2})-(\d{4})$", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return s

def parse_groww(path):
    rows = _xlsx_rows(path)
    hidx = header_index(rows, "groww", lambda r: r[0].strip() == "Stock name")
    hdr = [str(c).strip() if c else "" for c in rows[hidx]]
    out = []
    for r in rows[hidx + 1:]:
        d = dict(zip(hdr, r))
        if not d.get("Symbol"):
            continue
        if str(d.get("Order status", "")).strip() != "Executed":
            continue
        out.append(dict(
            broker="groww", raw_symbol=str(d["Symbol"]).strip(),
            raw_name=str(d.get("Stock name", "")).strip(),
            isin=str(d.get("ISIN", "")).strip(),
            side=str(d["Type"]).strip().lower(),
            quantity=num(d["Quantity"]),
            price=(num(d["Value"]) / num(d["Quantity"])) if d.get("Value") and num(d["Quantity"]) else None,
            trade_date=to_iso(_fmt_date(d.get("Execution date and time"))),
            trade_time=str(d.get("Execution date and time", "")).strip(),
            trade_id="", order_id=str(d.get("Exchange Order Id", "")).strip(),
            source_file=os.path.basename(path)))
    return out

def parse_upstox(path):
    rows = _xlsx_rows(path, "TRADE")
    hidx = header_index(rows, "upstox", lambda r: r[0].strip() == "Date")
    hdr = [str(c).strip() if c else "" for c in rows[hidx]]
    out = []
    for r in rows[hidx + 1:]:
        d = dict(zip(hdr, r))
        if not d.get("Company"):
            continue
        out.append(dict(
            broker="upstox", raw_symbol=str(d.get("Scrip Code", "")).strip(),
            raw_name=str(d["Company"]).strip(), isin="",
            side=str(d["Side"]).strip().lower(),
            quantity=num(d["Quantity"]), price=num(d["Price"]),
            # to_iso, like every other parser and like the TS side. Upstox
            # and 5paisa were the two that skipped it, so their trade_date came
            # through as "Aug 19 2026" and failed the route's ISO date gate.
            trade_date=to_iso(_fmt_date(d.get("Date"))),
            trade_time=str(d.get("Trade Time", "")).strip(),
            trade_id=str(d.get("Trade Num", "")).strip(), order_id="",
            source_file=os.path.basename(path)))
    return out

def parse_5paisa(path):
    rows = _xlsx_rows(path)
    hidx = header_index(rows, "fivepaisa", lambda r: r[0].strip() == "Transaction Date")
    hdr = [str(c).strip() if c else "" for c in rows[hidx]]
    out = []
    for r in rows[hidx + 1:]:
        d = dict(zip(hdr, r))
        if not d.get("Company Name"):
            continue
        out.append(dict(
            broker="fivepaisa", raw_symbol="",
            raw_name=str(d["Company Name"]).strip(), isin="",
            side=str(d["Type"]).strip().lower(),
            quantity=num(d["Quantity"]), price=num(d["Price"]),
            trade_date=to_iso(_fmt_date(d.get("Transaction Date"))),
            trade_time="", trade_id="", order_id="",
            source_file=os.path.basename(path)))
    return out

PARSERS = {
    "zerodha": parse_zerodha,
    "fyers": parse_fyers,
    "groww": parse_groww,
    "upstox": parse_upstox,
    "fivepaisa": parse_5paisa,
}


def dump_json(broker, path):
    """Parse one file and print the records as JSON. No DB, no side effects.

    Exists so the TypeScript test suite can run BOTH implementations over the
    same fixture and diff them (web/src/lib/__tests__/tradebookParity.test.ts).
    That test is the only thing that actually enforces the parity this module's
    docstring claims — without it the two sides drifted silently for months.

    Exit codes are part of the contract: 0 = parsed (possibly zero rows),
    3 = TradebookFormatError (not this broker's file). Anything else is a bug.
    """
    import json
    fn = PARSERS.get(broker)
    if fn is None:
        print(f"unknown broker: {broker}", file=sys.stderr)
        return 2
    try:
        recs = fn(path)
    except TradebookFormatError as e:
        print(json.dumps({"error": "format", "message": str(e)}))
        return 3
    # Drop source_file: it is the on-disk filename, which the TS parser has no
    # concept of, and it would make every comparison fail for no good reason.
    for r in recs:
        r.pop("source_file", None)
    print(json.dumps(recs, default=str))
    return 0


def collect():
    recs = []
    for p in glob.glob(f"{DOWNLOADS}/tradebook-*-EQ*.csv"):
        recs += parse_zerodha(p)
    for p in glob.glob(f"{DOWNLOADS}/FYERS_orderbook_*.csv"):
        recs += parse_fyers(p)
    for p in glob.glob(f"{DOWNLOADS}/Stocks_Order_History_*.xlsx"):
        recs += parse_groww(p)
    for p in glob.glob(f"{DOWNLOADS}/trade_*.xlsx"):
        recs += parse_upstox(p)
    for p in glob.glob(f"{DOWNLOADS}/Trade_Report_Equity_*.xls"):
        recs += parse_5paisa(p)
    return recs

def dedup_key(r):
    if r.get("trade_id"):
        raw = f"{r['broker']}|tid|{r['trade_id']}"
    else:
        raw = f"{r['broker']}|{r['trade_date']}|{r['symbol']}|{r['side']}|{r['quantity']}|{r['price']}|{r.get('trade_time','')}"
    return hashlib.md5(raw.encode()).hexdigest()

def recompute_derived_holding(cur, user_id, symbol):
    """Rebuild the synthetic broker='derived' portfolio_holding row for one
    (user, symbol) from that user's transactions. 1:1 mirror of
    web/src/lib/derivedHoldings.ts::recomputeDerivedHolding — average-cost walk,
    snapshot-wins (except hand-entered trades layer on top), imported_at = first
    trade / snapshot date. Idempotent."""
    # Real broker snapshot rows for this symbol (everything except 'derived').
    cur.execute(
        "select quantity::float8, avg_cost::float8, imported_at::text "
        "from app.portfolio_holding "
        "where user_id=%s and broker<>'derived' and symbol=%s",
        (user_id, symbol))
    snap_rows = cur.fetchall()
    has_snapshot = len(snap_rows) > 0

    cur.execute(
        "select side, trade_date::text, quantity::float8, price::float8, "
        "(source_file='manual-entry') as manual "
        "from app.portfolio_transaction where user_id=%s and symbol=%s "
        "order by trade_date asc, trade_time asc nulls first, id asc",
        (user_id, symbol))
    txns = cur.fetchall()
    has_manual = any(r[4] for r in txns)

    # Snapshot wins UNLESS the user hand-entered trades for this symbol. Manual
    # entries layer on top of the snapshot; imported tradebooks still defer.
    if has_snapshot and not has_manual:
        cur.execute(
            "delete from app.portfolio_holding "
            "where user_id=%s and broker='derived' and raw_symbol=%s",
            (user_id, symbol))
        return

    # Seed an opening lot from the snapshot (weighted-avg cost) and apply only the
    # manual trades on top; with no snapshot, walk every trade (pure derived).
    qty = 0.0
    avg = 0.0
    first_date = None
    if has_snapshot:
        s_qty = 0.0
        s_cost_sum = 0.0
        s_cost_qty = 0.0
        s_date = None
        for sq, savg, s_imp in snap_rows:
            s_qty += sq
            if savg is not None:
                s_cost_sum += sq * savg
                s_cost_qty += sq
            if s_imp and (s_date is None or s_imp < s_date):
                s_date = s_imp
        qty = s_qty
        avg = s_cost_sum / s_cost_qty if s_cost_qty > 0 else 0.0
        first_date = s_date
    walk = [r for r in txns if r[4]] if has_snapshot else txns
    for side, d, q, price, _manual in walk:
        if first_date is None:
            first_date = d
        if side == "buy":
            nxt = qty + q
            avg = (qty * avg + q * price) / nxt if nxt > 0 else 0.0
            qty = nxt
        else:
            qty -= q
    qty = round(qty, 4)

    if qty <= 0:
        cur.execute(
            "delete from app.portfolio_holding "
            "where user_id=%s and broker='derived' and raw_symbol=%s",
            (user_id, symbol))
        return

    cur.execute("select isin from app.universe where symbol=%s limit 1", (symbol,))
    row = cur.fetchone()
    isin = row[0] if row else None
    avg_cost = round(avg, 4) if avg > 0 else None
    imported_at = first_date or date.today().isoformat()

    cur.execute("""
        insert into app.portfolio_holding
          (user_id, broker, raw_symbol, isin, symbol, is_mapped, quantity,
           avg_cost, source_batch, imported_at)
        values (%s,'derived',%s,%s,%s,true,%s,%s,gen_random_uuid(),%s)
        on conflict (user_id, broker, raw_symbol) do update
          set quantity=excluded.quantity,
              avg_cost=excluded.avg_cost,
              isin=excluded.isin,
              symbol=excluded.symbol,
              is_mapped=true,
              imported_at=excluded.imported_at
    """, (user_id, symbol, isin, symbol, qty, avg_cost, imported_at))

DDL = """
create table if not exists app.portfolio_transaction (
    id           bigserial primary key,
    user_id      bigint not null,
    broker       text   not null,
    trade_date   date   not null,
    trade_time   text,
    side         text   not null check (side in ('buy','sell')),
    symbol       text   not null,
    raw_symbol   text,
    raw_name     text,
    isin         text,
    quantity     numeric not null,
    price        numeric not null,
    trade_id     text,
    order_id     text,
    source_file  text,
    dedup_key    text not null unique,
    imported_at  timestamptz not null default now()
);
create index if not exists idx_ptx_user_symbol on app.portfolio_transaction(user_id, symbol);
create index if not exists idx_ptx_symbol_date on app.portfolio_transaction(symbol, trade_date);
"""

def recompute_all(cur):
    """Rebuild derived holdings for every symbol the user has ever traded."""
    cur.execute(
        "select distinct symbol from app.portfolio_transaction "
        "where user_id=%s and symbol is not null",
        (USER_ID,))
    syms = sorted(r[0] for r in cur.fetchall())
    cur.execute(
        "select count(*) from app.portfolio_holding where user_id=%s and broker='derived'",
        (USER_ID,))
    before = cur.fetchone()[0]
    for s in syms:
        recompute_derived_holding(cur, USER_ID, s)
    cur.execute(
        "select count(*) from app.portfolio_holding where user_id=%s and broker='derived'",
        (USER_ID,))
    after = cur.fetchone()[0]
    return syms, before, after


def main():
    # Parse-only mode — must be handled BEFORE any DB connection so the parity
    # test can run with no database available at all.
    if "--dump-json" in sys.argv:
        i = sys.argv.index("--dump-json")
        return dump_json(sys.argv[i + 1], sys.argv[i + 2])

    db = get_db_url()
    conn = psycopg2.connect(db)
    cur = conn.cursor()

    # Backfill mode: recompute all derived holdings, no CSV import.
    if RECOMPUTE_ALL:
        cur.execute(DDL)
        syms, before, after = recompute_all(cur)
        print(f"\nDB: {db.split('@')[-1].split('/')[0]}")
        print(f"recompute-all: {len(syms)} traded symbols · derived rows {before} -> {after}")
        if not COMMIT:
            conn.rollback()
            print("DRY RUN — pass --commit to write.")
            return
        conn.commit()
        print("COMMITTED.")
        return

    ref = load_universe(cur)
    recs = collect()

    kept, dropped = [], {}
    seen = set()
    for r in recs:
        if r["side"] not in ("buy", "sell"):
            dropped.setdefault(f"bad-side:{r['broker']}", 0)
            dropped[f"bad-side:{r['broker']}"] += 1
            continue
        sym = resolve(r, ref)
        if not sym:
            dropped.setdefault(f"etf/unmapped:{r['broker']}", 0)
            dropped[f"etf/unmapped:{r['broker']}"] += 1
            continue
        r["symbol"] = sym
        k = dedup_key(r)
        if k in seen:
            dropped.setdefault("intra-run-dup", 0)
            dropped["intra-run-dup"] += 1
            continue
        seen.add(k)
        r["dedup_key"] = k
        kept.append(r)

    # summary
    print(f"\nDB: {db.split('@')[-1].split('/')[0]}")
    print(f"parsed {len(recs)} raw rows -> keeping {len(kept)} equity trades")
    from collections import Counter
    bc = Counter(r["broker"] for r in kept)
    for b in sorted(bc):
        buys = sum(1 for r in kept if r["broker"] == b and r["side"] == "buy")
        sells = sum(1 for r in kept if r["broker"] == b and r["side"] == "sell")
        print(f"  {b:10s}: {bc[b]:3d}  (buy {buys}, sell {sells})")
    print("dropped:")
    for k in sorted(dropped):
        print(f"  {k}: {dropped[k]}")
    syms = sorted(set(r["symbol"] for r in kept))
    print(f"distinct symbols: {len(syms)}")
    dr = sorted(r["trade_date"] for r in kept)
    print(f"date range: {dr[0]} -> {dr[-1]}")

    if not COMMIT:
        print("\nDRY RUN — pass --commit to write.")
        return

    cur.execute(DDL)

    # CSV takes precedence over hand entry: drop any manual entry that matches an
    # imported trade on (symbol, broker, trade_date, quantity) — it's the same
    # real trade typed in by hand, so keeping both would double-count. Mirror of
    # web/src/app/api/portfolio/import-trades/route.ts. Dedup tuple is the product
    # spec's, NOT dedup_key (which also keys on side/price/time).
    superseded = 0
    seen_tuples = set()
    for r in kept:
        key = (r["symbol"], r["broker"], r["trade_date"], r["quantity"])
        if key in seen_tuples:
            continue
        seen_tuples.add(key)
        cur.execute("""
            delete from app.portfolio_transaction
             where user_id=%s and source_file='manual-entry'
               and broker=%s and symbol=%s and trade_date=%s and quantity=%s
        """, (USER_ID, r["broker"], r["symbol"], r["trade_date"], r["quantity"]))
        superseded += cur.rowcount

    ins = 0
    for r in kept:
        cur.execute("""
            insert into app.portfolio_transaction
              (user_id,broker,trade_date,trade_time,side,symbol,raw_symbol,raw_name,
               isin,quantity,price,trade_id,order_id,source_file,dedup_key)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (dedup_key) do nothing
        """, (USER_ID, r["broker"], r["trade_date"], r.get("trade_time"),
              r["side"], r["symbol"], r.get("raw_symbol"), r.get("raw_name"),
              r.get("isin") or None, r["quantity"], r["price"],
              r.get("trade_id") or None, r.get("order_id") or None,
              r["source_file"], r["dedup_key"]))
        ins += cur.rowcount

    # Recompute the transaction-derived holdings for every symbol this import
    # touched. A symbol with a real broker snapshot keeps the snapshot
    # (snapshot-wins) and its derived row is dropped; a symbol without one gets a
    # synthetic broker='derived' position computed from its trades. 1:1 mirror of
    # web/src/lib/derivedHoldings.ts, run in the same transaction as the inserts.
    symbols = sorted({r["symbol"] for r in kept if r.get("symbol")})
    for sym in symbols:
        recompute_derived_holding(cur, USER_ID, sym)

    conn.commit()
    print(f"\nCOMMITTED: inserted {ins} new rows (dedup_key conflicts skipped).")
    if superseded:
        print(f"superseded {superseded} manual entries matched by CSV trades.")
    if symbols:
        print(f"recomputed derived holdings for {len(symbols)} symbols.")
    cur.execute("select count(*) from app.portfolio_transaction where user_id=%s", (USER_ID,))
    print(f"table now holds {cur.fetchone()[0]} rows for user {USER_ID}.")

if __name__ == "__main__":
    sys.exit(main() or 0)
