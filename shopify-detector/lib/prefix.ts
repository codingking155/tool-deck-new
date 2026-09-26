import { normalizeInput } from "./detect/normalize";

export const RESERVED_SEGMENTS = new Set([
  "api-docs",
  "the-story",
  "blogs",
  "blog",
  "api",
  "_next",
  "favicon.ico",
  "icon.svg",
  "robots.txt",
  "sitemap.xml",
  "manifest.webmanifest",
  "og",
  "opengraph-image",
  "twitter-image",
]);

// None of these are real TLDs, so a trailing one means a file request, not a domain.
const FILE_EXT = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|css|js|mjs|map|txt|xml|json|webmanifest|woff2?|ttf|php|aspx?|env|html?|ya?ml|bak|sql)$/i;

/** Maps /allbirds.com, /https://allbirds.com/x, … to a host; null means "not a domain, 404". */
export function parsePrefixPath(segments: string[]): string | null {
  if (!segments.length) return null;
  const decoded = segments.map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (RESERVED_SEGMENTS.has(decoded[0].toLowerCase())) return null;

  const hostPart = decoded.join("/").replace(/^https?:\/*/i, "").split(/[/?#]/)[0];
  if (!hostPart || FILE_EXT.test(hostPart)) return null;
  try {
    return normalizeInput(hostPart).host;
  } catch {
    return null;
  }
}
