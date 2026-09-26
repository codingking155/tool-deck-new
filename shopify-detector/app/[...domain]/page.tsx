import type { Metadata } from "next";
import { notFound } from "next/navigation";
import HomeView from "@/components/home/HomeView";
import { parsePrefixPath } from "@/lib/prefix";
import { siteConfig } from "@/site.config";

export async function generateMetadata({ params }: PageProps<"/[...domain]">): Promise<Metadata> {
  const host = parsePrefixPath((await params).domain);
  if (!host) return {};
  const title = `Is ${host} a Shopify store?`;
  return {
    title,
    description: `Instant Shopify check for ${host}: confidence score, shop domain and the technical signals behind the verdict.`,
    alternates: { canonical: `/${host}` },
    robots: siteConfig.indexResultPages ? undefined : { index: false, follow: true },
    openGraph: { title, url: `/${host}`, images: [{ url: `/og?domain=${encodeURIComponent(host)}`, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, images: [`/og?domain=${encodeURIComponent(host)}`] },
  };
}

export default async function PrefixPage({ params }: PageProps<"/[...domain]">) {
  const host = parsePrefixPath((await params).domain);
  if (!host) notFound();
  return <HomeView initialQuery={host} />;
}
