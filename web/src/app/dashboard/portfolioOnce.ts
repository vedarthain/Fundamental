/**
 * One portfolio read per request, shared by every tile that needs it.
 *
 * Two tiles now render from the same book (BookZone and ConcentrationZone), and
 * they stream independently — so without this they would each call
 * loadPortfolio(userId) and each pay for the holdings + reconciliation
 * queries. loadPortfolio's expensive tail (the golden hops and the cluster
 * aggregation) is already wrapped in unstable_cache inside lib/portfolio.ts,
 * but its head is not, and that head is the per-user part that cannot be.
 *
 * React's `cache()` is request-scoped, not a data cache: two awaits in the same
 * render share one promise, and nothing leaks between users or requests. That
 * is the property we want here — a shared Data Cache entry keyed by userId
 * would be a privacy bug waiting to happen.
 *
 * Any new tile that needs holdings must import THIS, not loadPortfolio.
 */
import { cache } from "react";
import { loadPortfolio } from "@/lib/portfolio";

export const getPortfolio = cache(loadPortfolio);
