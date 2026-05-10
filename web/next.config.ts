import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permanent redirect from the old /screener route to /discover.
  // Renamed to match the nav label and avoid leaking the
  // "screener" terminology of competing tools.
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
    ];
  },
};

export default nextConfig;
