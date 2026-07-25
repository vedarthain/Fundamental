import { redirect } from "next/navigation";

// The Scanner moved from /tools/momentum to /tools/scanner. This route is kept
// only to redirect old inbound links / bookmarks / SEO to its new home.
export const dynamic = "force-static";

export default function MomentumRedirect() {
  redirect("/tools/scanner");
}
