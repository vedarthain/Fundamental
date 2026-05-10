# Soft-Launch Checklist — Nifty 50 on Neon + Vercel

> Step-by-step from "code on laptop" to "live URL with users". Designed for an
> afternoon. Assumes you've read `docs/DEPLOYMENT_VERCEL.md` for context.
>
> **Cost: ₹0/mo** if you stay inside Neon Free + Vercel Hobby tiers.

---

## What's already built (done)

- `db/migrations/0009_nifty50.sql` — adds `is_nifty50` column + seeds 51 symbols
- `scripts/migrate-nifty50-to-neon.sh` — one-shot migration script
- `scripts/sync-neon.sh` — incremental sync (run after each `./snap`)

Local DB is already flagged. ~20 MB to push. Smoke-tested.

---

## Phase 1 — sign-ups (15 min, your turn)

### 1.1 Neon
1. Go to **neon.tech** → Sign in with GitHub.
2. Create new project:
   - Name: `fundamental`
   - Region: **AWS Mumbai (ap-south-1)** ← critical for Indian users
   - Postgres version: **16**
   - Default DB name: `fundamental_app`
3. After creation, dashboard → **Databases** → **New database** → name: `golden_db`
4. Stay on **Free** plan (no card needed).
5. Copy two connection strings (use the **pooled** version, ends in `-pooler`):
   ```
   postgresql://USER:PWD@ep-XXX-pooler.ap-south-1.aws.neon.tech/fundamental_app?sslmode=require
   postgresql://USER:PWD@ep-XXX-pooler.ap-south-1.aws.neon.tech/golden_db?sslmode=require
   ```

### 1.2 Vercel
1. Go to **vercel.com** → Sign in with GitHub.
2. Don't import the repo yet — we'll do that in Phase 3.

### 1.3 GitHub repo
If the project isn't on GitHub yet:
```bash
cd ~/Documents/Fundamental
gh repo create fundamental --private --source=. --remote=origin --push
```

---

## Phase 2 — migrate data to Neon (10 min)

### 2.1 Set the connection strings
```bash
export NEON_APP_URL='postgresql://USER:PWD@ep-XXX-pooler.ap-south-1.aws.neon.tech/fundamental_app?sslmode=require'
export NEON_GOLDEN_URL='postgresql://USER:PWD@ep-XXX-pooler.ap-south-1.aws.neon.tech/golden_db?sslmode=require'
```

### 2.2 Run the migration
```bash
cd ~/Documents/Fundamental
./scripts/migrate-nifty50-to-neon.sh
```

Watch for `✓ migration complete.` at the end. Expect ~5 min runtime.

### 2.3 Verify counts on Neon
The script prints a verification summary. Sanity-check the numbers:
- `universe (Nifty50)`: 51
- `scores`: ~150 (51 stocks × number of snapshots)
- `cluster (refs)`: 42
- `price_rows`: ~295,000 across 51 symbols

---

## Phase 3 — deploy web app to Vercel (10 min)

### 3.1 Import repo
Vercel dashboard → **Add New Project** → import the GitHub repo.

### 3.2 Critical settings
| Field | Value |
|---|---|
| Framework Preset | Next.js (auto) |
| **Root Directory** | **`web`** ← MUST set this; the app isn't at repo root |
| Build Command | (default) |
| Output Directory | (default) |
| Install Command | (default) |
| Region | **bom1 (Mumbai)** ← Project Settings → Functions Region (Hobby tier picks one default; Pro lets you pin) |

### 3.3 Environment variables
Project Settings → **Environment Variables** → add for **all three** environments (Production, Preview, Development):

| Key | Value |
|---|---|
| `APP_DB_URL` | (your `$NEON_APP_URL`) |
| `GOLDEN_DB_URL` | (your `$NEON_GOLDEN_URL`) |

### 3.4 Deploy
Click **Deploy**. First build takes ~2-3 min.

### 3.5 Smoke test
Visit `*.vercel.app` URL. Verify:
- ✅ Landing page renders
- ✅ `/discover` shows 51 stocks (Nifty 50 + Tata Motors variants)
- ✅ `/stock/RELIANCE` loads with price chart
- ✅ Price chart range buttons work (1M, 1Y, ALL)
- ✅ `/clusters` heat map renders (some clusters will be empty — expected for Nifty 50)
- ✅ `/feed` shows score deltas

If any page 500s, check Vercel → Deployments → Runtime Logs for the connection string error or query error.

---

## Phase 4 — domain (optional, 10 min)

