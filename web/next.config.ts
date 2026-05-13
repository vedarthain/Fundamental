import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permanent redirects for renamed routes so external links and old
  // bookmarks keep working:
  //   /screener  → /discover  (older rename — match nav label)
  //   /clusters  → /sectors   (matches the UI's "Sectors" terminology)
  //   /cluster/* → /industry/* (a single cluster is an "industry" in the UI)
  async redirects() {
    return [
      {
        source: "/screener",
        destination: "/discover",
        permanent: true,
      },
      {
        source: "/screener/:path*",
        destination: "/discover/:path*",
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
