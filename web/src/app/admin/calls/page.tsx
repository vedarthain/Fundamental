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
    <main
      className="mx-auto max-w-[1600px] px-3 sm:px-4 py-3 sm:py-4"
      style={{ zoom: 1.04 }}
    >
      <CallsClient />
    </main>
  );
}
