/* Pure helpers for the SSL Certificate Checker: result age and the expiry reminder. */
import { buildIcs } from "./ics.js";

const DAY = 86_400_000;

/** "just now" / "3 min ago" / "2 h ago" / "4 days ago" for an ISO timestamp; null when unparseable. */
export function checkedAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));   // a slightly-ahead server clock reads as "just now"
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** A calendar reminder `leadDays` before expiry at 09:00 local time. Falls back to the day
    before expiry when the lead time has already passed; null when there's no real future
    expiry or even that is too late to be useful. */
export function expiryReminder({ host, notAfter, now = new Date(), leadDays = 14 }) {
  const exp = Date.parse(notAfter);
  if (!host || !Number.isFinite(exp) || exp <= now.getTime()) return null;
  const at9 = (days) => { const d = new Date(exp - days * DAY); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0); };
  let lead = leadDays, start = at9(lead);
  if (start <= now) { lead = 1; start = at9(1); }
  if (start <= now) return null;
  const expiry = new Date(exp);
  const day = expiry.toISOString().slice(0, 10);
  const ics = buildIcs({
    title: `Renew SSL certificate for ${host}`,
    startUtc: start,
    description: `The TLS certificate for ${host} expires on ${day} at ${expiry.toISOString().slice(11, 16)} UTC. Renew and deploy it before then.\nRe-check: https://tooldeck.in/tool/ssl/${host}`,
    uid: `ssl-expiry-${host}-${day}@tooldeck.in`,
    product: "SSL Certificate Checker",
    now,
  });
  return { startUtc: start, leadDays: lead, filename: `ssl-expiry-${host}.ics`, ics };
}
