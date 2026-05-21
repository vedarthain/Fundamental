import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permanent redirects for renamed routes so external links and old
  // bookmarks keep working. /discover, /screen, and /compare were moved
  // under a new /tools umbrella to differentiate them from the browse-first
  // /sectors surface; this set of redirects preserves every old URL.
  //   /discover   → /tools/screener           (renamed from /discover)
  //   /screener   → /tools/screener           (very old name; kept working)
  //   /screen     → /tools/investing-trials   (custom-weights tool)
  //   /compare    → /tools/peer-comparison    (side-by-side comparison)
  //   /clusters   → /sectors                  (matches the UI's terminology)
  //   /cluster/*  → /industry/*               (a single cluster = an industry)
  async redirects() {
    return [
      {
        source: "/discover",
        destination: "/tools/screener",
        permanent: true,
      },
      {
        source: "/discover/:path*",
        destination: "/tools/screener/:path*",
        permanent: true,
      },
      {
        source: "/screener",
        destination: "/tools/screener",
        permanent: true,
      },
      {
        source: "/screener/:path*",
        destination: "/tools/screener/:path*",
        permanent: true,
      },
      {
        source: "/screen",
        destination: "/tools/investing-trials",
        permanent: true,
      },
      {
        source: "/screen/:path*",
        destination: "/tools/investing-trials/:path*",
        permanent: true,
      },
      {
        source: "/compare",
        destination: "/tools/peer-comparison",
        permanent: true,
      },
      {
        source: "/compare/:path*",
        destination: "/tools/peer-comparison/:path*",
        permanent: true,
      },
      {
        source: "/clusters",
        destination: "/sectors",
        permanent: true,
      },
      {
        source: "/clusters/:path*",
        destination: "/sectors/:path*",
        permanent: true,
      },
      {
        source: "/cluster/:path*",
        destination: "/industry/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
