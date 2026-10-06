/* Pure helpers for the SSL certificate checker. Shared by the browser (input
   validation, expiry display) and the `ssl-check` edge function (validation,
   Certificate Transparency record selection, TLS error mapping).
   No network, no DOM. */

import { classifyHost } from "../net/ipGuard.mjs";

const DAY = 86_400_000;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Turn whatever was typed or pasted ("https://Example.com:443/path?q", "example.com.")
 * into a bare, public DNS name. IP addresses, internal names and other ports are refused.
 * @returns {{ok:true, host:string} | {ok:false, code:string, message:string}}
 */
export function normalizeDomain(input) {
  const bad = (code, message) => ({ ok: false, code, message });
  let s = String(input ?? "").trim();
  if (!s) return bad("empty", "Enter a domain name, e.g. example.com.");
  if (s.length > 2048) return bad("invalid", "That doesn't look like a domain name.");
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");          // scheme
  s = s.split(/[/?#]/)[0];                                   // path, query, fragment
  s = s.slice(s.lastIndexOf("@") + 1);                       // user:pass@
  if (/^\[.*\]/.test(s) || (s.match(/:/g) || []).length > 1) {
    return bad("ip_address", "Enter a domain name, not an IP address.");
  }
  const port = s.match(/:(\d*)$/);
  if (port) {
    if (port[1] !== "" && port[1] !== "443") return bad("port", "Only the standard HTTPS port (443) can be checked.");
    s = s.slice(0, port.index);
  }
  s = s.replace(/\.+$/, "");
  if (!s || /\s/.test(s)) return bad("invalid", "That doesn't look like a domain name.");

  let host;
  try { host = new URL(`https://${s}/`).hostname.toLowerCase(); }            // IDN → punycode
  catch { return bad("invalid", "That doesn't look like a domain name."); }
  host = host.replace(/\.+$/, "");

  const cls = classifyHost(host);
  if (cls.kind !== "name") return bad("ip_address", "Enter a domain name, not an IP address.");
  if (cls.reason === "bare-hostname") return bad("invalid", "Enter a full domain name, e.g. example.com.");
  if (cls.blocked) return bad("private_host", "Private and internal hosts can't be checked.");
  if (host.length > 253) return bad("invalid", "That domain name is too long.");
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels[labels.length - 1])) {
    return bad("invalid", "That doesn't look like a domain name.");
  }
  return { ok: true, host };
}

/** "a.b.example.com" → "*.b.example.com" (the wildcard that could cover it), or null for an apex. */
export function wildcardParent(host) {
  const labels = String(host).split(".");
  return labels.length >= 3 ? `*.${labels.slice(1).join(".")}` : null;
}

/** Does a certificate name (exact or single-label wildcard) cover this host? */
export function nameCovers(name, host) {
  const n = String(name).trim().toLowerCase().replace(/\.$/, "");
  const h = String(host).toLowerCase();
  if (n === h) return true;
  if (!n.startsWith("*.")) return false;
  const rest = n.slice(2);
  const dot = h.indexOf(".");
  return dot > 0 && h.slice(dot + 1) === rest;
}

