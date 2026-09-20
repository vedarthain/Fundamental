/**
 * panelMeta — the sector / peer-group / listing columns the three signal
 * scanners (Igniting today, Trend Leaders, At Support) join in at read time.
 *
 * Each scanner stores its own signal rows in its own table (app.momentum_signal,
 * app.trend_leader_signal, app.support_floor_signal) and none of them carry the
 * classification or the listing fields. Rather than add four columns to three
 * tables and re-run three crons, all three join app.cluster_stocks_panel_cache
 * and app.universe on read. That query was already verbatim-identical in three
 * files; this is its one shape, so adding a fifth field is one edit and not
 * three-minus-the-one-you-forgot.
 */

/** Row shape of the read-time classification join. */
export type PanelMetaRow = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  /** NSE listing date. Alone it does NOT mean "IPO" — see components/IpoBadge.
   *  Kept for display copy only; the IPO/score gate reads first_bar_date. */
  listing_date: string | null;
  /** Earliest daily bar we hold. This — not listing_date — is the first signal
   *  the IPO test needs: an SME→mainboard migration resets listing_date while
   *  leaving years of bars behind. */
  first_bar_date: string | null;
  /** Years of annual financials scraped; the second signal the IPO test needs. */
  years_of_data: number | null;
};
