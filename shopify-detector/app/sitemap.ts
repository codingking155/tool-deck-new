import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/content";
import { siteConfig } from "@/site.config";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteConfig.siteUrl;
  const posts = await getAllPosts();
  const latest = posts[0]?.date;
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/api-docs`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/the-story`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/blogs`, lastModified: latest, changeFrequency: "weekly", priority: 0.7 },
    ...posts.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: p.date, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
