import { permanentRedirect } from "next/navigation";

// The "Fallen Leaders" screen moved into the unified Scanner (as a tab). This
// route is kept only to permanently redirect (308) old inbound links /
// bookmarks / SEO to its new home rather than 404.
export const dynamic = "force-static";

export default function OpportunitiesRedirect() {
  permanentRedirect("/tools/scanner?tab=fallen");
}
