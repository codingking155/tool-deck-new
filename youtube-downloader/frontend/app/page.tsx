import { DownloaderHero } from "@/components/downloader-hero";
import { FAQ } from "@/components/faq";
import { FeatureCards } from "@/components/feature-cards";
import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";

export default function Home() {
  return (
    <>
      <a
        href="#video-url"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to downloader
      </a>
      <Navbar />
      <main className="flex-1">
        <DownloaderHero />
        <FeatureCards />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}
