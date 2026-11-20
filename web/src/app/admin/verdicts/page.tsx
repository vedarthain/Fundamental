/**
 * /admin/verdicts — Cluster-Wise Verdicts & Moats.
 *
 * Admin-gated. Left rail lists Sectors -> Clusters (all collapsed to sectors
 * on initial load). Clicking a cluster shows its Actionable, Watchlist, and
 * Hold/Avoid tables with LTP, Buy Below, Target, C/Q/V/M scores, latest
 * quarterly numbers, Moat ("what it's known for"), and Why.
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import { cachedSectorClusterTree, cachedClusterItems } from "@/lib/clusterVerdicts";
import PageHeader from "@/components/PageHeader";
import { ClusterVerdictsClient } from "./ClusterVerdictsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Cluster Verdicts — Admin",
  robots: { index: false, follow: false },
};

export default async function AdminVerdictsPage() {
  if (!(await isAdminRequest())) redirect("/");

  const sectors = await cachedSectorClusterTree();
  const initialClusterId = sectors[0]?.clusters[0]?.clusterId ?? null;
  const initialItems = initialClusterId ? await cachedClusterItems(initialClusterId) : [];

  return (
    <main className="mx-auto max-w-[1600px] px-3 sm:px-4 py-2 sm:py-3">
      <PageHeader
        eyebrow="Admin · Cluster Verdicts"
        title="Cluster-Wise Verdicts & Moats"
        subtitle="Scan Actionable, Watchlist, and Hold/Avoid candidates by sector and cluster."
      />
      <ClusterVerdictsClient
        sectors={sectors}
        initialClusterId={initialClusterId}
        initialItems={initialItems}
      />
    </main>
  );
}
