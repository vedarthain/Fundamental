# Architecture & Stack

## Repo layout

```
Fundamental/
├── db/
│   └── migrations/        # SQL schema versions (numbered 0001_, 0002_, ...)
├── etl/                   # Python ETL + scoring engine
│   ├── pyproject.toml
│   └── src/fundamental_etl/
│       ├── config.py      # pydantic-settings (.env.local)
│       ├── db.py          # psycopg connections (golden + app)
│       ├── log.py         # structlog
│       ├── cli.py         # typer commands
│       ├── screener/      # Screener scraper + xlsx parser + DB writer
│       ├── clusters/      # (next) cluster assignment rules
│       ├── scoring/       # (next) metrics computation + percentile ranks
│       └── narratives/    # (Phase 3) Claude API narrative generation
├── web/                   # Next.js 15 app (App Router, RSC-first)
└── docs/                  # specs (this file, scoring-engine.md, sector-clusters.md)
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Database | Postgres (local for dev) | Already have it; rich SQL for percentile + window funcs |
| Read source | golden_db (read-only) | Existing price + indicator history |
| Write target | fundamental_app | All new tables under `app.` schema |
| ETL / scoring | Python 3.14 + venv + httpx + openpyxl + psycopg | Fast, simple, no orchestration needed at this scale |
| Web | Next.js 15 App Router + TypeScript | RSC for fast initial paint, route handlers for API |
| UI primitives | Tailwind CSS + shadcn/ui (Radix) | Accessible defaults, theme-controllable |
| Charts | Recharts (radar, line, sparkline) + custom SVG (heat map) | Works with React 19 / RSC |
| DB driver (web) | postgres.js | Smallest, fastest, no ORM ceremony for read-mostly workloads |
| LLM | Claude API (claude-sonnet-4-6 default) | Narrative engine, Phase 3 |
| Hosting (v1) | Local → later Vercel (web) + small VPS (ETL cron) | Defer infra decisions |

## Design system — "Claude" aesthetic

Goal: warm, editorial, calm. The opposite of every Bloomberg-clone fintech site.

### Color tokens (Tailwind config)

```ts
// web/tailwind.config.ts (excerpt)
colors: {
  // Surfaces
  paper:    '#faf9f5',  // page background
  ink:      '#191919',  // primary text
  muted:    '#5a584f',  // secondary text
  border:   '#e8e4d9',  // hairline dividers
  card:     '#ffffff',  // raised surfaces

  // Brand accent (Claude tan-orange family)
  accent: {
    50:  '#fbf2ed',
    100: '#f5e0d3',
    400: '#cc785c',     // primary accent
    600: '#a05a42',
  },

  // Semantic — score colors (heat map + badges)
  score: {
    excellent: '#3f7d4a',  // top quintile, muted forest green
    good:      '#7ea874',
    neutral:   '#c9b876',  // middle quintile, warm sand
    weak:      '#cc8a5c',
    poor:      '#a8543c',  // bottom quintile, burnt sienna (NOT alarm red)
  },
}
```

### Typography

```css
/* Headings: serif, generous tracking */
font-family: 'Source Serif 4', 'Tiempos Headline', Georgia, serif;
font-weight: 400; /* never bold serif headings */
letter-spacing: -0.015em;

/* Body, UI, numerics */
font-family: 'Inter', system-ui, sans-serif;

/* Tabular numbers always for prices/scores */
font-feature-settings: 'tnum', 'cv11';
```

### Layout principles

- Page max-width 1200px; comfortable reading column 680px
- Generous vertical rhythm: 24/32/48px section gaps
- Cards: 1px border (paper-darker), no shadow, 12px radius
- No icons-as-decoration; icons only when they add information
- Charts use 2 colors max + cluster median as a faint reference line

## Page map (v1)

| Route | Auth | Purpose |
|---|---|---|
| `/` | public | **Sector heat map** — the wedge. 41 cluster tiles, color-graded by avg composite_pct. Click → cluster detail. |
| `/cluster/[id]` | public | Cluster detail — table of stocks with their pillar scores, sortable |
| `/stock/[symbol]` | public | **Stock page** — radar chart, percentile badges, score history sparkline, fundamentals tables, narrative |
| `/screener` | public | Filter by pillar score range + cluster + market cap |
| `/feed` | public | **Score delta feed** — biggest movers this week, ranked |
| `/portfolio` | login | Portfolio X-Ray — paste holdings, get cluster concentration + weak links |
| `/watchlist` | login | Up to 3 watchlists in free tier |
| `/about` | public | The methodology — full transparency on scoring |

## Build sequence (the path from now to v1 launch)

1. **(in flight)** Backfill 2,163 stocks of fundamentals
2. Build cluster assignment + apply to universe
3. Build metrics computation (Quality, Valuation, Momentum) → `metrics_snapshot`
4. Build pillar + composite scoring (cluster percentiles) → `scores`
5. Validate scores manually against ~20 well-known stocks (HDFCBANK should score high on quality, IRFC should score high on momentum, etc.)
6. Scaffold Next.js app + design system
7. Build sector heat map (the wedge)
8. Build stock page (the depth)
9. Build screener
10. Build delta feed
11. Wire Claude narratives
12. Portfolio X-ray + watchlist (login)
13. Polish + launch