/** Date string → epoch ms, or null. crt.sh omits the zone; its times are UTC. Never throws. */
export function parseDate(s) {
  if (s == null || s === "") return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const str = String(s).trim();
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(str) ? `${str}Z` : str;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Whole days from now until `ms` (negative once past), or null. */
export function daysUntil(ms, now = Date.now()) {
  return ms == null || !Number.isFinite(ms) ? null : Math.floor((ms - now) / DAY);
}

export function expirySeverity(days) {
  if (days == null) return { level: "unknown", label: "Unknown" };
  if (days < 0) return { level: "expired", label: "Expired" };
  if (days < 7) return { level: "critical", label: "Expires within a week" };
  if (days < 30) return { level: "warning", label: "Expires within 30 days" };
  return { level: "ok", label: "Valid" };
}

/**
 * From crt.sh JSON rows, pick the most recently issued certificate that is valid
 * right now and names this host. Precertificate/final-cert duplicates collapse by serial.
 * @returns {null | {issuer, commonName, sans, notBefore, notAfter, serial, crtshId}}
 */
export function selectLatestCert(records, host, now = Date.now()) {
  if (!Array.isArray(records)) return null;
  const bySerial = new Map();
  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    const nb = parseDate(r.not_before), na = parseDate(r.not_after);
    if (nb == null || na == null || nb > now || na <= now) continue;
    const sans = [...new Set(String(r.name_value ?? "").split(/\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
    const names = r.common_name ? [String(r.common_name), ...sans] : sans;
    if (!names.some((n) => nameCovers(n, host))) continue;
    const serial = String(r.serial_number ?? "").toLowerCase() || `id:${r.id}`;
    const prev = bySerial.get(serial);
    if (!prev || nb > prev.nb || (nb === prev.nb && Number(r.id) > Number(prev.r.id))) bySerial.set(serial, { r, nb, na, sans });
  }
  let best = null;
  for (const c of bySerial.values()) {
    if (!best || c.nb > best.nb || (c.nb === best.nb && c.na > best.na)) best = c;
  }
  if (!best) return null;
  const { r, nb, na, sans } = best;
  return {
    issuer: issuerName(r.issuer_name),
    issuerDn: r.issuer_name ? String(r.issuer_name) : null,
    commonName: r.common_name ? String(r.common_name) : null,
    sans,
    notBefore: new Date(nb).toISOString(),
    notAfter: new Date(na).toISOString(),
    serial: r.serial_number ? String(r.serial_number).toLowerCase() : null,
    crtshId: r.id != null ? Number(r.id) : null,
  };
}

/** "C=US, O=Let's Encrypt, CN=R11" → "Let's Encrypt (R11)". */
export function issuerName(dn) {
  if (!dn) return null;
  const parts = {};
  for (const [, k, v] of String(dn).matchAll(/(?:^|,)\s*([A-Za-z]+)=("[^"]*"|[^,]*)/g)) {
    parts[k.toUpperCase()] ??= v.replace(/^"|"$/g, "").trim();
  }
  const o = parts.O, cn = parts.CN;
  if (o && cn && cn !== o) return `${o} (${cn})`;
  return o || cn || String(dn);
}

/**
 * Map a TLS handshake/connect error from the runtime to a user-facing status.
 * Deno's messages come from rustls ("invalid peer certificate: Expired",
 * "...: UnknownIssuer", "...: NotValidForName") or the OS (refused, timed out).
 */
export function classifyTlsError(message) {
  const m = String(message ?? "");
  const out = (status, text) => ({ status, message: text });
  if (/expired/i.test(m)) return out("expired", "The certificate the server presented has expired.");
  if (/not\s*valid\s*yet|notvalidyet/i.test(m)) return out("not_yet_valid", "The certificate the server presented is not valid yet (check the server clock).");
  if (/not\s*valid\s*for\s*name|notvalidforname|name\s*mismatch|hostname\s*mismatch/i.test(m)) return out("hostname_mismatch", "The certificate is not issued for this hostname.");
  if (/revoked/i.test(m)) return out("revoked", "The certificate has been revoked.");
  if (/unknown\s*issuer|unknownissuer|self[\s-]*signed|untrusted|bad\s*signature|badsignature|unsupported.*(?:signature|algorithm)/i.test(m)) {
    return out("untrusted", "The certificate chain isn't trusted (self-signed, unknown issuer or an incomplete chain).");
  }
  if (/timed?\s*out|deadline/i.test(m)) return out("unreachable", "The server didn't answer on port 443 in time.");
  if (/handshake|alert|protocol|eof|close_notify|closed/i.test(m)) return out("handshake_failed", "The TLS handshake failed (the server may not support modern TLS).");
  if (/refused|unreachable|reset|no route|dns|lookup|resolve|network|connect/i.test(m)) return out("unreachable", "Couldn't connect to the server on port 443.");
  return out("error", "The TLS connection failed.");
}
