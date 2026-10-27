import { redirect } from "next/navigation";

export default function DividendRedirect() {
  redirect("/portfolio?tab=dividends");
}
