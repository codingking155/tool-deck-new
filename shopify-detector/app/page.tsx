import type { Metadata } from "next";
import HomeView from "@/components/home/HomeView";
import { siteConfig } from "@/site.config";

export const revalidate = 3600;

export const metadata: Metadata = { alternates: { canonical: "/" } };

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: siteConfig.brand,
  url: siteConfig.siteUrl,
  description: siteConfig.description,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Any",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <HomeView />
    </>
  );
}
