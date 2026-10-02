import { DetectionError } from "./errors";

export interface NormalizedTarget {
  host: string;
  url: string;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const IPV4_LIKE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

/**
 * Turns user input ("example.com", "www.example.com", "https://example.com/path")
 * into the homepage URL we fetch. Browser-safe: no Node APIs.
 */
export function normalizeInput(raw: string): NormalizedTarget {
  const trimmed = (raw ?? "").trim().replace(/^["'<]+|["'>]+$/g, "");
  if (!trimmed) throw new DetectionError("invalid_url", "Please enter a website URL.");
  if (trimmed.length > 2048) throw new DetectionError("invalid_url", "That URL is too long.");

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) {
    throw new DetectionError("invalid_url", "Only http and https URLs can be checked.");
  }

  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`);
  } catch {
    throw new DetectionError("invalid_url", "That doesn't look like a valid website URL.");
  }

  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    throw new DetectionError("invalid_url", "Custom ports aren't supported — enter the site's domain.");
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || IPV4_LIKE.test(host)) {
    throw new DetectionError("invalid_url", "Enter a domain name rather than an IP address.");
  }
  if (host === "localhost" || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new DetectionError("invalid_url", "Local and internal hostnames can't be checked.");
  }

  const labels = host.split(".");
  if (host.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !TLD.test(labels.at(-1)!)) {
    throw new DetectionError("invalid_url", "That doesn't look like a valid domain (e.g. example.com).");
  }

  return { host, url: `https://${host}/` };
}
