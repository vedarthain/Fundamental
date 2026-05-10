# Deployment — Vercel + Neon (the recommended path)

> Get the platform online in an afternoon for ~$20/mo. The web tier and both
> databases move to managed services; the ETL stays on your laptop where the
> Screener scraper has the safest network position.

---

## Architecture you're building

```
┌────────────────────────────────────────────────────────────────────┐
│  USERS (browsers, mostly India)                                    │
└──────────────────┬─────────────────────────────────────────────────┘
                   │ HTTPS · Cloudflare DNS → fundamental.in (or your domain)
                   ▼
┌────────────────────────────────────────────────────────────────────┐
│  VERCEL — Next.js 15 web app (web/)                                │
│  - ISR pages regenerate after each weekly snapshot                 │
│  - Edge cached, ap-south-1 region preferred                        │
│  - Free tier OR Pro $20/mo when you hit limits                     │
└──────────────────┬─────────────────────────────────────────────────┘
                   │ Postgres wire protocol (TLS)
                   ▼
┌────────────────────────────────────────────────────────────────────┐
│  NEON — managed Postgres 16, region: AWS Mumbai (ap-south-1)       │
│  - fundamental_app DB  (writable; ~500 MB)                         │
│  - golden_db DB        (price history; ~2-3 GB)                    │
│  - Pro $19/mo (10 GB storage, daily PITR, branching)               │
└──────────────────▲─────────────────────────────────────────────────┘
                   │ writes weekly via ./snap; metadata writes monthly
                   │
┌──────────────────┴─────────────────────────────────────────────────┐
│  YOUR LAPTOP — ETL (don't move this yet)                           │
│  - Screener cookies stay on your machine                           │
│  - Residential IP avoids cloud-IP scraping blocks                  │
│  - When you debug at 11pm, you debug interactively                 │
└────────────────────────────────────────────────────────────────────┘
```

---

## Cost summary

| Service | Tier | Monthly |
|---|---|---|
| Neon | Pro (10 GB, PITR, branching) | **$19** |
| Vercel | Hobby (free) → Pro when needed | **$0** → $20 |
| Cloudflare Registrar | domain | ~$1 (~$10/yr) |
| Sentry | Developer free | $0 |
| BetterStack / UptimeRobot | free tier | $0 |
| **Total at launch** | | **~$20/mo** |
| **Total when you outgrow free** | | **~$40/mo** |

---

## Prerequisites

