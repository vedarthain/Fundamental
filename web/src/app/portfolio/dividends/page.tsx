import { redirect } from "next/navigation";

export default function DividendsRedirect() {
  redirect("/portfolio?tab=dividends");
}
