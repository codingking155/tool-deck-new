import type { NextRequest } from "next/server";
import { getCached } from "@/lib/cache";
import { normalizeInput } from "@/lib/detect/normalize";
import { renderOgImage } from "@/lib/og";

// Cache-only on purpose: link-preview crawlers must not be able to trigger fresh outbound checks.
export async function GET(req: NextRequest) {
  let host: string | null = null;
  try {
    host = normalizeInput(req.nextUrl.searchParams.get("domain") ?? "").host;
  } catch {
    host = null;
  }
  if (!host) return await renderOgImage({ title: "Is It a Shopify Store?" });

  const cached = await getCached(host);
  const image = await (!cached
    ? renderOgImage({ title: `Is ${host} a Shopify store?`, subtitle: "Tap to run an instant check." })
    : cached.is_shopify
      ? renderOgImage({
          title: `${host} is a Shopify store`,
          subtitle: `${Math.round(cached.confidence * 100)}% confidence${cached.shop_domain ? ` · ${cached.shop_domain}` : ""}`,
          verdict: "yes",
        })
      : renderOgImage({ title: `${host} is not a Shopify store`, subtitle: "No Shopify signals detected.", verdict: "no" }));

  image.headers.set("Cache-Control", cached ? "public, max-age=3600, s-maxage=3600" : "public, max-age=300, s-maxage=300");
  return image;
}
