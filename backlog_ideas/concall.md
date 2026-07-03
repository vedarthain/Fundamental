# EquityRoots Concall Intelligence — Product Requirement Document

**Version:** 1.0 (draft)
**Date:** May 2026
**Target launch:** Before July–August 2026 earnings season
**Module of:** EquityRoots (equityroots.in)

---

## 1. Executive Summary

A concall intelligence module inside EquityRoots that turns Indian quarterly earnings calls into three shareable visual cards — designed for Twitter-active retail stock pickers (FinTwit) to screenshot and share.

**Scope:** Top 500 NSE companies, last 4 quarters at launch.

**Incremental budget:** ~₹2,500/month average + ~₹20,000 one-time backfill. Year 1 total ~₹50,000.

**Only new vendor:** Anthropic API. Everything else reuses EquityRoots' existing stack (Vercel, Neon Postgres, GitHub Actions, Python ETL).

---

## 2. Vision & Objective

**Vision:** Become the trusted source for Indian concall intelligence.

**Objective:** Help retail stock pickers answer in 30 seconds:
> *"What's different about how this company's management is talking this quarter?"*

**How:** Three shareable visual cards per company, computed once when a new concall arrives, served from precomputed data.

---

## 3. Problem Statement

Every quarter, ~1,500 Indian listed companies host earnings concalls — the highest-signal, lowest-consumed content in equity research. Each is 30–50 pages, quarterly. Active investors can't keep up.

**Existing options and gaps:**
- **Screener, Tickertape** — numbers only, no interpretation of concalls.
- **Researchbytes, Trendlyne** — raw transcripts, no analysis.
- **Manual reading** — hours per company.

**Nobody interprets Indian concalls at scale for retail investors.** That is the gap.

---

## 4. Target Users

**Primary:** Twitter-active retail stock pickers in India who track 20–50 stocks and share insights as images.

**Secondary (post-launch):** Boutique fund analysts, finance creators, equity research desks (via future API tier).

---

## 5. Scope

| Item | v1 |
|---|---|
| Coverage | Top 500 NSE companies |
| History at launch | Last 4 quarters |
| History target (3 yr) | 12+ quarters |
| Language | English (Indian-English) |
| Geography | India, listed only |
| Volume | ~500 concalls/quarter; ~125/month average, ~500/month peak |

---

## 6. Core Features (v1)

### 6.1 The Three Visual Cards

**Card 1 — Guidance Tracker Grid**
- Rows: metrics (revenue growth, EBITDA margin, capex, volume growth).
- Columns: last 6 quarters.
- Cells: guided number + change arrow (up/flat/down).
- Aspect ratio: 16:9.
- Job: instantly see if management is raising or cutting guidance across metrics.

**Card 2 — Quote Cards**
- One punchy management quote per card.
- Speaker, role, quarter, source date on the card.
- Aspect ratio: 4:5 (Twitter/Instagram friendly).
- One-tap copy-as-image, watermarked.
- Job: the viral unit — designed to be tweeted.

**Card 3 — Said-vs-Did Tracker**
- Past guidance vs actual delivered results, per metric.
- Hit/miss visual + management track record percentage.
- Aspect ratio: 1:1.
- Job: management credibility scorecard — unique to EquityRoots.

### 6.2 Supporting Features

- Company page: `/company/[ticker]/concall`
- Quarter page: `/concall/[ticker]/[quarter]`
- OG image auto-renders top card on link share
- Watermark on every image: `equityroots.in | TICKER | Q# FY##`
- Cashtag redirect: `/concall/$RELIANCE` → `/concall/RELIANCE`
- No login required
- SEO-indexed pages

### 6.3 Integration with EquityRoots

- Concall data joins `app.universe` for ticker → sector → peer group.
- Sector pages can add a "this quarter's concall pulse" card (which peers turning bullish/bearish).
- Concall takeaways can feed News & Ideas section.
- "The Map" can add a concall-pulse overlay.

---

## 7. Non-Goals (Explicit)

- Not a stock screener (Screener wins).
- Not a financials dashboard (Tickertape wins).
- Not investment advice or recommendations (legal + brand risk).
- Not a chatbot or "ask AI" surface.
- Not raw transcript hosting (Researchbytes wins).
- Not paywalled in v1 (kills sharing + SEO).
- Not user-generated content or comments.

---

## 8. Design Principles

- **Doesn't look like AI:** terse, sourced, specific numbers, no platitudes, no hedging language ("may," "could potentially").
- **Visual-first:** prose is captions, not paragraphs. Max 2 sentences per block.
- **Every card is a tweet waiting to happen:** screenshot-ready, watermarked, self-contained.
- **Match EquityRoots visual language:** light background, card-based layouts, green/red semantics.
- **Mono font for numbers**, neutral sans for text.
- **Every fact sourced:** "From Q4 FY26 concall, 28 Apr 2026" under each claim.
- **Empty states honest:** "Only 1 concall available" rather than fabricated content.

---

## 9. Architecture

### 9.1 The Five Boxes

