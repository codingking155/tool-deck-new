/* Browser smoke tests. Run against a built site:
     npm run build && npx vite preview --port 4173 &   then   npm run test:e2e
   E2E_FILTER=text runs only scenarios whose name contains it. BASE_URL overrides the address; CHROMIUM_PATH points at a browser binary if Playwright's own isn't installed.
   All third-party network calls are mocked or blocked, so results never depend on the internet. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { PDFDocument, StandardFonts } from "pdf-lib";
import JSZip from "jszip";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const TOOL_IDS = ["utc", "phone", "shopifydetector", "speed", "ip", "price", "json", "ssl", "password", "prompt", "image", "breach", "pdf"];
const CORS = { "access-control-allow-origin": "*" };
const dir = mkdtempSync(join(tmpdir(), "tooldeck-e2e-"));

async function makePdf(name, lines) {
  const d = await PDFDocument.create(); const font = await d.embedFont(StandardFonts.Helvetica);
  lines.forEach((t) => d.addPage([400, 400]).drawText(t, { x: 30, y: 300, size: 16, font }));
  const path = join(dir, name); writeFileSync(path, await d.save()); return path;
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];

async function scenario(name, fn, { mock } = {}) {
  if (process.env.E2E_FILTER && !name.toLowerCase().includes(process.env.E2E_FILTER.toLowerCase())) return;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000); // PDF rendering can be slow on shared CI runners
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  /* under `npm run preview:csp` a policy violation fails the scenario */
  page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  // The real internet is blocked; scenarios add specific mocks afterwards (later routes take precedence).
  await page.route((url) => /^https?:$/.test(url.protocol) && !url.href.startsWith(BASE), (r) => r.abort());
  try {
    if (mock) await mock(page);
    await fn(page);
    assert.deepEqual(errors, [], `uncaught page errors: ${errors.join(" | ")}`);
    results.push([name, true]); console.log(`  ok   ${name}`);
  } catch (e) {
    results.push([name, false]); console.log(`  FAIL ${name}\n       ${String(e.message).split("\n")[0]}`);
  } finally { await ctx.close(); }
}

const download = async (page, click) => { const p = page.waitForEvent("download"); await click(); const d = await p; const f = join(dir, `dl-${Date.now()}-${d.suggestedFilename()}`); await d.saveAs(f); return { path: f, name: d.suggestedFilename() }; };

const fixtures = {
  a: await makePdf("a.pdf", ["Page one text", "Page two text", "Page three text"]),
  c1: await makePdf("c1.pdf", ["The quick brown fox", "Second page stays"]),
  c2: await makePdf("c2.pdf", ["The slow brown fox jumps", "Second page stays"]),
};

console.log(`E2E against ${BASE}`);

await scenario("every tool page renders and the homepage filters cover all tools", async (p) => {
  await p.goto(BASE + "/");
  assert.equal(await p.locator(".bcard").count(), TOOL_IDS.length);
  let total = 0;
  for (const c of ["Time & network", "Shopping & web", "Files & documents", "Developer", "Security"]) {
    await p.getByRole("button", { name: c, exact: true }).click(); total += await p.locator(".bcard").count();
  }
  assert.equal(total, TOOL_IDS.length);
  for (const id of TOOL_IDS) { await p.goto(`${BASE}/tool/${id}`); await p.locator(".thead h1").waitFor({ timeout: 15000 }); }
});

await scenario("UTC: reference scenario, weekend skipping and calendar export", async (p) => {
  await p.goto(`${BASE}/tool/utc?zone=America/Mexico_City&date=2026-07-11&order=18:00&send=08:00&senddate=2026-07-13`);
  await p.getByText("Wait difference").waitFor();
  assert.equal(await p.locator(".bigres .val").innerText(), "1 day 14 hr 0 min");
  const cards = (await p.locator(".ocard").allInnerTexts()).join(" ");
  assert.match(cards, /00:00 UTC/); assert.match(cards, /14:00 UTC/);
  await p.goto(`${BASE}/tool/utc?zone=Europe/Amsterdam&date=2026-07-10&order=18:00&send=08:00`);
  await p.getByText("Wait difference").waitFor();
  assert.equal(await p.locator(".bigres .val").innerText(), "14 hr 0 min");
  await p.locator('[aria-label="Skip weekends"]').click();
  assert.equal(await p.locator(".bigres .val").innerText(), "2 days 14 hr 0 min");
  const ics = await download(p, () => p.getByRole("button", { name: "📅 .ics" }).click());
  const text = readFileSync(ics.path, "utf8");
  assert.match(text, /DTSTART:20260713T060000Z/); assert.ok(text.includes("\r\n"));
  await p.getByRole("button", { name: "Show hourly UTC wait table" }).click();
  assert.equal(await p.locator("table.rt tbody tr").count(), 24);
});

