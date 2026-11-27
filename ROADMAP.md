# EquityRoots Feature & Improvement Notepad (Roadmap)

Tracked 1-by-1 checklist of website improvements and new features across all pages.

---

## Priority Top 5 (Highest ROI)
- [x] **1. Email / Push Delivery for `/tools/alerts`** — Connect triggered `app.price_alert_events` to Resend (`send-alert.py` / Next.js Resend helper) so alerts notify automatically.
- [ ] **2. Saved Screens + CSV Export on `/tools/screener`** — Persist filter combinations (localStorage or DB) with 1-click recall and CSV export.
- [ ] **3. Portfolio Tax-Harvesting (STCG vs LTCG)** — Use FIFO lots & `bought_on` dates in `/portfolio` to classify `< 12m` (STCG) vs `>= 12m` (LTCG) and highlight lots crossing 12m in the next 30 days.
- [ ] **4. Moat Card + Peer Mini-Strip + 50/200 DMA Toggle on `/stock/[symbol]`** — Surface read-only `app.company_moat` summary on About tab, show top 3 cluster peers with link to Peer Comparison, and add 50/200 DMA + event pins on `PriceChart`.
- [ ] **5. "My Stocks Only" Filter on `/news` & `Results Corner`** — Filter news and quarterly results to just portfolio holdings + watchlist.

---

## Concall Intelligence Suite (Modal GPU — Better than concall.in)
> **Compliance boundary**: Public/user-facing concall digests, tone shifts, and Guidance-vs-Actuals stay strictly **factual/informational** (no BUY/SELL/Target Price advice). Any verdict integration remains **admin-only**.
- [x] **Phase 1 — DB & Modal PDF Summarizer**: Create `app.concall_summary` migration + Modal **`Qwen2.5-32B-Instruct-AWQ` (L40S) / `72B-AWQ` (A100)** endpoint (`temp=0.0`) with **quote-first JSON + programmatic substring verification** against PDF text (anti-hallucination); process existing transcripts in `app.announcement` (Portfolio + Watchlist + Nifty 500 first).
- [x] **Phase 1 — Stock Page & Results Corner UI**: Show **Latest Concall Digest** card (Tone, Guidance, Capex, Margins, Risks, Top Q&A) on `/stock/[symbol]` (`Latest result` tab) and `"Concall"` badge/drawer in `Results Corner`.
- [ ] **Phase 2 — Quarter-over-Quarter Tone & Guidance Diff**: Compare management tone, capex timelines, and guidance across Q-2 → Q-1 → Q0.
- [ ] **Phase 2 — Guidance vs. Actuals Credibility Check**: Cross-check past concall guidance against delivered `fundamentals_quarterly` numbers.
- [ ] **Phase 3 — Same-Day Audio/Video via Modal Whisper**: Transcribe BSE *"Audio/Video Recording"* filings & YouTube IR links via `faster-whisper` on Modal within hours of the call (days before PDFs land).
- [ ] **Phase 3 — Cross-Market Concall Search + Q/V/M Filter**: Search keywords across all concalls (e.g. *"order book"*, *"data center"*) combined with Quality/Valuation/Momentum filters.
- [ ] **Admin-Only — Feed Concalls into Internal Verdicts**: Let `ollama-verdict.py` (admin-only) read `app.concall_summary` for your private research.

---

## Site-Wide Improvements
- [ ] **URL-Synced Tabs & Deep Links** — Sync active tab state to `?tab=...` in `StockPageTabs.tsx` and `PortfolioClient.tsx` so Back/Forward, refresh, and shared links preserve the tab.
- [ ] **Global Command Palette (`⌘K` / `Ctrl+K`)** — Jump to stocks, sectors, themes, tools, admin pages, or quick actions (`Add manual trade`, `Report Extractor`).
- [ ] **Unified Quick-Action Icons** — Consistent 1-click Watchlist (`★`), Price Alert (`🔔`), and Chart Popup (`📈`) across `/stocks`, `/tools/screener`, `/ideas`, and `/admin/reports`.

