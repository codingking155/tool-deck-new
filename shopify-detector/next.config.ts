import type { NextConfig } from "next";

// Any host starting with "api." (e.g. api.example.com) serves the public API at /check.
const API_HOST = [{ type: "host" as const, value: "api\\..+" }];
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // This app lives inside another repo; pin the root so Turbopack ignores the parent lockfile.
  turbopack: { root: __dirname },
  poweredByHeader: false,
  serverExternalPackages: ["undici"],
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/check", has: API_HOST, destination: "/api/check" },
        { source: "/check/bulk", has: API_HOST, destination: "/api/check/bulk" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    return siteUrl ? [{ source: "/", has: API_HOST, destination: `${siteUrl}/api-docs`, permanent: false }] : [];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