await scenario("PDF: merge two files", async (p) => {
  await p.goto(`${BASE}/tool/pdf`);
  await p.locator("button.pdfh-card", { hasText: "Merge PDF" }).click();
  await p.locator("input[type=file]").setInputFiles([fixtures.a, fixtures.c1]);
  await p.locator(".pb .btn", { hasText: "Merge PDF" }).last().click();
  await p.getByText("Done ·").waitFor({ timeout: 60000 });
  const out = await download(p, () => p.getByText("⬇ Download").click());
  assert.equal((await PDFDocument.load(readFileSync(out.path))).getPageCount(), 5);
});

await scenario("PDF: protect then unlock round-trip with wrong/missing password handling", async (p) => {
  await p.goto(`${BASE}/tool/pdf`);
  await p.locator("button.pdfh-card", { hasText: "Protect PDF" }).click();
  await p.locator("input[type=file]").setInputFiles(fixtures.a);
  await p.locator("input[type=password]").fill("pw1 é");
  await p.locator(".pb .btn", { hasText: "Protect PDF" }).last().click();
  await p.getByText("Done ·").waitFor({ timeout: 60000 });
  const prot = await download(p, () => p.getByText("⬇ Download").click());
  const enc = readFileSync(prot.path);
  assert.ok(enc.toString("latin1").includes("/Encrypt"));
  await assert.rejects(PDFDocument.load(enc));
  await p.getByText("← All PDF tools").click();
  await p.locator("button.pdfh-card", { hasText: "Unlock PDF" }).click();
  await p.locator("input[type=file]").setInputFiles(prot.path);
  const run = () => p.locator(".pb .btn", { hasText: "Unlock PDF" }).last().click();
  await run(); await p.locator(".toast.show").waitFor();
  assert.match(await p.locator(".toast").innerText(), /needs a password/);
  await p.waitForTimeout(2800);
  await p.locator("input[type=password]").fill("nope"); await run(); await p.locator(".toast.show").waitFor();
  assert.match(await p.locator(".toast").innerText(), /incorrect/);
  await p.waitForTimeout(2800);
  await p.locator("input[type=password]").fill("pw1 é"); await run();
  await p.getByText("Done ·").waitFor({ timeout: 60000 });
  const out = await download(p, () => p.getByText("⬇ Download").click());
  const bytes = readFileSync(out.path);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3);
  assert.ok(!bytes.toString("latin1").includes("/Encrypt"));
});

await scenario("PDF: compare finds the changed words; sign embeds an image; page thumbnails drive the page box", async (p) => {
  await p.goto(`${BASE}/tool/pdf`);
  await p.locator("button.pdfh-card", { hasText: "Compare PDF" }).click();
  const ins = p.locator("input[type=file]");
  await ins.nth(0).setInputFiles(fixtures.c1); await ins.nth(1).setInputFiles(fixtures.c2);
  await p.getByRole("button", { name: "Compare", exact: true }).click();
  await p.getByText("1 of 2 pages differ").waitFor({ timeout: 60000 });
  assert.match(await p.locator(".note.i").first().innerText(), /\+2 words added.*1 removed/s);

  await p.goto(`${BASE}/tool/pdf`);
  await p.locator("button.pdfh-card", { hasText: "Remove pages" }).click();
  await p.locator("input[type=file]").setInputFiles(fixtures.a);
  await p.getByRole("button", { name: "Page 2" }).click();
  assert.equal(await p.getByPlaceholder("1-3, 5").inputValue(), "2");

  await p.goto(`${BASE}/tool/pdf`);
  await p.locator("button.pdfh-card", { hasText: "Sign PDF" }).click();
  await p.locator("input[type=file]").first().setInputFiles(fixtures.c1);
  const cv = p.getByLabel("Draw your signature"); await cv.waitFor();
  const box = await cv.boundingBox();
  await p.mouse.move(box.x + 40, box.y + 100); await p.mouse.down();
  for (let i = 0; i < 20; i++) await p.mouse.move(box.x + 40 + i * 15, box.y + 100 + Math.sin(i) * 40);
  await p.mouse.up();
  await p.getByRole("button", { name: "Use this signature" }).click();
  await p.getByAltText("Your signature").waitFor();
  const prev = p.getByAltText("Page 1"); await prev.waitFor();
  const pb = await prev.boundingBox();
  await prev.click({ position: { x: pb.width * 0.6, y: pb.height * 0.8 } });
  await p.getByRole("button", { name: "Apply signature" }).click();
  const out = await download(p, () => p.getByText("⬇ Download").click());
  const doc = await PDFDocument.load(readFileSync(out.path));
  assert.ok(doc.getPage(0).node.Resources().get(doc.context.obj("XObject")), "signature image missing");
});

