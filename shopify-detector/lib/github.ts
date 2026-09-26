import { siteConfig } from "@/site.config";

/** Live star count, refreshed hourly; falls back to the configured number. */
export async function getStarCount(): Promise<number> {
  if (siteConfig.githubRepo === "your-org/your-repo") return siteConfig.fallbackStars;
  try {
    const res = await fetch(`https://api.github.com/repos/${siteConfig.githubRepo}`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return siteConfig.fallbackStars;
    const data = (await res.json()) as { stargazers_count?: unknown };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : siteConfig.fallbackStars;
  } catch {
    return siteConfig.fallbackStars;
  }
}
