import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import { cachedSectorClusterTree, cachedClusterItems } from "@/lib/clusterVerdicts";
import { CallsClient } from "./CallsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Calls Desk & Verdicts — Admin",
  robots: { index: false, follow: false },
};

export default async function AdminCallsPage() {
  if (!(await isAdminRequest())) redirect("/");

  const verdictSectors = await cachedSectorClusterTree();
  const verdictInitialClusterId = verdictSectors[0]?.clusters[0]?.clusterId ?? null;
  const verdictInitialItems = verdictInitialClusterId
    ? await cachedClusterItems(verdictInitialClusterId)
    : [];

  return (
    <main className="w-full max-w-full overflow-hidden px-2.5 sm:px-4 py-2 sm:py-2.5">
      <CallsClient
        verdictSectors={verdictSectors}
        verdictInitialClusterId={verdictInitialClusterId}
        verdictInitialItems={verdictInitialItems}
      />
    </main>
  );
}