### 4.1 Buy at Cloudflare
[Cloudflare Registrar](https://dash.cloudflare.com/?to=/:account/domains/register) → at-cost pricing (`.in` ~₹800/yr, `.com` ~$10/yr).

### 4.2 Point DNS to Vercel
1. Vercel → Project → Settings → **Domains** → Add your domain
2. Vercel shows the CNAME target
3. In Cloudflare DNS dashboard, add:
   - Type: CNAME
   - Name: `@` (or `www`)
   - Target: (Vercel's value)
   - Proxy status: **DNS only** (gray cloud) ← Vercel handles SSL
4. Wait 1-5 min. Vercel auto-issues HTTPS.

You can ship without a custom domain on day 1 and add it later. The `*.vercel.app` URL works fine for soft-launch.

---

## Phase 5 — weekly workflow (forever)

Once live, your Friday routine becomes:

```bash
cd ~/Documents/Fundamental
./snap                                  # 5 min: scores everything locally
./scripts/sync-neon.sh                  # 1 min: pushes Nifty 50 deltas to Neon
```

Optionally, chain them:
```bash
# Add to ~/.zshrc or run manually:
./snap && ./scripts/sync-neon.sh && echo "✓ Friday update live"
```

The shell-startup nag in `~/.zshrc` continues to warn you on day 8 of staleness.

---

## Phase 6 — monitoring (15 min, free)

### 6.1 Sentry (error tracking)
```bash
cd web
npx @sentry/wizard@latest -i nextjs
```
Walks through setup. Free tier covers 5K errors/month.

### 6.2 UptimeRobot (uptime ping)
1. Sign up at uptimerobot.com (free)
2. Add monitor: HTTP(s), URL = your-domain, interval = 5 min
3. Add a second monitor for `/discover` (catches DB failures specifically)
4. Alert via email or Discord webhook

---

## Phase 7 — backups (5 min, do this on day 1)

The local DB stays as your master, but back up Neon weekly anyway:

```bash
cat > ~/Documents/Fundamental/backup-neon <<'BASH'
#!/usr/bin/env bash
set -eo pipefail
DIR=~/Backups/Fundamental-Neon
STAMP=$(date +%Y-%m-%d)
mkdir -p "$DIR"
pg_dump "$NEON_APP_URL"    --no-owner --no-acl -Fc -f "$DIR/app_$STAMP.dump"
pg_dump "$NEON_GOLDEN_URL" --no-owner --no-acl -Fc -f "$DIR/golden_$STAMP.dump"
ls -1t "$DIR"/app_*.dump    | tail -n +9 | xargs -I{} rm -f {} || true
ls -1t "$DIR"/golden_*.dump | tail -n +9 | xargs -I{} rm -f {} || true
echo "✓ Neon backup → $DIR"
BASH
chmod +x ~/Documents/Fundamental/backup-neon
```

Then Neon's 7-day PITR + your local pg_dumps + iCloud sync = three layers of redundancy.

---

## When to scale up to full universe

Triggers — any one of these tells you it's time:

1. **Real users asking for stocks not in Nifty 50** (you'll see the search bounces in analytics)
2. **`/clusters` heat map looks too sparse** (most clusters have 0-2 stocks)
3. **You're confident the platform is stable**, no more weekly UI changes

Migration path:
1. Drop the `is_nifty50` filter from `migrate-nifty50-to-neon.sh` (one-line edit) — or write a `migrate-full-to-neon.sh`
2. Possibly bump Neon to Launch tier (~$15-30/mo for the size)
3. Run the full migration (~15 min)
4. Update `sync-neon.sh` to also drop the filter

---

## Pre-flight checklist (print this)

### Phase 1 — accounts
- [ ] Neon project created in **AWS Mumbai**
- [ ] Both DBs (`fundamental_app` + `golden_db`) exist on Neon
- [ ] Pooled connection strings copied
- [ ] Vercel account created (no project yet)
- [ ] GitHub repo exists, code pushed

### Phase 2 — data migration
- [ ] `NEON_APP_URL` and `NEON_GOLDEN_URL` exported in shell
- [ ] `./scripts/migrate-nifty50-to-neon.sh` ran clean to `✓ migration complete.`
- [ ] Verification counts look right (51 universe, ~150 scores, ~295K prices)

### Phase 3 — Vercel deploy
- [ ] Vercel project imported, **Root Directory = `web`**
- [ ] `APP_DB_URL` + `GOLDEN_DB_URL` set in env vars (Production)
- [ ] First deploy succeeded
- [ ] `*.vercel.app` URL serves landing page
- [ ] `/discover` shows 51 stocks
- [ ] `/stock/RELIANCE` renders with chart + 4-card grid

### Phase 4-7 — polish
- [ ] Custom domain (optional)
- [ ] Sentry installed
- [ ] UptimeRobot monitor pinging
- [ ] `backup-neon` script created + first backup taken

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `psql: connection refused` during migration | Verify Neon connection string; use the **pooled** URL (`-pooler`) |
| Migration script stops on `permission denied` | `chmod +x scripts/*.sh` |
| Vercel build: "Module not found" | Root Directory not set to `web` |
| Page 500s in production | Vercel → Deployments → Runtime Logs → look for "ECONNREFUSED" or schema errors |
| Pages slow on first load (~3-5s) | Neon's compute scales from zero on Free tier; first request wakes it. Use pooled URL. Cache improves things. |
| `/clusters` shows mostly empty cells | Expected — Nifty 50 only covers ~25 of 41 clusters |

---

*Last updated: 2026-05-10*
