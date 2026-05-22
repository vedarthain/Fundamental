# Operations Runbook

Short, scannable. For each scenario: detection, immediate response, root-cause fix.

## Index

- [Backup & restore](#backup--restore)
- [Recovery scenarios](#recovery-scenarios)
- [Common ops](#common-ops)

---

## Backup & restore

### Neon (production)

Neon takes automatic point-in-time snapshots — no setup needed.

**View available restore points:**
Neon Dashboard → your project → Branches → click the branch → "Restore" button.

**Restore to a previous point:**
1. Dashboard → Branches → "Restore" → pick a timestamp
2. Neon creates a NEW branch (e.g. `production-restored-2026-05-22`)
3. Test queries against the new branch
4. If good: promote it to primary (Branches → ⋯ → "Set as default") OR copy specific tables back to production manually

History retention is **7 days on Launch plan**. After 7 days, older points are gone.

### Local Postgres

No automatic backups. To back up explicitly:

```bash
# App DB
pg_dump fundamental_app --no-owner --no-acl -Fc -f /tmp/fundamental_app.dump

# Golden DB (with --data-only because schema is large)
pg_dump golden_db --no-owner --no-acl --schema=golden -Fc -f /tmp/golden_db.dump
```

Keep these on iCloud / external disk. They're small (~100MB combined gzipped).

### Restore local from dump

```bash
createdb fundamental_app
pg_restore -d fundamental_app /tmp/fundamental_app.dump
```

---

## Recovery scenarios

### "Local Postgres is dead"

You can rebuild from scratch — Neon has everything that matters:

```bash
# 1. Recreate local app DB
createdb fundamental_app
psql fundamental_app -c "CREATE SCHEMA IF NOT EXISTS app;"

# 2. Pull production schema + data
PGPASSWORD=<...> pg_dump "$NEON_APP_URL" \
    --schema=app --no-owner --no-acl \
    | psql fundamental_app

# 3. Pull golden DB
createdb golden_db
PGPASSWORD=<...> pg_dump "$NEON_GOLDEN_URL" \
    --schema=golden --no-owner --no-acl \
    | psql golden_db

# 4. Baseline migrations as already-applied
etl/.venv/bin/python scripts/migrate.py --baseline
```

What's missing from Neon (only on local):
- `app.screener_export_raw` — raw Excel blobs from Screener (re-scrape if needed)
- Historical scores beyond the latest snapshot

### "Neon is dead"

Use a Neon restore-point branch (see Backup & Restore above). If the entire project is lost:

1. Create a new Neon project
2. Run all schema migrations: `scripts/migrate.py --url "$NEW_NEON_URL"`
3. Run `scripts/sync-neon.sh` to populate from local
4. Re-baseline GitHub Action secrets to point at the new URLs

### "Screener cookies expired"

**Detection:** `check-freshness.py` workflow alerts when ≥10 auth_failed scrapes in the last 7 days.

**Fix:**
1. Open Screener.in in a browser and log in
2. Open DevTools → Application → Cookies → screener.in
3. Copy `sessionid` and `csrftoken` values
4. Update `etl/.env.local`:
   ```
   SCREENER_SESSIONID=...
   SCREENER_CSRFTOKEN=...
   ```
5. Run a small fetch to verify: `etl fetch-many --limit 5`

Cookies typically last 4-8 weeks before they need refreshing.

### "Sectors page is slow / empty"

**Detection:** chart load time > 1s OR `panel_cache` check fails on freshness check.

**Possible causes:**
- `cluster_stocks_panel_cache` empty on Neon → run `sync-neon.sh`
- Cache stale beyond 24h → Vercel will revalidate on next visit; if persistent, check Vercel deployment logs
- Neon compute auto-scaled up unexpectedly → check Neon dashboard, autoscaling should be 0.25 ↔ 0.5 CU

### "GitHub Action workflow failing"

GitHub auto-emails repo notification recipients. Log in to Actions tab, find the run, read the failed step's output.

Common failures:
- **freshness-check fails** → look at which check (snapshot/price/panel/cookie) and dig into root cause
- **refresh-ltp fails** → NSE bhavcopy URL changed OR network issue. Re-run manually after fixing
- **web-ci fails** → run `npm run lint` + `npx tsc --noEmit` locally to reproduce; fix the offending file

---

## Common ops

### Apply a new migration

1. Create `db/migrations/NNNN_short_name.sql`
2. Run locally: `etl/.venv/bin/python scripts/migrate.py`
3. Verify: `etl/.venv/bin/python scripts/migrate.py --status`
4. On next `./scripts/sync-neon.sh`, it auto-applies to Neon. Or manually:
   `etl/.venv/bin/python scripts/migrate.py --url "$NEON_APP_URL"`

### Push fresh data to Neon

```bash
./scripts/sync-neon.sh
```
Does migrate.py → table syncs → price history incremental. Idempotent.

### Refresh a single stock manually

```bash
cd etl
.venv/bin/python -m fundamental_etl.cli fetch SYMBOL
.venv/bin/python -m fundamental_etl.cli compute-metrics --only SYMBOL
.venv/bin/python -m fundamental_etl.cli score
```

### Backfill historical price data for a renamed ticker

```bash
scripts/backfill-nse-bhavcopy.py --symbol NEWSYM --also OLDSYM \
    --start 2016-07-01 --end 2026-02-17
```

Then add the entry to `SYMBOL_RENAMES` in `scripts/backfill-nse-bhavcopy.py` so future backfills are automatic.

### Check what needs investigating

```bash
# Data freshness
etl/.venv/bin/python scripts/check-freshness.py

# Data quality
etl/.venv/bin/python scripts/check-dq.py

# Likely ticker renames
etl/.venv/bin/python scripts/audit-renamed-tickers.py

# Local vs Neon drift
etl/.venv/bin/python scripts/check-drift.py
```

### Manually trigger a GitHub workflow

GitHub → Actions tab → pick workflow → "Run workflow" button.

Most workflows have `workflow_dispatch` triggers for manual execution.
