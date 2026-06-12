# EquityRoots — Application Stack

Insight-first NSE stock-scoring & narrative web app. Quick reference for the
technology, hosting, and data sources that make up EquityRoots.

---

## Hosting / infra

| Concern | What we use | Notes |
|---|---|---|
| Web app + API | **Vercel** (Hobby plan) | Next.js app + serverless API routes. Push to `main` → auto build/deploy. |
| Heavy ETL jobs | **GitHub Actions** | Scheduled Python jobs (scoring, fetchers). |
| Reliable triggers | **cron-job.org** | Intraday price pingers + news dispatch — avoids GitHub's load-shed cron. |
| Database hosting | **Neon** | Managed serverless Postgres. |
| CDN / DNS | Vercel's built-in | **No Cloudflare, no VPS** — nothing self-managed. |

Prod domain: **equityroots.in**

---

## Frontend

- **Framework:** Next.js (App Router) — React Server Components + selective client components
- **Language:** TypeScript
- **Styling:** Tailwind CSS + CSS variables (score bands, tab tints)
- **Icons:** lucide-react
- **Rendering / caching:** ISR (`export const revalidate`) + `unstable_cache(tags)`; on-demand purge via `/api/revalidate`

---

## Backend (web)

- **Runtime:** Next.js Route Handlers (`/api/*`) on Vercel serverless functions
- **Language:** **TypeScript**
- **Auth:** cookie session + bcrypt; admin via `er_admin` cookie / `ADMIN_EMAILS`; HMAC-signed Upstox OAuth state
- **DB access:** serverless Postgres driver (`sql` tagged template in `lib/db`)
- **Key routes:** `search`, `auth/*`, `watchlist`, `market/*`, `cron/*` (pingers + news dispatch), `revalidate`, `upstox/*`

---

## Database

- **Engine:** **PostgreSQL** (no NoSQL / other engines)
- **App DB:** Neon Postgres, schema `app.*` — `universe`, `scores`, `cluster*`,
  `fundamentals_*`, `corporate_action(_fetch)`, `announcement(_fetch)`,
  `news(_stock)`, `users`, `user_watchlist`, `upstox_session`, caches …
- **Source DB:** `golden_db` — read-only Postgres (fundamentals + price history)
- **Local dev:** local Postgres (`fundamental_app`, `golden_db`)
- **Migrations:** numbered SQL in `db/migrations/`, applied via `migrate.py` / Neon SQL editor
- **Local → prod sync:** `scripts/sync-neon.sh`
- **Cache:** Next.js ISR + `unstable_cache` (no Redis)

---

## ETL / data pipeline

- **Language:** **Python** (`psycopg`) — `scripts/` + `etl/src/fundamental_etl/`
- **Scoring engine:** cluster rules + assigner → per-cluster scorecards → percentile
  scorer. Peer-relative (46 industry clusters), append-only weekly snapshots.
- **Fetchers:** prices (Upstox), corporate actions (indianapi.in), announcements (BSE),
  news (broadcaster RSS), index constituents, FII/DII, NSE bhavcopy.

---

## Scheduled jobs

| Job | Cadence | Trigger |
|---|---|---|
| `refresh-ltp` (EOD prices) | weekday 18:30 IST | GitHub schedule |
| `weekly-snapshot` (scoring) | Sat 18:30 IST | GitHub schedule |
| `refresh-announcements` (BSE) | daily 03:30 IST | GitHub schedule |
| `refresh-corporate-actions` (indianapi) | monthly | GitHub schedule |
| `refresh-constituents` | Sun 09:30 IST | GitHub schedule |
| `freshness-check` (alerting) | every 12h | GitHub schedule |
| `refresh-news` | hourly 07:30–22:30 IST | **cron-job.org → workflow_dispatch** |
| intraday equity + index prices | 1–5 min, market hours | **cron-job.org → `/api/cron/*`** |

---

## External APIs / data sources

| Source | Used for | Notes |
|---|---|---|
| **Upstox** | live LTP + indices | daily OAuth token (manual reauth ~08:30 IST) |
| **BSE** (`api.bseindia.com`) | scrip master, announcements, CA fallback | free; reachable from CI |
| **indianapi.in** | corporate actions | Hobby plan (₹399/mo, 5k req) |
| **NSE archives** | EQUITY_L.csv (symbol→name→ISIN), bhavcopy | free static CSVs |
| **Broadcaster RSS** | market news | Economic Times, LiveMint, Hindu BusinessLine |

> NSE's *dynamic* API is avoided (403s behind anti-bot); we use BSE + NSE static archives instead.

---

## LLM / AI

- **None integrated.** No OpenAI / Anthropic / Gemini (or any model) calls anywhere
  in the codebase.
- All "narratives" (pillar narration, quarter interpretation, strengths/gaps text)
  are **deterministic, rule-based TypeScript/templating** generated from scores +
  fundamentals — not AI-generated.
- Adding an LLM (richer commentary, news summarization, Q&A) would be net-new.

---

## Dev / ops

- **VCS:** Git / GitHub — `vedarthain/Fundamental`
- **CI:** GitHub Actions `web-ci` (`tsc --noEmit` + ESLint) — **PR-only**
- **Deploy:** push to `main` → Vercel auto-build
- **Monitoring:** `freshness-check` emails on stale prices/scores

---

## One-line summary

> **Next.js/TypeScript on Vercel + Postgres on Neon, fed by Python ETL on GitHub
> Actions, with cron-job.org for reliable timing. No VPS, no Redis, no LLM.**
