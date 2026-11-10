# Local Scripts & Ollama Reference Guide

Quick reference for running heavy / LLM-backed jobs locally on your Mac (via **Ollama**) and pushing the results to Production (**Neon Postgres**), rather than running them on GitHub Actions.

---

## 1. Company Overviews (`app.company_overview`) via Local Ollama

Company overviews are extracted from each company's official **Annual Report PDF** (`Reg. 34(1)` filing in `app.announcement`). Because companies only file an Annual Report **once per year**, this job does not need to run daily.

### Recommended Schedule
| Period | Reason | Frequency |
| :--- | :--- | :--- |
| **July – September** *(Peak AGM Season)* | ~90% of NSE/BSE companies file their new FY Annual Reports between mid-July and late September. | **Every 2 weeks** *(or Monthly)* |
| **October – June** *(Off-Season)* | Only December year-end companies (Feb–Apr), late filers, or newly listed IPOs file Annual Reports. | **Once a quarter** *(every 2–3 months)* |
| **On-Demand** *(Anytime)* | When adding a new stock to the Calls Desk / Portfolio that has no overview yet. | **Single-symbol command below** |

### Prerequisites
- Make sure **Ollama** is running locally (`ollama serve` or the Ollama Mac app) and `poppler` (`pdftotext`, `pdfinfo`) is installed (`brew install poppler`).
- `.env.local` is loaded automatically by `scripts/build-overview-from-filing.mjs`. Passing `--prod` points it directly at `NEON_APP_URL`.

### Commands

```bash
# 1. Single stock (On-Demand — e.g. for a new Call Desk pick)
node scripts/build-overview-from-filing.mjs TRANSRAILL --ollama --prod --apply

# 2. Multiple specific stocks at once
node scripts/build-overview-from-filing.mjs TRANSRAILL BANKBARODA FMGOETZE --ollama --prod --apply

# 3. Backfill missing overviews (Nifty 500 prioritized first; attempts 25 stocks)
node scripts/build-overview-from-filing.mjs --missing 25 --ollama --prod --apply

# 4. Refresh stale / superseded overviews (rebuilds stocks that filed a newer Annual Report)
node scripts/build-overview-from-filing.mjs --stale --limit 25 --ollama --prod --apply

# 5. Dry-run a single stock (prints extracted markdown table without writing to DB)
node scripts/build-overview-from-filing.mjs TRANSRAILL --ollama --prod

# 6. Use a specific local Ollama model (default is qwen2.5:14b)
node scripts/build-overview-from-filing.mjs --missing 25 --ollama --ollama-model qwen2.5:14b --prod --apply
```

> **Note:** If a stock reports `NO FILING — no annual report in app.announcement`, fetch the latest exchange filings first:
> ```bash
> set -a && source .env.local && set +a
> APP_DB_URL="$NEON_APP_URL" FUNDAMENTAL_ALLOW_REMOTE_DB=1 etl/.venv/bin/python scripts/fetch-nse-annual-reports.py
> ```

---

## 2. Stock Verdicts (`app.stock_verdict`) via Local Ollama

Generate structured 8-section forensic verdicts locally and sync them to Neon.

```bash
# 1. Generate & load verdict for a single stock into local DB using Ollama
etl/.venv/bin/python scripts/ollama-verdict.py --engine ollama --symbol FMGOETZE --load

# 2. Generate & load verdicts for portfolio stocks (bounded batch)
etl/.venv/bin/python scripts/ollama-verdict.py --engine ollama --portfolio --limit 10 --load

# 3. Push local stock verdicts to Neon Production
set -a && source .env.local && set +a
etl/.venv/bin/python scripts/sync-verdicts-to-neon.py
```

---

## 3. Database Sync (Local Postgres ↔ Neon Production)

If you run scripts against your local Postgres (`fundamental_app`) first, use these scripts to sync between local and Neon:

```bash
# Pull latest production data (including company_overview, scores, universe, holdings) → Local Postgres
set -a && source .env.local && set +a
./scripts/pull-from-neon.sh

# Push local snapshots, scores, cluster assignments, and company_overview → Neon Production
set -a && source .env.local && set +a
./scripts/sync-neon.sh
```