---

## Home & Dashboard
- [ ] **`/` (Landing)**: Add a live "Market Pulse" strip (top advancing/declining clusters this week + fresh quarterly results count).
- [ ] **`/dashboard`**: Add a **"Portfolio Catalysts"** tile (upcoming ex-dividends in 7 days, holdings near `buy_below`/`target_price`, triggered alerts).
- [ ] **`/dashboard`**: Align `BookZone` / `WinnersLosers` to show live Upstox intraday moves during market hours (matching `/portfolio`).

---

## Stock Research (`/stock/[symbol]`)
- [ ] **Technical + Event Overlays on `PriceChart`**: Toggle 50/200 DMA, quarterly result dates, and ex-dividend markers.
- [ ] **Public/Member Competitive Moat Card**: Render `app.company_moat` (`moat_strength`, `moat_type`, `moat_points`) on the `About` tab.
- [ ] **Peer Mini-Strip**: Show top 3 cluster peers on `Strengths & gaps` tab with a 1-click *"Compare in Peer Comparison →"* link.

---

## Portfolio & Watchlist
- [ ] **`/portfolio`**: STCG vs LTCG tax-harvesting estimator from FIFO lots.
- [ ] **`/portfolio`**: Concentration & rating guardrails on `Performance` tab (single-stock > 10%, sector > 25%, capital in `SELL`/`AVOID` holdings).
- [ ] **`/portfolio`**: CSV/Excel export on `Holdings`, `P&L`, and `Dividends` tabs.
- [ ] **`/watchlist`**: Direct Buy-Below Price Alert button per row + sort/filter by **"Distance to Target / Buy-Below %"**.

---

## Segments (`/sectors`, `/industries`, `/stocks`, `/indices`, `/themes`, `/ipo`)
- [ ] **`/sectors` & `/indices`**: 1W / 1M / 3M Sector Rotation & Breadth Heatmap (avg return + % stocks above 50/200 DMA).
- [ ] **`/ipo`**: Show Issue Price vs Current LTP (% listing gain) and Q/V/M score once onboarded.
- [ ] **`/stocks`**: Add Column Presets (*Valuation*, *Momentum*, *Dividends*, *Quality*) and saved filters.

---

## Ideas & News (`/ideas`, `/news`)
- [ ] **Results Corner (`/ideas?view=results`)**: Highlight YoY Sales & PAT acceleration / beat-miss badges directly in the list.
- [ ] **`/news` & `Results Corner`**: Add a **"My Stocks Only"** (portfolio + watchlist) filter toggle.

---

## Tools (`/tools/*`)
- [ ] **`/tools/screener`**: Saved screens + CSV export.
- [ ] **`/tools/scanner`**: Combined Fundamental (`Quality >= X`) + Technical (`Volume Ignition` / `Near 52W High`) scans.
- [ ] **`/tools/alerts`**: Automated Resend email / push delivery when `app.price_alert_events` triggers.
- [ ] **`/tools/peer-comparison`**: Normalized 1Y/3Y/5Y indexed-to-100 multi-line price performance comparison chart.

---

## Admin (`/admin/*`)
- [ ] **`/admin/reports`**: Fix pre-existing TS warning at line 676 (`ReportExtractorClient.tsx`) + conditional green row highlight when `LTP <= buy_below` and `action === "BUY"`.
- [ ] **`/admin/calls` & `/admin/verdicts`**: Verdict Accuracy / Hit-Rate Tracker (anchor price/date vs 3M/6M/12M forward returns by cluster & confidence).
- [ ] **`/admin/logs` & `/admin/insights`**: Interactive APM status cards at the top of `/admin/logs` parsed from `cron-monitor.py` (17 crons, DB latency, PM2 RSS, Verdict/Moat/Drift coverage).
