import { sha1Hex, pwnedCount, isValidEmail, isSevereType } from "../../shared/breachCore/index.mjs";

export { isValidEmail, isSevereType };

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
  if (!r.ok) {
    const err = new Error(body?.error?.message || "Unable to check right now.");
    err.status = r.status;
    err.retryAfter = parseRetryAfter(body?.error?.retryAfter ?? r.headers.get("Retry-After"));
    throw err;
  }
  // A 200 from a proxy/captive portal can be HTML or the wrong shape — never render that as "no breaches".
  if (!Array.isArray(body?.breaches)) throw new Error("Unable to check right now.");
  return body;
}

/** Seconds to wait from a JSON retryAfter or a Retry-After header (delta-seconds or HTTP-date).
    null when absent/unparseable; clamped to 1s–1h so a bogus value can't lock the button forever. */
export function parseRetryAfter(v, now = Date.now()) {
  if (v == null || v === "") return null;
  let s = typeof v === "number" ? v : /^\s*\d+(\.\d+)?\s*$/.test(String(v)) ? Number(v) : (Date.parse(String(v)) - now) / 1000;
  if (!Number.isFinite(s)) return null;
  s = Math.ceil(s);
  return Math.min(3600, Math.max(1, s));
}

/* Next steps tailored to what leaked. Specific advice first, then the steps that always apply. */
const STEP_RULES = [
  [/password/i, [
    "Change the password on every affected account — and anywhere you reused it.",
    "Use a unique password per site, ideally from a password manager.",
  ]],
  [/security question/i, ["Change security-question answers wherever you used them, and treat them like passwords (random answers stored in your manager)."]],
  [/phone/i, ["Your phone number leaked: ask your carrier for a SIM/port-out PIN to block SIM-swap attacks, and switch 2FA from SMS to an authenticator app or passkey."]],
  [/credit|card|bank|payment|cvv|iban|financial/i, ["Card or bank details leaked: contact your bank, watch statements for charges you don't recognise and ask about a replacement card."]],
  [/physical address|home address|postal|^addresses$|birth|social security|ssn|passport|government|driver|national id|tax/i,
    ["Personal details like your address or date of birth leaked: watch for identity theft — consider a credit freeze or fraud alert and check your credit report."]],
];
const ALWAYS = [
  "Turn on two-factor authentication, preferably an authenticator app or passkey.",
  "Be wary of phishing that mentions these services; attackers reuse breach data.",
];

/** Exposed data types (e.g. summary.dataTypes) → ordered, de-duplicated advice. Unknown/empty types fall back
    to the password steps, since "we don't know what leaked" shouldn't read as "nothing to change". */
export function nextSteps(dataTypes) {
  const types = Array.isArray(dataTypes) ? dataTypes.map(String) : [];
  const out = [];
  STEP_RULES.forEach(([re, steps], i) => {
    if (types.some((t) => re.test(t)) || (i === 0 && types.length === 0)) out.push(...steps);
  });
  if (types.length && !types.some((t) => STEP_RULES[0][0].test(t))) out.unshift("Passwords weren't listed, but if you reused one on these sites, change it anyway.");
  return [...new Set([...out, ...ALWAYS])];
}
