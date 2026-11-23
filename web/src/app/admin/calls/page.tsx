import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import { cachedSectorClusterTree, cachedClusterItems } from "@/lib/clusterVerdicts";
import { getCachedCallsPayload } from "@/app/api/admin/calls/route";
import { CallsClient } from "./CallsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Calls Desk & Verdicts — Admin",
  robots: { index: false, follow: false },
};

export default async function AdminCallsPage() {
  if (!(await isAdminRequest())) redirect("/");

  const [verdictSectors, initialCalls] = await Promise.all([
    cachedSectorClusterTree().catch(() => []),
    getCachedCallsPayload(null, false).catch(() => null),
  ]);

  const verdictInitialClusterId = verdictSectors[0]?.clusters[0]?.clusterId ?? null;
  const verdictInitialItems = verdictInitialClusterId
    ? await cachedClusterItems(verdictInitialClusterId).catch(() => [])
    : [];

  return (
    <main className="w-full max-w-full overflow-hidden px-2.5 sm:px-4 py-2 sm:py-2.5">
      <CallsClient
        initialData={initialCalls}
        verdictSectors={verdictSectors}
        verdictInitialClusterId={verdictInitialClusterId}
        verdictInitialItems={verdictInitialItems}
      />
    </main>
  );
}
