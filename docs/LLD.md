# EquityRoots — Low-Level Design

Insight-first NSE stock-scoring & narrative web app. Next.js (App Router) on
Vercel + Postgres on Neon, fed by scheduled Python ETL that reads a read-only
`golden_db` and several free/cheap external APIs.

All diagrams are [Mermaid](https://mermaid.live) — they render on GitHub, VS
Code, and most Markdown tools.

---

## 1. System architecture & data flow

```mermaid
flowchart TB
    subgraph SRC["External data sources"]
        GOLD[("golden_db<br/>read-only Postgres<br/>fundamentals + history")]
        UPSTOX["Upstox API<br/>intraday LTP + indices"]
        BSE["BSE API<br/>scrip master · announcements · CA fallback"]
        IAPI["indianapi.in<br/>corporate actions (Hobby plan)"]
        RSS["Broadcaster RSS<br/>ET · LiveMint · BusinessLine"]
    end

    subgraph SCHED["Schedulers"]
        GHA["GitHub Actions<br/>heavy/periodic jobs"]
        CRONORG["cron-job.org<br/>high-freq intraday pingers"]
    end

    subgraph ETL["Python ETL  (scripts/ + etl/src/fundamental_etl)"]
        FETCH["fetch-* / refresh-* scripts"]
        SCORE["scoring: scorer · scorecards<br/>clusters: rules · assigner"]
        SNAP["build-market-snapshot"]
    end

    NEON[("Neon Postgres — schema app.*<br/>universe · scores · clusters ·<br/>fundamentals · CA · announcements · news")]

    subgraph WEB["Next.js App Router (Vercel)"]
        RSC["Server Components<br/>(ISR + unstable_cache)"]
        API["Route Handlers /api/*"]
        REVAL["/api/revalidate"]
    end

    USER(["Browser / mobile"])

    GOLD --> FETCH
    UPSTOX --> FETCH
    BSE --> FETCH
    IAPI --> FETCH
    RSS --> FETCH
    GHA --> FETCH
    GHA --> SCORE
    GHA --> SNAP
    CRONORG --> API

    FETCH --> NEON
    SCORE --> NEON
    SNAP --> NEON

    NEON --> RSC
    NEON --> API
    RSC --> USER
    API --> USER
    GHA -. "purge cache after write" .-> REVAL
    REVAL -. "revalidateTag / Path" .-> RSC
```

---

## 2. Database ERD (core `app.*` tables)

```mermaid
erDiagram
    universe ||--o{ scores : "scored as"
    universe ||--o{ cluster_assignment : "assigned to"
    universe ||--o{ fundamentals_quarterly : has
    universe ||--o{ fundamentals_annual : has
    universe ||--o{ corporate_action : has
    universe ||--o{ corporate_action_fetch : "fetch marker"
    universe ||--o{ announcement : has
    universe ||--o{ news_stock : "tagged in"
    universe ||--o{ shareholding_pattern : has
    universe ||--o{ stock_intraday : ticks
    universe ||--o{ user_watchlist : "watched by"
    cluster ||--o{ cluster_assignment : groups
    cluster ||--o{ scores : "ranked within"
    cluster ||--o{ cluster_scorecard : "weights"
    meta_cluster ||--o{ cluster : contains
    news ||--o{ news_stock : "mentions"
    users ||--o{ user_watchlist : owns

    universe {
        text symbol PK
        text company_name
        text isin
        text maturity_tier
        bool is_active
        bool is_nifty50
        bool is_nifty500
    }
    scores {
        text symbol PK, FK
        date snapshot_date PK
        int  cluster_id FK
        num  quality_pct
        num  valuation_pct
        num  momentum_pct
        num  composite_pct
        json quality_components
    }
    cluster {
        int  id PK
        text name
        int  meta_cluster_id FK
    }
    cluster_assignment {
        text symbol PK, FK
        int  cluster_id FK
        text method
    }
    fundamentals_quarterly {
        text symbol PK, FK
        date period_end PK
        num  sales
        num  operating_profit
        num  profit_before_tax
        num  tax
        num  net_profit
    }
    corporate_action {
        text symbol PK, FK
        date ex_date PK
        text purpose PK
        text action_type
        num  amount
        text source
    }
    corporate_action_fetch {
        text symbol PK, FK
        timestamptz fetched_at
    }
    announcement {
        text id PK
        text symbol FK
        text title
        text category
        timestamptz published_at
        text pdf_url
    }
    news {
        text id PK
        text source
        text title
        text url
        timestamptz published_at
    }
    news_stock {
        text news_id PK, FK
        text symbol PK, FK
    }
```

---

## 3. Scheduled jobs (ETL cadence)

| Workflow | Cron (UTC) | IST | Script → table |
|---|---|---|---|
| `refresh-ltp` | `0 13 * * 1-5` | 18:30 wkdays | `refresh-ltp.py` → prices on `universe`/snapshot |
| `weekly-snapshot` | `0 13 * * 6` | Sat 18:30 | scoring pipeline → `scores` (append-only snapshot) |
| `refresh-news` | `0 2-17 * * *` | hourly 07:30–22:30 | `fetch-news.py` → `news`, `news_stock` |
| `refresh-announcements` | `0 22 * * *` | daily 03:30 | `fetch-announcements.py` → `announcement` |
| `refresh-corporate-actions` | `30 4 1 * *` | monthly 10:00 | `fetch-corporate-actions-iapi.py` → `corporate_action` |
| `refresh-constituents` | `0 4 * * 0` | Sun 09:30 | `fetch-index-constituents.py` → `index_constituent` |
| `freshness-check` | `30 */12 * * *` | every 12h | `check-freshness.py` (monitoring) |
| intraday pingers | cron-job.org (1–5 min) | market hours | `/api/cron/intraday-equity` · `/api/cron/intraday-index` |

```mermaid
flowchart LR
    subgraph DAILY["Daily / weekday"]
        LTP["refresh-ltp<br/>prices"]
        NEWS["refresh-news<br/>hourly"]
        ANN["refresh-announcements<br/>BSE, daily"]
    end
    subgraph WEEKLY["Weekly"]
        SNAP["weekly-snapshot<br/>→ scores"]
        CONST["refresh-constituents"]
    end
    subgraph MONTHLY["Monthly"]
        CA["corporate-actions<br/>indianapi, resumable"]
    end
    subgraph INTRADAY["Intraday (cron-job.org)"]
        EQ["/api/cron/intraday-equity"]
        IX["/api/cron/intraday-index"]
    end
    DAILY & WEEKLY & MONTHLY & INTRADAY --> NEON[("Neon app.*")]
    NEON --> REVAL["/api/revalidate"]
```

---

## 4. Scoring pipeline (weekly snapshot)

```mermaid
flowchart TD
    A["golden_db fundamentals +<br/>Screener scrape"] --> B["fundamentals_quarterly / _annual"]
    B --> C["clusters/rules + assigner<br/>→ cluster_assignment"]
    C --> D["scoring/scorecards<br/>per-cluster Q/V/M weights"]
    D --> E["scoring/scorer<br/>percentile within cluster"]
    E --> F["scores (snapshot_date)<br/>quality/valuation/momentum/composite_pct"]
    F --> G["cluster_composite_cache +<br/>cluster_stocks_panel_cache"]
    G --> H["/sectors, /stock, /industry pages"]
```

> Scoring is **peer-relative**: each stock is percentiled within its cluster
> (46 industry peer groups), not the whole market. `scores` is append-only per
> `snapshot_date` so history is auditable.

---

## 5. Stock page component tree

```mermaid
flowchart TD
    PAGE["stock/[symbol]/page.tsx<br/>(server: loadStock + loadPersistence)"]
    PAGE --> HDR["Header: name (.NS stripped) · NSE tag ·<br/>price · ResultFlashChip · WatchlistButton"]
    PAGE --> TABS["StockPageTabs (client)"]
    TABS --> T1["Latest result → LatestResultCard"]
    TABS --> T2["About → BusinessVisual · AboutCard · PriceChartCard · StockNewsCard"]
    TABS --> T3["Strengths & gaps → StrengthBars · PillarTabs"]
    TABS --> T4["Trend → TrendSection / TrendCommentary"]
    TABS --> T5["The Numbers → fundamentals tables"]
    TABS --> T6["Corporate actions → StockActionsTabs (client)"]
    T6 --> SA["AnnouncementsCard  (app.announcement)"]
    T6 --> SC["CorporateActionsCard  (app.corporate_action)"]
```

---

## 6. Search + caching/request lifecycle

```mermaid
sequenceDiagram
    participant U as User
    participant SS as StockSearch (client)
    participant API as /api/search
    participant DB as Neon app.universe

    U->>SS: types "wipro"
    SS->>SS: debounce 130ms + AbortController<br/>(cancels superseded requests)
    SS->>API: GET /api/search?q=wipro
    API->>DB: symbol ILIKE 'wipro%' OR name ILIKE '%wipro%'
    DB-->>API: ranked hits (prefix first, shortest symbol)
    API-->>SS: { hits }  (route revalidate=3600)
    SS-->>U: dropdown → /stock/WIPRO

    note over API,DB: Pages use ISR (export const revalidate)<br/>+ unstable_cache(tags). ETL POSTs<br/>/api/revalidate to purge after writes.
```

**Cache layers**
- **ISR page cache** — `export const revalidate`: stock page 6h, `/news` 5min, `/api/search` 1h.
- **`unstable_cache(tags)`** — tagged data (`sectors`, `panel-cache`, `market`, `snapshot`); busted via `revalidateTag`.
- **`/api/revalidate`** — bearer-token (`REVALIDATE_TOKEN`) or admin; accepts `{tags, paths}` for on-demand purges after ETL writes.

---

## 7. Resumable sweep (corporate actions & announcements)

Non-trivial because the full ~2,160-symbol sweeps are slow (API rate limits /
latency) and would otherwise restart at "A" every run and never finish.

```mermaid
flowchart TD
    START["workflow run<br/>(--max-minutes budget)"] --> ORDER["SELECT symbols<br/>LEFT JOIN *_fetch<br/>ORDER BY fetched_at ASC NULLS FIRST"]
    ORDER --> LOOP{"for each symbol<br/>within time budget"}
    LOOP -->|fetch| GET["GET source API<br/>(adaptive throttle ≥1 req/s)"]
    GET -->|429| STOP["stop, partial saved"]
    GET --> WRITE["atomic per-symbol replace<br/>+ upsert *_fetch marker"]
    WRITE --> COMMIT["commit (incremental)"]
    COMMIT --> LOOP
    LOOP -->|budget hit| EXIT["clean exit (exit 0)<br/>resumes next run"]
    LOOP -->|done| DONE["Done — N rows"]
```

> The `*_fetch` marker tables (`corporate_action_fetch`) record *attempt* time
> per symbol independent of whether rows resulted, so least-recently-fetched
> ordering advances past empty-history stocks and re-runs always make progress.

---

## Tech stack summary

| Layer | Tech |
|---|---|
| Frontend | Next.js App Router, React Server Components, Tailwind |
| Hosting | Vercel (web) + GitHub Actions (ETL) + cron-job.org (intraday) |
| Database | Neon Postgres (`app.*`), read-only `golden_db` source |
| ETL | Python (`scripts/`, `etl/src/fundamental_etl`), `psycopg` |
| Auth | cookie session + bcrypt; admin via `ADMIN_EMAILS` |
| External APIs | Upstox, BSE, indianapi.in, broadcaster RSS |
```
