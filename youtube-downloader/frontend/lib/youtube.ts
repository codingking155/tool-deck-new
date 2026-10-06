/**
 * Client-side mirror of the backend's URL rules, for instant feedback. The server
 * re-validates everything, so this is a convenience, not a security boundary.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

export type UrlCheck = { ok: true; videoId: string; url: string } | { ok: false; reason: string };

export function checkYouTubeUrl(raw: string): UrlCheck {
  const input = raw.trim();
  if (!input) return { ok: false, reason: "Paste a YouTube link to get started." };
  if (input.length > 2048) return { ok: false, reason: "That link is too long." };

  let parsed: URL;
  try {
    parsed = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    return { ok: false, reason: "That doesn't look like a valid link." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "Only http(s) links are supported." };
  }
  if (parsed.username || parsed.password || (parsed.port && !["80", "443"].includes(parsed.port))) {
    return { ok: false, reason: "Only YouTube links are supported." };
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const segments = parsed.pathname.split("/").filter(Boolean);
  let id: string | null = null;

  if (SHORT_HOSTS.has(host)) {
    if (segments.length === 1) id = segments[0];
  } else if (WATCH_HOSTS.has(host)) {
    if (segments.length === 1 && segments[0] === "watch") {
      const values = parsed.searchParams.getAll("v");
      id = values.length === 1 ? values[0] : null;
    } else if (segments.length === 2 && ["shorts", "live", "embed"].includes(segments[0])) {
      id = segments[1];
    }
  } else {
    return { ok: false, reason: "Only YouTube links are supported (youtube.com, youtu.be or Shorts)." };
  }

  if (!id || !VIDEO_ID.test(id)) {
    return { ok: false, reason: "That YouTube link doesn't point to a single video." };
  }
  return { ok: true, videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
}

export function looksLikeYouTubeUrl(text: string): boolean {
  return checkYouTubeUrl(text).ok;
}