You need accounts on:
- [Neon](https://neon.tech) (sign in with GitHub)
- [Vercel](https://vercel.com) (sign in with GitHub)
- [Cloudflare](https://cloudflare.com) (free, for DNS + registrar)
- A GitHub repo containing this project (private is fine; Vercel reads it)

You need installed:
- `psql` client (`brew install postgresql@16`)
- `git`, `gh` CLI (`brew install gh`)
- `pg_dump` (comes with `postgresql`)

---

## Step 1 — Create the Neon project (10 min)

### 1.1 Sign up + create project

1. Go to neon.tech, sign in with GitHub.
2. New project:
   - Name: `fundamental`
   - Region: **AWS Mumbai (ap-south-1)** ← critical for Indian users
   - Postgres version: **16**
   - Default DB name: `fundamental_app`
3. After creation, copy the connection string from the dashboard:
   ```
   postgresql://user:pwd@ep-xxx.ap-south-1.aws.neon.tech/fundamental_app?sslmode=require
   ```

### 1.2 Add the second database (golden_db)

1. In the Neon project dashboard → **Databases** → **New database**
2. Name: `golden_db`
3. Owner: same role
4. The connection string is identical except the trailing `/database` part:
   ```
   postgresql://user:pwd@ep-xxx.ap-south-1.aws.neon.tech/golden_db?sslmode=require
   ```

### 1.3 Upgrade to Pro

The free tier caps at 0.5 GB storage — too small for `golden_db`. Upgrade to **Pro ($19/mo)** before importing data. You get 10 GB + PITR + branching.

---

## Step 2 — Migrate local Postgres → Neon (20-40 min)

### 2.1 Dump local databases

```bash
cd ~/Documents/Fundamental

# Fundamental app DB (the writable one)
pg_dump fundamental_app \
  --no-owner --no-acl \
  --schema=app --schema=public \
  -Fc -f /tmp/fundamental_app.dump

# Golden DB (the read-only price history)
pg_dump golden_db \
  --no-owner --no-acl \
  --schema=golden --schema=public \
  -Fc -f /tmp/golden_db.dump

# Sanity check sizes
ls -lh /tmp/*.dump
```

`-Fc` is custom binary format (smaller + faster restore than plain SQL).
`--no-owner --no-acl` strips local Postgres roles that won't exist on Neon.

### 2.2 Restore into Neon

```bash
NEON_APP="postgresql://...neon.tech/fundamental_app?sslmode=require"
NEON_GOLDEN="postgresql://...neon.tech/golden_db?sslmode=require"

pg_restore --no-owner --no-acl --clean --if-exists \
  -d "$NEON_APP" /tmp/fundamental_app.dump

pg_restore --no-owner --no-acl --clean --if-exists \
  -d "$NEON_GOLDEN" /tmp/golden_db.dump
```

Expect ~5 min for `fundamental_app` (~500 MB) and ~15-20 min for `golden_db` (~2-3 GB).

### 2.3 Verify

```bash
# fundamental_app: should match local row count
psql "$NEON_APP" -c "SELECT COUNT(*) FROM app.universe WHERE is_active;"
psql "$NEON_APP" -c "SELECT COUNT(*) FROM app.scores;"

# golden_db: should match local
psql "$NEON_GOLDEN" -c "SELECT COUNT(*) FROM golden.price_history;"
```

If counts match local, you're good.

### 2.4 Test the connection from your laptop ETL

Update `etl/.env.local` (or wherever your settings live) with the Neon URLs:

```
APP_DB_URL=postgresql://...neon.tech/fundamental_app?sslmode=require
GOLDEN_DB_URL=postgresql://...neon.tech/golden_db?sslmode=require
```

Then sanity-check:

```bash
PY="etl/.venv/bin/python -m fundamental_etl.cli"
$PY fetch RELIANCE     # should hit Neon — check Neon dashboard for incoming connections
```

---

## Step 3 — Deploy the web app to Vercel (15 min)

### 3.1 Push the code to GitHub

If you haven't already:

```bash
cd ~/Documents/Fundamental
gh repo create fundamental --private --source=. --remote=origin --push
```

### 3.2 Import into Vercel

1. vercel.com → **Add New Project** → import the GitHub repo
2. **Important: set Root Directory to `web`** (the Next.js app lives there, not at repo root)
3. Framework preset: Next.js (auto-detected)
4. Build command: leave default (`npm run build`)
5. Output directory: leave default (`.next`)

### 3.3 Add environment variables

In Vercel → Project → Settings → Environment Variables, add:

| Key | Value | Environments |
|---|---|---|
| `APP_DB_URL` | (Neon fundamental_app URL) | Production + Preview + Dev |
| `GOLDEN_DB_URL` | (Neon golden_db URL) | Production + Preview + Dev |

Use Neon's **pooled** connection string for both (Neon dashboard offers it). Pooled connections survive Vercel's serverless cold starts better than direct ones.

### 3.4 Deploy

Click **Deploy**. First build takes ~2-3 minutes.

When it finishes, visit the auto-generated `*.vercel.app` URL and verify:
- Landing page renders
- `/discover` table populates
- A stock page (`/stock/RELIANCE`) loads with the price chart and 4 about-cards

---

## Step 4 — Custom domain via Cloudflare (10 min)

### 4.1 Buy the domain

Cloudflare Registrar (cloudflare.com → Domain Registration). At-cost pricing — typically `~₹800/yr` for `.in` or `~$10/yr` for `.com`. Avoid GoDaddy.

### 4.2 Point DNS to Vercel

In Vercel → Project → Settings → **Domains** → Add your domain. Vercel will give you DNS records.

In Cloudflare DNS dashboard:
- Add a CNAME record pointing to Vercel's target (Vercel shows the exact value)
- Set Proxy status to **DNS only** (gray cloud) — Vercel handles SSL itself; Cloudflare's proxy can interfere

Wait 1-5 minutes. Vercel auto-issues an SSL cert. The site is live on your domain.

---

## Step 5 — Configure ISR for weekly cadence

The platform changes weekly (after `./snap`). Edge-cache aggressively to keep Neon load minimal and pages fast.

Most pages already declare `export const revalidate = 1800;` (30 min). For a weekly platform, bump some pages higher:

| Page | Suggested revalidate |
|---|---|
| `/` (landing) | 86400 (24 hr) — mostly static |
| `/clusters`, `/cluster/[id]` | 3600 (1 hr) |
| `/stock/[symbol]` | 1800 (30 min) — current default fine |
| `/discover` | `force-dynamic` — already set; user filters |
| `/feed` | 1800 (30 min) |
| `/about` | 86400 (24 hr) |

After each `./snap`, you can optionally trigger a manual revalidation via Vercel's API to flush all cached pages. For now, the natural revalidation interval is fine.

---

## Step 6 — Backup strategy (do this on day 1)

**Your archive is the moat. You cannot lose it.** Two layers of redundancy:

### Layer 1: Neon's built-in PITR
Pro tier includes **7 days of point-in-time recovery**. Automatic. Nothing to configure.

### Layer 2: Weekly local pg_dump

Add this to your `./snap` workflow OR create a separate `./backup` script:

```bash
#!/usr/bin/env bash
# backup — pg_dump both Neon DBs to ~/Backups/Fundamental/
set -eo pipefail
source ~/Documents/Fundamental/etl/.env.local

DIR=~/Backups/Fundamental
STAMP=$(date +%Y-%m-%d)
mkdir -p "$DIR"

pg_dump "$APP_DB_URL"    --no-owner --no-acl -Fc -f "$DIR/fundamental_app_$STAMP.dump"
pg_dump "$GOLDEN_DB_URL" --no-owner --no-acl -Fc -f "$DIR/golden_db_$STAMP.dump"

# Keep only last 8 weeks of dumps
ls -1t "$DIR"/fundamental_app_*.dump | tail -n +9 | xargs -I{} rm -f {} || true
ls -1t "$DIR"/golden_db_*.dump       | tail -n +9 | xargs -I{} rm -f {} || true

echo "✓ backed up to $DIR (latest stamp: $STAMP)"
```

Then point iCloud Drive (or Backblaze) at `~/Backups/Fundamental/` so the dumps survive a laptop loss too.

**Test the restore once.** Spin up a Neon branch, restore last week's dump into it, verify counts. People who never test a restore have no backup.

---

## Step 7 — Monitoring (15 min, free)

### 7.1 Sentry — error tracking

```bash
cd web
npx @sentry/wizard@latest -i nextjs
```

Walks through setup, drops an `instrumentation.ts` and updates `next.config.ts`. Free tier covers 5k errors/month — plenty.

### 7.2 Uptime ping

[BetterStack](https://betterstack.com/uptime) or [UptimeRobot](https://uptimerobot.com) — free tier:
- Add monitor for `https://your-domain/` (every 3 min)
- Add monitor for `https://your-domain/discover` (catches Neon connection failures)
- Alert via email or Discord/Slack webhook

### 7.3 Vercel built-ins

In Vercel dashboard you get for free:
- Build logs
- Runtime logs (last 24 hr on Hobby; longer on Pro)
- Web Vitals
- Bandwidth + invocation usage

---

## Step 8 — Update the snap workflow

After Neon is live, your `./snap` already works as before — it just hits Neon instead of local Postgres. **The shell-startup nag in `~/.zshrc` continues to warn you on day 8 of staleness.**

The only conceptual change: every `./snap` now writes to a cloud database that the world reads from in real-time. So plan your Friday timing around when you want users to see fresh scores.

---

## What's NOT migrated and why

| Stays on laptop | Why |
|---|---|
| ETL Python code + venv | Iteration speed; debugging |
| Screener cookies | Cloud IPs get blocked more aggressively |
| `./snap` cron / manual run | Residential IP, interactive debugging |
| `app.screener_export_raw` xlsx blobs | These are inputs, regenerated each fetch — don't ship to Neon |

If you want to push xlsx blobs to cloud later for transparency/audit, use Cloudflare R2 (cheap egress).

---

## Common deployment issues + fixes

| Symptom | Cause | Fix |
|---|---|---|
| Vercel build fails: "Module not found" | Root Directory not set to `web/` | Project settings → Root Directory → `web` |
| Pages return 500 in production | DB env vars missing | Check Vercel env vars; ensure both `APP_DB_URL` and `GOLDEN_DB_URL` are set for **Production** |
| First page load is slow (~3-5s) | Cold start + Neon connection | Use Neon's **pooled** connection string; consider Neon "Always Active" if budget allows |
| pg_dump errors on local restore | Postgres version mismatch | Use `pg_dump`/`pg_restore` from same version as Neon (16) |
| "Too many connections" from Vercel | Each serverless invocation opens a new connection | Use pooled connection string; make sure `web/src/lib/db.ts` caches the pool on `globalThis` (it already does) |
| Domain shows Vercel "Invalid Configuration" | DNS not propagated | Wait 5-10 min; verify CNAME points to Vercel's exact target |

---

## Migration checklist (print this out)

- [ ] Neon project created, region = AWS Mumbai
- [ ] Both DBs (fundamental_app, golden_db) created on Neon Pro
- [ ] `pg_dump` of both DBs from local
- [ ] `pg_restore` to Neon for both
- [ ] Row counts match between local and Neon
- [ ] `etl/.env.local` updated to point to Neon URLs
- [ ] `./snap` runs successfully against Neon
- [ ] GitHub repo created, code pushed
- [ ] Vercel project created, Root Directory = `web/`
- [ ] Both env vars set in Vercel Production
- [ ] First Vercel deploy succeeds
- [ ] `*.vercel.app` URL serves the landing page
- [ ] `/discover` shows real data
- [ ] `/stock/RELIANCE` renders with price chart
- [ ] Domain bought + DNS pointed to Vercel
- [ ] HTTPS cert auto-issued
- [ ] Sentry installed
- [ ] Uptime monitor pinging the domain
- [ ] `./backup` script created + first dump taken
- [ ] iCloud / Backblaze syncing `~/Backups/Fundamental/`
- [ ] Tested a restore from a dump into a Neon branch

---

## When to upgrade what

| Trigger | Upgrade to | Cost delta |
|---|---|---|
| Vercel bandwidth exceeds 100 GB/mo | Vercel Pro | +$20/mo |
| Neon storage exceeds 10 GB | Neon Scale (custom) | +$30+/mo |
| Need user accounts | Add Clerk (free → $25/mo at scale) | +$0 → $25 |
| Accepting payments | Add Razorpay (per-transaction) | per-transaction |
| Screener starts blocking laptop IP | $5 Hetzner VPS + residential proxy | +$5-15/mo |

---

## Rollback plan

If anything goes wrong post-launch:

1. **Web only failing** → Vercel → Deployments → previous deployment → "Promote to Production"
2. **DB corrupted** → Neon dashboard → restore to point in time (PITR) — takes 1 click
3. **Total disaster** → revert `etl/.env.local` to local DB URLs, run `./snap` locally, restore Neon from your most recent local pg_dump

The platform is small enough that any one failure mode has a < 10 min recovery path.

---

*Last updated: 2026-05-10*
