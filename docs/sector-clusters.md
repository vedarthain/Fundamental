# Sector Cluster Taxonomy (v1)

The platform's central insight is **sector-relative scoring**. Comparing Reliance to Asian Paints
on ROE is meaningless; comparing Asian Paints to Berger Paints is the whole point.

NSE's raw `sector` (22 buckets) and `industry` (~80 buckets) are too coarse and too granular
respectively. We collapse to **~28 peer clusters** grouped under **8 meta-clusters**.

## Design rules

- **Min ~15 stocks per cluster** for stable percentile ranks (smaller clusters merged into nearest neighbour).
- **Group by economics, not name.** PSU vs private banks are split because their cost of funds, NPA cycles, and growth profiles differ. IT services large vs mid is split because client concentration, deal mix, and margin profiles diverge.
- **Some metrics swap by cluster** (see [scoring-engine.md](scoring-engine.md)) — e.g. P/B replaces P/E for banks, debt/equity is dropped for financials.
- The mapping is **rule-based** in v1 (deterministic from `sector` + `industry` + `market_cap_category`). We can layer manual overrides later for edge cases (e.g. ITC isn't really FMCG).

## Meta-clusters and clusters

| Meta-cluster | Cluster ID | Display Name | Source (sector, industry) | Approx N |
|---|---|---|---|---|
| Financials | bfsi_psu_banks | PSU Banks | Financial Services / Banks where market_cap_category large/mid AND name LIKE PSU list | ~12 |
| Financials | bfsi_pvt_banks | Private Banks | Financial Services / Banks (rest) | ~29 |
| Financials | bfsi_nbfc | NBFCs / Lenders | Financial Services / Finance | 148 |
| Financials | bfsi_insurance | Insurance | Financial Services / Insurance | 13 |
| Financials | bfsi_capmarkets | Capital Markets / AMCs / Brokers | Financial Services / Capital Markets | 49 |
| Financials | bfsi_fintech | Fintech | Financial Services / Financial Technology (Fintech) | 7 |
| Tech | it_services_large | IT Services — Large Cap | IT / IT-Software OR IT-Services WHERE market_cap_category=large_cap | ~10 |
| Tech | it_services_midsmall | IT Services — Mid/Small | IT / IT-Software OR IT-Services (rest) | ~89 |
| Tech | it_hardware | IT Hardware | IT / IT - Hardware | 10 |
| Tech | telecom | Telecom | Telecommunication / * | 23 |
| Healthcare | pharma | Pharmaceuticals | Healthcare / Pharmaceuticals & Biotechnology | 111 |
| Healthcare | health_services | Hospitals & Diagnostics | Healthcare / Healthcare Services | 35 |
| Healthcare | medtech | MedTech | Healthcare / Healthcare Equipment & Supplies | 6 |
| Consumer | fmcg_food_agri | Packaged Food & Agri | FMCG / Food Products + Agricultural Food | 106 |
| Consumer | fmcg_personal | Personal Care & Household | FMCG / Personal Products + Household Products | 19 |
| Consumer | fmcg_beverages | Beverages | FMCG / Beverages | 17 |
| Consumer | fmcg_diversified | Diversified FMCG | FMCG / Diversified FMCG + Cigarettes | 8 |
| Consumer | consumer_durables | Consumer Durables | Consumer Durables / * | 131 |
| Consumer | retail | Retail | Consumer Services / Retailing | 41 |
| Consumer | leisure_hospitality | Leisure & Hospitality | Consumer Services / Leisure Services + Other Consumer Services | 70 |
| Consumer | media_entertainment | Media & Entertainment | Media Entertainment & Publication / * | 45 |
| Industrials | cap_goods_industrial | Industrial Products & Manufacturing | Capital Goods / Industrial Products + Industrial Manufacturing | 255 |
| Industrials | cap_goods_electrical | Electrical Equipment | Capital Goods / Electrical Equipment | 58 |
| Industrials | defense_aero | Defense & Aerospace | Capital Goods / Aerospace & Defense | 24 |
| Industrials | auto_oem | Auto OEMs | Auto / Automobiles + Agricultural Commercial & Construction Vehicles | 25 |
| Industrials | auto_components | Auto Components | Auto / Auto Components | 97 |
| Industrials | services_commercial | Commercial Services | Services / Commercial Services & Supplies | 62 |
| Industrials | transport_logistics | Transport & Logistics | Services / Transport Services + Transport Infrastructure | 51 |
| Materials | chemicals_specialty | Specialty Chemicals | Chemicals / Chemicals & Petrochemicals | 119 |
| Materials | chemicals_agro | Agrochemicals & Fertilizers | Chemicals / Fertilizers & Agrochemicals | 40 |
| Materials | metals_ferrous | Ferrous Metals | Metals & Mining / Ferrous Metals | 20 |
| Materials | metals_nonferrous_mining | Non-Ferrous & Mining | Metals & Mining (rest) | 32 |
| Materials | cement | Cement | Construction Materials / Cement & Cement Products | 30 |
| Materials | paper_forest | Paper & Forest Products | Forest Materials / * | 23 |
| Materials | textiles | Textiles | Textiles / * | 117 |
| Real Estate & Infra | realty | Realty Developers | Realty / * | 65 |
| Real Estate & Infra | construction | Construction & EPC | Construction / * | 66 |
| Energy & Utilities | oil_refining | Oil & Refining | Oil Gas & Consumable Fuels / Petroleum Products + Oil + Consumable Fuels | 33 |
| Energy & Utilities | gas_distribution | Gas Distribution | Oil Gas & Consumable Fuels / Gas | 10 |
| Energy & Utilities | power | Power Generation | Power / * + Utilities / * | 38 |
| Diversified | diversified | Diversified | Diversified / * | 8 |

**Total: 41 clusters under 8 meta-clusters** (some smaller than the ~28 target — easier to merge later than split).

## Special cases for v1
- **PSU bank list** is hardcoded for the rule (SBIN, PNB, BOB, CANBK, BANKBARODA, IOB, INDIANB, UCOBANK, CENTRALBK, MAHABANK, BANKINDIA, UNIONBANK, J&KBANK).
- Stocks falling in `SERVICES` (uppercase NSE remnant) are mapped to the proper `Services` group.
- Anything that fails to map gets `cluster_id = 'unclassified'` and is excluded from cluster percentile calculations until manually assigned.
