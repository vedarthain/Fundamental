import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isAdminRequest } from "@/lib/auth";
import { CallsClient } from "./CallsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Calls & Portfolio Sweep — Admin",
  robots: { index: false, follow: false },
};

export default async function AdminCallsPage() {
  if (!(await isAdminRequest())) redirect("/");

  return (
    <main className="w-full max-w-full overflow-hidden px-2.5 sm:px-4 py-2 sm:py-2.5">
      <CallsClient />
    </main>
  );
}
