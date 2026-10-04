import { OG_SIZE, renderOgImage } from "@/lib/og";

export const alt = "Is it a Shopify store? Instant Shopify detection for sales teams";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOgImage({
    title: "Is It a Shopify Store?",
    subtitle: "Qualify leads faster — for Shopify app sales teams working at scale.",
  });
}
