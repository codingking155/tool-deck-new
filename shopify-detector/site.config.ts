// Every brand, domain and contact value lives here — swap these to rebrand.
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
const siteHost = new URL(siteUrl).host;
const apiHost = process.env.NEXT_PUBLIC_API_HOST || "";
const githubRepo = process.env.GITHUB_REPO || "your-org/your-repo";

export const siteConfig = {
  brand: "StoreScout",
  description:
    "Instantly check whether any website is built on Shopify. Built for Shopify app sales teams qualifying leads at scale.",
  siteUrl,
  /** Shown in the "Add prefix" instructions, e.g. storescout.example/allbirds.com */
  domain: siteHost,
  /** Public API base. With NEXT_PUBLIC_API_HOST set this is https://api.host/check, otherwise /api/check. */
  apiEndpoint: apiHost ? `https://${apiHost}/check` : `${siteUrl}/api/check`,
  email: "hello@example.com",
  githubRepo,
  githubUrl: `https://github.com/${githubRepo}`,
  /** Shown when the GitHub API is unreachable or the repo placeholder is still set. */
  fallbackStars: 12,
  author: "Team StoreScout",
  /** Prefix result pages (/example.com) are thin content — keep them out of search indexes. */
  indexResultPages: false,
} as const;