```
[Watcher] → [Fetcher] → [Extractor] → [Database] → [Website]
```

- **Watcher** — polls BSE/NSE/IR pages for new transcripts (GitHub Actions cron).
- **Fetcher** — downloads PDF, extracts clean text.
- **Extractor** — LLM pipeline (5 extractors) writes structured rows to DB.
- **Database** — Neon Postgres (structured) + FTS for search.
- **Website** — Next.js reads precomputed data only. No LLM at request time.

### 9.2 Extraction Pipeline

Five independent, versioned extractors — not one giant prompt:

| Extractor | Model | Purpose |
|---|---|---|
| Guidance | Claude Sonnet | Extract structured guidance rows |
| Said-vs-did matcher | Claude Sonnet | Join past guidance to current actuals |
| Tone scorer | Claude Sonnet | Language-pattern rubric scores |
| Quote extractor | Claude Haiku | Rank shareable quotes |
| Topic tagger | Claude Haiku | Classify Q&A topics |

Each has a typed output schema, independent versioning, and is idempotent.

### 9.3 Data Flow — One Concall End-to-End

```
BSE/NSE posts announcement
  → Watcher (GHA) detects, inserts row into concall.jobs
  → Fetcher (GHA) downloads PDF, parses to clean text, stores in Neon
  → Extractor (GHA) pulls ready jobs:
      - Run 5 extractors in parallel, each calls Anthropic API
      - Validate JSON against typed schema
      - Write rows to concall.guidance, concall.quotes, etc.
      - Tag rows with extractor_version
  → Enricher (GHA, daily) computes said-vs-did joins
  → ISR cache revalidated for that ticker
  → Distribute worker checks: interesting enough to auto-tweet?
```

**Latency target:** under 2 hours from transcript publication to live on site.

---

## 10. Tech Stack

### 10.1 Existing EquityRoots Stack (Reused)

| Layer | Tool |
|---|---|
| Frontend + API | Next.js on Vercel Hobby |
| App database | Neon Postgres (`app.*`) |
| Read-only source | `golden_db` Postgres |
| ETL / data layer | Python (`etl/src/`), `psycopg` |
| Scheduling | GitHub Actions + cron-job.org |
| Caching | Next.js ISR + `unstable_cache` |

### 10.2 New Additions

| Layer | Tool | Notes |
|---|---|---|
| DB schema | `concall.*` in existing Neon | Same instance, namespaced |
| ETL module | `etl/src/concall_etl/` | Existing Python pattern |
| Workflows | `.github/workflows/concall-*.yml` | Existing GHA pattern |
| LLM | Anthropic API (Sonnet + Haiku) | Only new vendor |
| Share images | `@vercel/og` | Existing Vercel feature |

### 10.3 What We Explicitly Skip in v1

- No Railway/Fly workers (GHA handles it).
- No Redis (Postgres advisory locks + ISR are enough).
- No queue service (Postgres `concall.jobs` table).
- No Cloudflare R2 (transcript text in Neon TEXT column).
- No Ollama, no NVIDIA Build, no pre-filter (marginal savings at Top 500 scope).
- No login, no auth.

---

## 11. Database Schema (`concall.*`)

Lives in same Neon instance as `app.*`. Joins to `app.universe` give ticker → sector → peer group.

```
concall.concalls          (id, ticker, quarter, fiscal_year, call_date,
                           transcript_url, transcript_text, raw_pdf_url, ...)
concall.guidance          (concall_id, metric, period, value, qualifier,
                           extractor_version, ...)
concall.quotes            (concall_id, speaker, role, text, topic, rank, ...)
concall.topics            (concall_id, topic, mention_count, sentiment_score, ...)
concall.tone_scores       (concall_id, hedging_score, forward_looking_score,
                           confidence_score, ...)
concall.actuals           (ticker, period, metric, value, source)
concall.said_vs_did       (ticker, guidance_id, actual_id, delta, hit_or_miss)
concall.jobs              (id, ticker, quarter, status, attempts, last_error,
                           model_version, ...)
concall.reviews           (concall_id, extractor, field, original_value,
                           corrected_value, reviewer, ...)
```

- `concall.jobs` = queue.
- `concall.reviews` = eval flywheel (every correction = labeled data).
- Every row tagged with `extractor_version` for safe reprocessing.

---

## 12. LLM Usage

### 12.1 Model Selection

Sonnet for accuracy-critical extractors, Haiku for pattern/classification tasks. One vendor.

### 12.2 Cost Controls

- Separate Anthropic API key for concall module.
- Hard cap: ₹5,000/month, email alert at 80%.
- Prompt caching on transcript (5 extractors hit same text → 90% cache discount).
- Batch API for non-urgent runs (50% discount).
- Haiku wherever Sonnet is overkill.

### 12.3 LLM Boundaries (Non-Negotiable)

- Never called at user-request time.
- Never invents numbers — extraction only.
- Never writes opinions ("buy"/"sell") — describes what management said.
- Never user-facing as chatbot.

---

## 13. Distribution Strategy

