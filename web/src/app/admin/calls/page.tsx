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
    <main className="mx-auto max-w-[1700px] px-2 sm:px-3 py-1.5 sm:py-2">
      <CallsClient />
    </main>
  );
}
