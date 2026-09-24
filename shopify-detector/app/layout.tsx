import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { siteConfig } from "@/site.config";
import Header from "@/components/Header";
import Background from "@/components/Background";
import Providers from "@/components/Providers";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: `${siteConfig.brand} — Is it a Shopify store?`,
    template: `%s | ${siteConfig.brand}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.brand,
  openGraph: { type: "website", siteName: siteConfig.brand, locale: "en_US" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#f0faf5" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only z-50 rounded-lg bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Skip to content
        </a>
        <Background />
        <Providers>
          <Header />
          <main id="main" className="flex-1">
            {children}
          </main>
          <footer className="mx-auto w-full max-w-6xl px-4 py-8 text-center text-sm text-muted sm:px-6">
            © {new Date().getFullYear()} {siteConfig.brand} ·{" "}
            <Link href="/api-docs" className="underline-offset-4 hover:underline">API</Link> ·{" "}
            <Link href="/blogs" className="underline-offset-4 hover:underline">Blog</Link> ·{" "}
            <a href={`mailto:${siteConfig.email}`} className="underline-offset-4 hover:underline">Contact</a>
          </footer>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
