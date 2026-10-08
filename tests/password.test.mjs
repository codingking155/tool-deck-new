import test from "node:test";
import assert from "node:assert/strict";
import { formatDuration, crackSeconds, crackTimes, randomInt, CHARSET, generatePassword, generatePassphrase } from "../src/lib/password.js";
import { WORDS } from "../src/lib/wordlist.js";

/* A fake getRandomValues that hands out a fixed sequence of uint32s (then repeats the last). */
const seq = (...vals) => { let i = 0; return (arr) => { arr[0] = vals[Math.min(i++, vals.length - 1)]; return arr; }; };

test("formatDuration is human-readable and never overstates", () => {
  assert.equal(formatDuration(0), "instantly");
  assert.equal(formatDuration(0.4), "instantly");
  assert.equal(formatDuration(NaN), "instantly");
  assert.equal(formatDuration(1), "1 second");
  assert.equal(formatDuration(59.9), "59 seconds");
  assert.equal(formatDuration(120), "2 minutes");
  assert.equal(formatDuration(3 * 3600 + 1800), "3 hours");
  assert.equal(formatDuration(86400 * 1.9), "1 day");
  assert.equal(formatDuration(86400 * 45), "1 month");
  assert.equal(formatDuration(31557600 * 12.5), "12 years");
  assert.equal(formatDuration(31557600 * 99), "99 years");
  assert.equal(formatDuration(31557600 * 100), "centuries");
  assert.equal(formatDuration(Infinity), "centuries");
});

test("crack time: average of half the keyspace, online vs offline", () => {
  assert.equal(crackSeconds(10, 1), 512);
  assert.equal(crackSeconds(0, 100), 0.005);
  const [online, offline] = crackTimes(40);
  assert.equal(online.key, "online");
  assert.equal(online.text, "centuries");          // 2^39 / 100 s ≈ 174 years
  assert.equal(offline.text, "54 seconds");         // 2^39 / 1e10 s
  assert.deepEqual(crackTimes(10).map((r) => r.text), ["5 seconds", "instantly"]);
  assert.deepEqual(crackTimes(128).map((r) => r.text), ["centuries", "centuries"]);
  assert.deepEqual(crackTimes(5000).map((r) => r.text), ["centuries", "centuries"]); // 2^4999 overflows to Infinity
});

test("randomInt rejects draws in the biased tail instead of using a plain modulo", () => {
  // n = 3: 2^32 % 3 = 1, so the single value 2^32-1 must be rejected (a plain % would map it to 0).
  assert.equal(randomInt(3, seq(2 ** 32 - 1, 7)), 1);
  // n = 94: limit = 2^32 - (2^32 % 94); every value at/above it is redrawn.
  const limit = 2 ** 32 - (2 ** 32 % 94);
  assert.equal(randomInt(94, seq(limit, limit + 5, 2 ** 32 - 1, 95)), 1);
  assert.equal(randomInt(94, seq(limit - 1)), (limit - 1) % 94);
  assert.equal(randomInt(1, seq(123)), 0);
  assert.throws(() => randomInt(0), RangeError);
  assert.throws(() => randomInt(2.5), RangeError);
});

test("randomInt is roughly uniform with real crypto randomness", () => {
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 60000; i++) counts[randomInt(6)]++;
  for (const c of counts) assert.ok(c > 9000 && c < 11000, `bucket ${c} out of range`);
});

test("generatePassword: length, charset, all four character types, entropy", () => {
  assert.equal(CHARSET.length, 94);
  assert.ok(!CHARSET.includes(" "));
  for (let i = 0; i < 200; i++) {
    const { value, bits } = generatePassword(16);
    assert.equal(value.length, 16);
    assert.ok([...value].every((c) => CHARSET.includes(c)));
    assert.ok(/[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^a-zA-Z\d]/.test(value), value);
    assert.ok(Math.abs(bits - 16 * Math.log2(94)) < 1e-9);
  }
  assert.equal(generatePassword().value.length, 20);
  assert.throws(() => generatePassword(4), RangeError);
});

test("generatePassword redraws the whole password when a character type is missing", () => {
  // First 8 draws: all index 0 ("!"), so no letters/digits → redrawn. Then a sequence with every type.
  const idx = (c) => CHARSET.indexOf(c);
  const want = "aA1!bB2@";
  const rv = seq(...new Array(8).fill(0), ...[...want].map(idx));
  assert.equal(generatePassword(8, rv).value, want);
});

test("generatePassphrase: word count, list membership, true entropy", () => {
  assert.equal(WORDS.length, 1024);
  assert.equal(new Set(WORDS).size, 1024);
  assert.ok(WORDS.every((w) => /^[a-z]+$/.test(w)));
  const { value, bits } = generatePassphrase(7);
  const parts = value.split("-");
  assert.equal(parts.length, 7);
  assert.ok(parts.every((w) => WORDS.includes(w)));
  assert.equal(bits, 70);
  assert.equal(generatePassphrase(4, seq(0, 1, 2, 1023), " ").value, [WORDS[0], WORDS[1], WORDS[2], WORDS[1023]].join(" "));
  assert.throws(() => generatePassphrase(1), RangeError);
});
