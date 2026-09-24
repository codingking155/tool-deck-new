import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { siteConfig } from "@/site.config";

export const OG_SIZE = { width: 1200, height: 630 };

const fonts = Promise.all([
  readFile(join(process.cwd(), "assets/fonts/Inter-400.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Inter-800.ttf")),
]);

type Verdict = "yes" | "no" | null;

function Gem() {
  return (
    <svg width="44" height="44" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#0f7b5f" />
      <path d="M10.5 9h11l3.5 4.5L16 24 7 13.5 10.5 9Z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function VerdictIcon({ verdict }: { verdict: Exclude<Verdict, null> }) {
  const color = verdict === "yes" ? "#0f7b5f" : "#dc2626";
  return (
    <svg width="64" height="64" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill={color} />
      {verdict === "yes" ? (
        <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M8 8l8 8M16 8l-8 8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      )}
    </svg>
  );
}

export async function renderOgImage({ eyebrow, title, subtitle, verdict = null }: { eyebrow?: string; title: string; subtitle?: string; verdict?: Verdict }) {
  const [regular, bold] = await fonts;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(160deg, #e3f5ec 0%, #f0faf5 45%, #ffffff 100%)",
          color: "#0f1f1a",
          fontFamily: "Inter",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 800 }}>
          <Gem />
          {siteConfig.brand}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {eyebrow && <div style={{ fontSize: 26, fontWeight: 800, color: "#0f7b5f", letterSpacing: 3, textTransform: "uppercase" }}>{eyebrow}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {verdict && <VerdictIcon verdict={verdict} />}
            <div style={{ fontSize: title.length > 60 ? 54 : 68, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 1000 }}>{title}</div>
          </div>
          {subtitle && <div style={{ fontSize: 30, color: "#4b5b56", maxWidth: 980, lineHeight: 1.35 }}>{subtitle}</div>}
        </div>
        <div style={{ fontSize: 24, color: "#4b5b56" }}>{siteConfig.domain}</div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Inter", data: regular, weight: 400, style: "normal" },
        { name: "Inter", data: bold, weight: 800, style: "normal" },
      ],
    },
  );
}
