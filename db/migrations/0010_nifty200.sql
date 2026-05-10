-- 0010_nifty200.sql
-- Adds is_nifty200 flag to app.universe and seeds it with the current
-- 200 constituents (as of 2026-Q2). Used to scale the Neon-deployed
-- soft-launch from Nifty 50 → Nifty 200 once the platform is stable.
--
-- Why a separate flag (not just bumping is_nifty50 → is_nifty500)?
--   - Nifty 200 ⊃ Nifty 50, so we keep both flags. /discover and other
--     surfaces can still pivot to "Nifty 50 only" if we ever want a
--     curated mode again.
--   - is_nifty500 column already exists (0007) but was never seeded;
--     when we eventually scale to Nifty 500 we can populate that one
--     using the same pattern as this migration.
--
-- The list is hardcoded here rather than fetched live, because:
--   - The Nifty 200 rebalances semi-annually (Mar / Sep)
--   - Migrations must be idempotent and reproducible
--   - Refresh by pulling https://archives.nseindia.com/content/indices/ind_nifty200list.csv
--     and rewriting the UPDATE below.
--
-- DUMMYVEDL1-4 are intentionally excluded — those are NSE placeholder
-- rows for the Vedanta demerger (parallels TATAMOTORS → TMPV/TMCV split).
-- The real demerged tickers (HZL, etc.) are already covered separately.

ALTER TABLE app.universe
  ADD COLUMN IF NOT EXISTS is_nifty200 BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_universe_nifty200
  ON app.universe (is_nifty200)
  WHERE is_nifty200 = TRUE;

-- Reset before re-applying so a refreshed list doesn't accumulate stale entries.
UPDATE app.universe SET is_nifty200 = FALSE;

UPDATE app.universe
   SET is_nifty200 = TRUE
 WHERE symbol IN (
   '360ONE',     'ABB',        'ABCAPITAL',  'ADANIENSOL', 'ADANIENT',
   'ADANIGREEN', 'ADANIPORTS', 'ADANIPOWER', 'ALKEM',      'AMBUJACEM',
   'APLAPOLLO',  'APOLLOHOSP', 'ASHOKLEY',   'ASIANPAINT', 'ASTRAL',
   'ATGL',       'AUBANK',     'AUROPHARMA', 'AXISBANK',   'BAJAJ-AUTO',
   'BAJAJFINSV', 'BAJAJHLDNG', 'BAJFINANCE', 'BANKBARODA', 'BANKINDIA',
   'BDL',        'BEL',        'BHARATFORG', 'BHARTIARTL', 'BHEL',
   'BIOCON',     'BLUESTARCO', 'BOSCHLTD',   'BPCL',       'BRITANNIA',
   'BSE',        'CANBK',      'CGPOWER',    'CHOLAFIN',   'CIPLA',
   'COALINDIA',  'COCHINSHIP', 'COFORGE',    'COLPAL',     'CONCOR',
   'COROMANDEL', 'CUMMINSIND', 'DABUR',      'DIVISLAB',   'DIXON',
   'DLF',        'DMART',      'DRREDDY',    'EICHERMOT',  'ENRIN',
   'ETERNAL',    'EXIDEIND',   'FEDERALBNK', 'FORTIS',     'GAIL',
   'GLENMARK',   'GMRAIRPORT', 'GODFRYPHLP', 'GODREJCP',   'GODREJPROP',
   'GRASIM',     'GROWW',      'GVT&D',      'HAL',        'HAVELLS',
   'HCLTECH',    'HDFCAMC',    'HDFCBANK',   'HDFCLIFE',   'HEROMOTOCO',
   'HINDALCO',   'HINDPETRO',  'HINDUNILVR', 'HINDZINC',   'HUDCO',
   'HYUNDAI',    'ICICIAMC',   'ICICIBANK',  'ICICIGI',    'IDEA',
   'IDFCFIRSTB', 'INDHOTEL',   'INDIANB',    'INDIGO',     'INDUSINDBK',
   'INDUSTOWER', 'INFY',       'IOC',        'IRCTC',      'IREDA',
   'IRFC',       'ITC',        'JINDALSTEL', 'JIOFIN',     'JSWENERGY',
   'JSWSTEEL',   'JUBLFOOD',   'KALYANKJIL', 'KEI',        'KOTAKBANK',
   'KPITTECH',   'LAURUSLABS', 'LENSKART',   'LGEINDIA',   'LICHSGFIN',
   'LODHA',      'LT',         'LTF',        'LTM',        'LUPIN',
   'M&M',        'M&MFIN',     'MANKIND',    'MARICO',     'MARUTI',
   'MAXHEALTH',  'MAZDOCK',    'MCX',        'MFSL',       'MOTHERSON',
   'MOTILALOFS', 'MPHASIS',    'MRF',        'MUTHOOTFIN', 'NATIONALUM',
   'NAUKRI',     'NESTLEIND',  'NHPC',       'NMDC',       'NTPC',
   'NYKAA',      'OBEROIRLTY', 'OFSS',       'OIL',        'ONGC',
   'PAGEIND',    'PATANJALI',  'PAYTM',      'PERSISTENT', 'PFC',
   'PHOENIXLTD', 'PIDILITIND', 'PIIND',      'PNB',        'POLICYBZR',
   'POLYCAB',    'POWERGRID',  'POWERINDIA', 'PREMIERENE', 'PRESTIGE',
   'RADICO',     'RECLTD',     'RELIANCE',   'RVNL',       'SAIL',
   'SBICARD',    'SBILIFE',    'SBIN',       'SHREECEM',   'SHRIRAMFIN',
   'SIEMENS',    'SOLARINDS',  'SRF',        'SUNPHARMA',  'SUPREMEIND',
   'SUZLON',     'SWIGGY',     'TATACAP',    'TATACOMM',   'TATACONSUM',
   'TATAELXSI',  'TATAINVEST', 'TATAPOWER',  'TATASTEEL',  'TCS',
   'TECHM',      'TIINDIA',    'TITAN',      'TMCV',       'TMPV',
   'TORNTPHARM', 'TRENT',      'TVSMOTOR',   'ULTRACEMCO', 'UNIONBANK',
   'UNITDSPR',   'UPL',        'VBL',        'VEDL',       'VMM',
   'VOLTAS',     'WAAREEENER', 'WIPRO',      'YESBANK',    'ZYDUSLIFE'
 );
