// Stateless, unguessable management token = base64url(alertId) + "." + HMAC.
// Nothing is stored server-side; the API and the monitor regenerate/verify it
// from ALERT_TOKEN_SECRET. Uses Web Crypto, available in Deno, browsers and Node 18+.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return b64url(new Uint8Array(sig));
}

export async function makeManageToken(alertId, secret) {
  if (!secret) throw new Error("ALERT_TOKEN_SECRET is not set");
  return b64url(enc.encode(String(alertId))) + "." + (await hmac(secret, String(alertId)));
}

// Returns the alertId if the token is valid, else null.
export async function verifyManageToken(token, secret) {
  if (!secret || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const idPart = token.slice(0, dot), mac = token.slice(dot + 1);
  let alertId;
  try { alertId = dec.decode(fromB64url(idPart)); } catch { return null; }
  const expected = await hmac(secret, alertId);
  return timingSafeEqual(mac, expected) ? alertId : null;
}
