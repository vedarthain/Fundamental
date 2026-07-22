import type { Metadata } from "next";
import { loadLatestMomentum } from "@/lib/momentum";
import MomentumClient from "./MomentumClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Momentum Radar — EquityRoots",
  description:
    "Stocks igniting today: a big up-day on abnormal volume breaking a fresh high — each cross-checked against its news catalyst and fundamental score so pumps stand out.",
};

// /tools/momentum — the daily volume-ignition scanner. Reads the cron-built
// app.momentum_signal cache (post-close). Each row is a stock that fired the
// ignition trigger; the catalyst headline + fundamental score sit alongside so
// a blank catalyst / weak score is an eyeball flag, never an auto-drop.
export default async function MomentumPage() {
  const { snapDate, signals } = await loadLatestMomentum();
  return <MomentumClient snapDate={snapDate} signals={signals} />;
}
