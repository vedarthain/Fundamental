# Commands Cheat Sheet

> Everything you actually use to run the platform. Bookmark this one.

---

## 🚀 Daily / weekly

```bash
cd ~/Documents/Fundamental

./snap        # ⭐ Take a weekly score snapshot — recompute metrics + score
./dev         # Start the Next.js dev server (http://localhost:3000)
```

The shell-startup nag in `~/.zshrc` will warn you if `./snap` hasn't been run in 8+ days.

---

## 📥 Fetch new data (when it changes)

```bash
PY="etl/.venv/bin/python -m fundamental_etl.cli"

# One stock
$PY fetch RELIANCE
$PY fetch SPLIL --standalone     # for older Indian stocks with sparse consolidated data

# Many stocks (default: all active not scraped in last 20 hours)
$PY fetch-many
$PY fetch-many --only RELIANCE,TCS,INFY

# Auto-detect + repair sparse stocks (re-fetches via Screener standalone view)
$PY repair --min-years 8 --limit 50
```

---

## 🏢 Refresh metadata (rare — quarterly cadence)

```bash
PY="etl/.venv/bin/python -m fundamental_etl.cli"

# Business summary + website + employees (from yfinance)
$PY fetch-business-info

# CEO / MD + key officers list (from yfinance companyOfficers)
$PY fetch-officers

# Quarterly shareholding pattern (scraped from Screener company page HTML)
$PY fetch-shareholding
```

**Common flags for all three:**
- `--refresh` — re-fetch even if already populated
- `--only RELIANCE,TCS` — limit to specific symbols
- `--throttle 1.5` — seconds between calls (default 1.5; respect upstream)

---

## 🔬 Pipeline internals (`./snap` runs these for you)

```bash
PY="etl/.venv/bin/python -m fundamental_etl.cli"

$PY assign-clusters                            # cluster_id + maturity_tier per stock
$PY compute-metrics                             # all active stocks, today's snapshot
$PY compute-metrics --snapshot 2026-05-12       # specific date
$PY compute-metrics --only RELIANCE             # specific stocks
$PY score                                       # percentile + composite scorer (today)
$PY score --snapshot 2026-05-12                 # backfill a specific date
```

---

## 🗄️ Database — quick checks

### Latest snapshot date + row count

```sql
SELECT snapshot_date, COUNT(*)
FROM app.scores
GROUP BY snapshot_date
ORDER BY snapshot_date DESC
LIMIT 5;
```

### How fresh is each data source?

```sql
SELECT 'screener xlsx'    AS source, MAX(last_scraped_at)::date AS as_of FROM app.screener_meta
UNION ALL
SELECT 'business info',   MAX(business_info_fetched_at)::date   FROM app.universe
UNION ALL
SELECT 'officers',        MAX(officers_fetched_at)::date         FROM app.universe
UNION ALL
SELECT 'shareholding',    MAX(parsed_at)::date                   FROM app.shareholding_pattern
UNION ALL
SELECT 'last snapshot',   MAX(snapshot_date)                     FROM app.scores;
```

### A specific stock's score history

```sql
SELECT snapshot_date, composite_pct, quality_pct, valuation_pct, momentum_pct
FROM app.scores
WHERE symbol = 'RELIANCE'
ORDER BY snapshot_date DESC;
```

### Coverage of optional metadata

```sql
SELECT
  COUNT(*) FILTER (WHERE is_active)              AS active_stocks,
  COUNT(*) FILTER (WHERE business_summary IS NOT NULL) AS has_summary,
  COUNT(*) FILTER (WHERE ceo_name IS NOT NULL)         AS has_ceo,
  COUNT(*) FILTER (WHERE is_nifty500)                  AS in_nifty500
FROM app.universe;
```

### Apply a migration

```bash
psql fundamental_app -f db/migrations/000X_name.sql
```

---

## 🌐 URLs you actually open

| URL | What it is |
|---|---|
| `http://localhost:3000/` | Landing page |
| `http://localhost:3000/discover` | Score-weighted screener (was `/screener`, now redirects) |
| `http://localhost:3000/clusters` | All 41 clusters heat map |
| `http://localhost:3000/cluster/<id>` | Single cluster overview |
| `http://localhost:3000/cluster/<id>/leaders` | Top stocks in a cluster |
| `http://localhost:3000/stock/<SYMBOL>` | Stock page (3 tabs: About / Strengths & gaps / The Numbers) |
| `http://localhost:3000/feed` | Score deltas between latest 2 snapshots |
| `http://localhost:3000/ideas` | Rising stars / deteriorating quality (not built yet) |
| `http://localhost:3000/about` | Methodology page |
| `http://localhost:3000/admin/scorecards` | Cluster scorecard editor |

---

## 📁 Files you actually touch

```
~/Documents/Fundamental/
├── snap                       ⭐ Run this every Friday
├── dev                        Start Next.js
├── .env.local                 Postgres URLs + Screener cookies
├── docs/
│   ├── MOAT.md                The four moats (memorize the one-paragraph version)
│   ├── PITCH.md               10s / 30s / 60s elevator pitches
│   ├── IDEAS_DESIGN.md        Six rules for /ideas
│   ├── SNAPSHOT_CRON.md       Snapshot ops + launchd setup
│   ├── COMMANDS.md            (this file)
│   ├── architecture.md        System architecture
│   ├── scorecards.md          Cluster scorecard reference
│   ├── scoring-engine.md      How the scorer works
│   └── sector-clusters.md     The 41-cluster taxonomy
├── db/migrations/             Apply with: psql fundamental_app -f db/migrations/000X.sql
├── etl/
│   ├── .venv/                 Python venv (don't activate; always use full path)
│   └── src/fundamental_etl/   ETL source
└── web/                       Next.js app
```

---

## 🔁 Common combos

### Friday workflow (5 min)

```bash
cd ~/Documents/Fundamental
./snap
```

### After fetching fresh data for a few stocks, re-score them

```bash
PY="etl/.venv/bin/python -m fundamental_etl.cli"
$PY fetch-many --only RELIANCE,TCS,INFY
./snap
```

### Nuke + rebuild a single stock end-to-end

```bash
PY="etl/.venv/bin/python -m fundamental_etl.cli"
$PY fetch RELIANCE
$PY compute-metrics --only RELIANCE
$PY score
```

### Add CEO / shareholding for a single stock (testing)

```bash
PY="etl/.venv/bin/python -m fundamental_etl.cli"
$PY fetch-officers     --only RELIANCE --refresh
$PY fetch-shareholding --only RELIANCE --refresh
```

---

## Help anytime

```bash
PY="etl/.venv/bin/python -m fundamental_etl.cli"

$PY --help                     # list all commands
$PY fetch --help               # help for one command
$PY fetch-officers --help
```

---

*Last updated: 2026-05-09*
