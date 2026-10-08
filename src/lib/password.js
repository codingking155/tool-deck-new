/* Pure helpers for the password strength checker: crack-time estimates and an unbiased generator.
   No DOM. Randomness is injectable (a getRandomValues-shaped function) so tests can drive it. */
import { WORDS } from "./wordlist.js";

/* Two attacker models. Rates are ballpark: a rate-limited login form vs. GPUs on a leaked fast hash (MD5/SHA-1/NTLM). */
export const ATTACKS = [
  { key: "online", label: "Online attack", note: "throttled login, ~100 guesses/s", rate: 100 },
  { key: "offline", label: "Offline attack", note: "leaked fast hash, ~10 billion guesses/s", rate: 1e10 },
];

const YEAR = 31557600; // Julian year, seconds
const UNITS = [["year", YEAR], ["month", YEAR / 12], ["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]];

/** Seconds → "instantly", "3 hours", "12 years", "centuries". Floors, so it never overstates. */
export function formatDuration(seconds) {
  if (!(seconds >= 1)) return "instantly"; // also NaN / negative
  if (seconds >= 100 * YEAR) return "centuries"; // also Infinity
  for (const [unit, s] of UNITS) {
    if (seconds >= s) { const n = Math.floor(seconds / s); return `${n} ${unit}${n === 1 ? "" : "s"}`; }
  }
  return "instantly";
}

/** Average time to guess: half of the 2^bits keyspace at `rate` guesses per second. */
export const crackSeconds = (bits, rate) => 2 ** (Math.max(0, bits) - 1) / rate;

/** One row per attacker model: { key, label, note, rate, seconds, text }. */
export const crackTimes = (bits) => ATTACKS.map((a) => {
  const seconds = crackSeconds(bits, a.rate);
  return { ...a, seconds, text: formatDuration(seconds) };
});

const defaultRandom = (arr) => globalThis.crypto.getRandomValues(arr);

/** Uniform integer in [0, n). Rejection sampling: draws at or above the largest multiple of n that fits in
    32 bits are thrown away, so `% n` never favours the low values (no modulo bias). */
export function randomInt(n, getRandomValues = defaultRandom) {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError("n must be an integer in 1..2^32");
  const limit = 2 ** 32 - (2 ** 32 % n);
  const buf = new Uint32Array(1);
  for (;;) {
    getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/* All 94 printable ASCII characters (no space): the same 26+26+10+32 pool the strength meter assumes. */
export const CHARSET = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join("");
const CLASSES = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/];

/** Random password of `length` characters from CHARSET using all four character types. A draw missing a
    type is redrawn whole (not patched), which keeps the result uniform over the passwords that qualify.
    Returns { value, bits }. */
export function generatePassword(length = 20, getRandomValues = defaultRandom) {
  if (!Number.isInteger(length) || length < 8 || length > 128) throw new RangeError("length must be 8–128");
  for (;;) {
    let value = "";
    for (let i = 0; i < length; i++) value += CHARSET[randomInt(CHARSET.length, getRandomValues)];
    if (CLASSES.every((re) => re.test(value))) return { value, bits: length * Math.log2(CHARSET.length) };
  }
}

/** Passphrase of `words` random words from the 1024-word list (10 bits each), joined by `sep`.
    Returns { value, bits } — bits is the true entropy, far below what a charset estimate of the text suggests. */
export function generatePassphrase(words = 7, getRandomValues = defaultRandom, sep = "-") {
  if (!Number.isInteger(words) || words < 3 || words > 20) throw new RangeError("words must be 3–20");
  const picked = Array.from({ length: words }, () => WORDS[randomInt(WORDS.length, getRandomValues)]);
  return { value: picked.join(sep), bits: words * Math.log2(WORDS.length) };
}
