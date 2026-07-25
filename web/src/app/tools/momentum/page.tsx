import { permanentRedirect } from "next/navigation";

// The Scanner moved from /tools/momentum to /tools/scanner. This route is kept
// only to permanently redirect (308) old inbound links / bookmarks / SEO to
// its new home.
export const dynamic = "force-static";

export default function MomentumRedirect() {
  permanentRedirect("/tools/scanner");
}
