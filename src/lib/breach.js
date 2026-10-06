import { sha1Hex, pwnedCount, isValidEmail } from "../../shared/breachCore/index.mjs";

export { isValidEmail };

/** Passwords: k-anonymity. Only the first 5 hex chars of the SHA-1 leave the browser. Returns the times seen in breaches. */
export async function checkPassword(password, signal) {
  const hash = await sha1Hex(password);
  const r = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { signal, headers: { "Add-Padding": "true" } });
  if (!r.ok) throw new Error("Unable to check right now.");
  return pwnedCount(await r.text(), hash.slice(5));
}

/** Emails: via the breach-check edge function. */
export async function checkEmail(email, signal) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("The email check isn't configured on this deployment.");
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  let r;
  try {
    r = await fetch(`${base}/functions/v1/breach-check`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ email }),
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new Error("Unable to check right now.");
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error?.message || "Unable to check right now.");
  // A 200 from a proxy/captive portal can be HTML or the wrong shape — never render that as "no breaches".
  if (!Array.isArray(body?.breaches)) throw new Error("Unable to check right now.");
  return body;
}