await scenario("PDF: multi-file results download as one ZIP", async (p) => {
  await p.goto(`${BASE}/tool/pdf`);
  await p.locator("button.pdfh-card", { hasText: "PDF to JPG" }).click();
  await p.locator("input[type=file]").setInputFiles(fixtures.a);
  await p.locator(".pb .btn", { hasText: "PDF to JPG" }).last().click();
  await p.getByText("Done ·").waitFor({ timeout: 60000 });
  const z = await download(p, () => p.getByRole("button", { name: "Download all as ZIP" }).click());
  const zip = await JSZip.loadAsync(readFileSync(z.path));
  assert.deepEqual(Object.keys(zip.files).sort(), ["a-page1.jpg", "a-page2.jpg", "a-page3.jpg"]);
});

await scenario("Breach: email results render; password check sends only a 5-char hash prefix", async (p) => {
  await p.goto(`${BASE}/tool/breach`);
  await p.getByLabel("Email address").fill("me@example.com");
  await p.getByRole("button", { name: "Check this email" }).click();
  // The email check needs VITE_SUPABASE_URL at build time; without it the app (correctly) never calls the mocked endpoint.
  await p.getByText(/Found in 1 breach|isn't configured/).first().waitFor();
  assert.equal(await p.getByText("isn't configured").count(), 0, "built without VITE_SUPABASE_URL — build like CI: VITE_SUPABASE_URL=https://e2e.supabase.co VITE_SUPABASE_ANON_KEY=e2e-placeholder npm run build");
  await p.getByText("Found in 1 breach").waitFor();
  assert.ok(await p.getByText("SENSITIVE").count() >= 1);
  await p.getByRole("button", { name: "Password check" }).click();
  await p.getByLabel("Password").fill("password");
  await p.getByRole("button", { name: "Check this password" }).click();
  await p.getByText("9,545,824").waitFor();
  assert.equal(global.__rangeUrl, "https://api.pwnedpasswords.com/range/5BAA6");
}, { mock: async (p) => {
  await p.route("**/functions/v1/breach-check", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: CORS,
    body: JSON.stringify({ breaches: [{ name: "OldSite", year: 2012, records: 1000, dataTypes: ["Email addresses", "Passwords"], severe: true }], summary: { count: 1, severe: true, dataTypes: [] } }) }));
  await p.route("https://api.pwnedpasswords.com/**", (r) => { global.__rangeUrl = r.request().url(); r.fulfill({ status: 200, headers: CORS, body: "1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0" }); });
} });

await scenario("IP: WebRTC leak check flags a public address that differs from the one sites see", async (p) => {
  await p.goto(`${BASE}/tool/ip`);
  await p.getByText("203.0.113.9").first().waitFor();
  await p.getByRole("button", { name: "Run WebRTC check" }).click();
  await p.getByText("Possible IP leak").first().waitFor();
}, { mock: async (p) => {
  await p.addInitScript(() => {
    window.RTCPeerConnection = class { constructor() { this.onicecandidate = null; } createDataChannel() {} close() {} async createOffer() { return {}; }
      async setLocalDescription() { setTimeout(() => { this.onicecandidate?.({ candidate: { candidate: "candidate:2 1 udp 1 198.51.100.7 9 typ srflx" } }); this.onicecandidate?.({ candidate: null }); }, 20); } };
  });
  await p.route("https://api.ipify.org/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: '{"ip":"203.0.113.9"}' }));
} });

await scenario("IP: DNS leak check groups resolvers by network and explains a public resolver", async (p) => {
  await p.goto(`${BASE}/tool/ip`);
  await p.getByRole("button", { name: "Run DNS check" }).click();
  await p.getByText("You're using Google Public DNS").first().waitFor();
  await p.getByText("2 server addresses").first().waitFor();
  if (await p.getByText("74.125.178.144").count() !== 1) throw new Error("expected each resolver IP once");
}, { mock: async (p) => {
  await p.route("https://bash.ws/id", (r) => r.fulfill({ status: 200, headers: CORS, body: "abcdef1234567890" }));
  await p.route(/^https:\/\/\d+\.abcdef1234567890\.bash\.ws\//, (r) => r.fulfill({ status: 200, headers: CORS, body: "" }));
  await p.route("https://bash.ws/dnsleak/test/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify([
    { type: "ip", ip: "203.0.113.9", country_name: "India", asn: "AS55836 Reliance Jio" },
    { type: "dns", ip: "172.217.34.208", country_name: "United States of America", asn: "AS15169 Google LLC" },
    { type: "dns", ip: "74.125.178.144", country_name: "United States of America", asn: "AS15169 Google LLC" },
    { type: "conclusion", ip: "DNS may be leaking." }]) }));
} });