- **SEO long tail:** 500 company pages indexed by Google, each ranking for "[company] concall analysis."
- **Image shares:** watermarked card screenshots travel on Twitter/WhatsApp.
- **OG embeds:** tweeted links auto-render top card.
- **Auto-post pipeline:** daily during earnings, weekly recap thread.
- **Founding presence:** active Twitter account posting concall highlights during earnings season.

---

## 14. Monetization Roadmap

| Phase | Timing | Model |
|---|---|---|
| Phase 0 | Months 1–12 | Free. Build audience + data moat. |
| Phase 1 | Months 12–18 | ₹299/mo premium — full history, alerts, search, CSV export |
| Phase 2 | Months 18–24 | API tier — ₹10k–30k/mo for funds/creators |
| Phase 3 | Year 2+ | Sponsored posts, quarterly reports, white-label |

**Revenue target Year 3:** ₹8–12 lakh/month.

---

## 15. Moat (Compounds Quarterly)

1. **Proprietary structured concall database** — irreplaceable after 2+ years.
2. **Said-vs-did track records** per management team.
3. **FinTwit brand trust** — protected via human review queue.
4. **Eval set + quality flywheel** — corrections become labeled data.
5. **Distribution surface area** — indexed pages, embedded screenshots, backlinks.
6. **Indian domain depth** — micro-tuning for Indian-English financial vocabulary.
7. **EquityRoots integration** — peer-relative concall views nobody else can build.

---

## 16. Cost — Incremental Over EquityRoots

| Item | Monthly (₹) |
|---|---|
| Anthropic (earnings months) | 5,000 |
| Anthropic (off months) | 500 |
| Everything else | 0 |
| **Annualized average** | **~₹2,500/month** |

**One-time backfill (4 quarters × 500 cos):** ~₹20,000, spread over 2–3 months.

**Year 1 budget: ~₹50,000.**

---

## 17. Launch Timeline (8 Weeks)

| Week | Milestone |
|---|---|
| 1 | Manual exercise: hand-build guidance grid for 1 company in a spreadsheet |
| 2 | Transcript fetcher live for top 10 companies |
| 3 | Guidance extractor + human review UI |
| 4 | Guidance grid visual + image export |
| 5 | Said-vs-did matcher + visual |
| 6 | Quote extractor + quote cards |
| 7 | Scale to Top 200 companies, polish |
| 8 | Distribution live: Twitter auto-post, listicle page, launch |

**Post-launch:** expand from 200 → 500 companies over months 3–6.

---

## 18. Success Metrics (12 Months Post-Launch)

- 50k+ monthly active users on concall pages
- 5k+ Twitter followers
- 500+ company pages ranking in Google top 10
- Cited/screenshotted by 3+ FinTwit accounts with 50k+ followers
- 1,000+ card screenshots embedded in tweets/Substacks
- Extraction pipeline: <2 hours from transcript to live
- Extraction accuracy: 90%+ on eval set for top 100 companies

---

## 19. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Source HTML changes; scraping breaks | Health pings per watcher; fallback sources |
| Extraction errors damage credibility | Human review on top 100; public retraction policy |
| Big player (Zerodha, Tijori) enters | Stay niche until moat is wide; be uninteresting to attack |
| Founder burnout / pivot fatigue | Resist pivots — moats form only via consistency |
| Anthropic API outage | Extractor abstraction; fallback to GPT-4o |
| GHA free minutes exceeded | Move heavy workflows to Railway (~₹1,500/mo) |
| Neon free tier exceeded | Upgrade to Scale plan (~₹2,000/mo) |

---

## 20. What Might Change Later

| Trigger | Change to consider |
|---|---|
| Scope grows to full NSE | Add hosted open-model pre-filter (NVIDIA Build / Groq) |
| GHA minutes exceed 2,000/mo | Move to Railway/Fly small worker |
| Generated images need persistent caching | Add Cloudflare R2 |
| Open models match Sonnet on eval set | Migrate cheap extractors to hosted Llama |
| Volume >20,000 concalls/mo | Reconsider self-hosted LLM |

None of these are v1 concerns.

---

## 21. Open Decisions

- Backfill order: Top 200 first, then 200–500 (recommended).
- Concall section placement: tab on company page vs dedicated route (decide after mockups).
- Twitter account: new `@equityroots_calls` vs main `@equityroots` (TBD).
- First reference company for manual exercise: Polycab / Astral / your pick.

---

## 22. Two-Minute Pitch

Every quarter, 1,500 Indian listed companies hold earnings concalls — the highest-signal content in equity research, and almost nobody reads them. We turn each concall into three shareable visual cards: a guidance tracker showing what management promised, quote cards with the punchiest lines, and a said-vs-did scorecard showing how often each management team delivers.

Built inside EquityRoots, integrated with peer-relative sector views nobody else can build. Free for retail, ₹299/mo for power users, API for funds. Designed to be screenshot and tweeted.

The moat compounds quarterly — three years in, we have a structured database of Indian management credibility that's impossible to replicate.

---

*End of document.*