const fireInstallEvent = (p) => p.evaluate(() => {
  const e = new Event("beforeinstallprompt", { cancelable: true });
  e.prompt = () => { window.__installPrompted = true; };
  e.userChoice = Promise.resolve({ outcome: "accepted" });
  window.dispatchEvent(e);
});
const installBox = (p) => p.getByRole("region", { name: "Install ToolDeck" });

await scenario("Install prompt: appears once for a new user after a delay, 'Not now' really closes it, and it never returns", async (p) => {
  await p.clock.install();
  await p.goto(`${BASE}/`);
  await fireInstallEvent(p);
  await p.clock.runFor(3000);
  assert.equal(await installBox(p).count(), 0, "must not interrupt the first seconds");
  await p.clock.runFor(6000);
  await installBox(p).waitFor();
  assert.match(await installBox(p).innerText(), /faster experience/);
  await p.getByRole("button", { name: "Not now" }).click();
  assert.equal(await installBox(p).count(), 0, "Not now must close it");
  await p.goto(`${BASE}/`);
  await fireInstallEvent(p);
  await p.clock.runFor(15000);
  assert.equal(await installBox(p).count(), 0, "must not come back on a later visit");
});

await scenario("Install prompt: Install opens the browser dialog; ignoring it still counts as the one offer", async (p) => {
  await p.clock.install();
  await p.goto(`${BASE}/`);
  await fireInstallEvent(p);
  await p.clock.runFor(9000);
  await installBox(p).waitFor();
  await p.getByRole("button", { name: "Install", exact: true }).click();
  assert.equal(await p.evaluate(() => window.__installPrompted === true), true);
  assert.equal(await installBox(p).count(), 0);
  await p.goto(`${BASE}/`);
  await fireInstallEvent(p);
  await p.clock.runFor(15000);
  assert.equal(await installBox(p).count(), 0);
});

await scenario("Install prompt: people who dismissed the old prompt are never shown it again", async (p) => {
  await p.addInitScript(() => localStorage.setItem("toolDeck.install-prompt-dismissed", String(Date.now() - 30 * 864e5)));
  await p.clock.install();
  await p.goto(`${BASE}/`);
  await fireInstallEvent(p);
  await p.clock.runFor(15000);
  assert.equal(await installBox(p).count(), 0);
});

await scenario("Shell: unknown routes show a not-found page; malformed share links never crash a tool", async (p) => {
  await p.goto(`${BASE}/tool/does-not-exist`);
  await p.getByRole("heading", { name: "Page not found" }).waitFor();
  await p.getByRole("button", { name: "Browse all tools" }).click();
  await p.locator(".bcard").first().waitFor();
  assert.equal(new URL(p.url()).pathname, "/");

  await p.goto(`${BASE}/tool/utc?date=abc&senddate=x&order=foo&tz=Nope/Zone`);
  await p.locator(".thead h1").waitFor();
  assert.equal(await p.getByText("Something went wrong in this tool").count(), 0);

  await p.goto(`${BASE}/tool/json`);
  await p.locator("textarea").first().fill("[".repeat(5000) + "]".repeat(5000));
  await p.waitForTimeout(800);
  assert.equal(await p.getByText("Something went wrong in this tool").count(), 0);
});

await scenario("Shopify: detected result shows the confidence ring, stats and every signal", async (p) => {
  await p.goto(`${BASE}/tool/shopifydetector`);
  await p.fill("#shopify-url", "neelsonline.com");
  await p.getByRole("button", { name: /check store/i }).click();
  await p.getByRole("heading", { name: "Shopify store detected" }).waitFor();
  assert.equal(await p.getByRole("meter", { name: "Detection confidence" }).getAttribute("aria-valuenow"), "98");
  assert.match(await p.locator(".sd-stats").innerText(), /neelsonline\.myshopify\.com/);
  assert.equal(await p.locator(".sd-signals li").count(), 3);
}, { mock: (p) => p.route(/shopify-check/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: CORS,
  body: JSON.stringify({ verdict: "yes", is_shopify: true, confidence_pct: 98, shop_domain: "neelsonline.myshopify.com", final_url: "https://neelsonline.com/", detected_signals: ["Shopify CDN assets loaded", "Shopify JavaScript object", "powered-by response header"], elapsed_ms: 727 }) })) });

await scenario("Phone: validity and line type from libphonenumber", async (p) => {
  await p.goto(`${BASE}/tool/phone?n=${encodeURIComponent("+44 20 7183 8750")}`);
  await p.getByText("Valid number · Landline").waitFor({ timeout: 15000 });
});

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
