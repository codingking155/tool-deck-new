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
  for (const id of TOOL_IDS) { await p.goto(`${BASE}/tool/${id}`); await p.locator(".thead h2").waitFor({ timeout: 15000 }); }
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
  await p.locator("button.panel", { hasText: "Merge PDF" }).click();
  await p.locator("input[type=file]").setInputFiles([fixtures.a, fixtures.c1]);
  await p.locator(".pb .btn", { hasText: "Merge PDF" }).last().click();
  await p.getByText("Done ·").waitFor({ timeout: 60000 });
  const out = await download(p, () => p.getByText("⬇ Download").click());
  assert.equal((await PDFDocument.load(readFileSync(out.path))).getPageCount(), 5);
});

await scenario("PDF: protect then unlock round-trip with wrong/missing password handling", async (p) => {
  await p.goto(`${BASE}/tool/pdf`);
  await p.locator("button.panel", { hasText: "Protect PDF" }).click();
  await p.locator("input[type=file]").setInputFiles(fixtures.a);
  await p.locator("input[type=password]").fill("pw1 é");
  await p.locator(".pb .btn", { hasText: "Protect PDF" }).last().click();
  await p.getByText("Done ·").waitFor({ timeout: 60000 });
  const prot = await download(p, () => p.getByText("⬇ Download").click());
  const enc = readFileSync(prot.path);
  assert.ok(enc.toString("latin1").includes("/Encrypt"));
  await assert.rejects(PDFDocument.load(enc));
  await p.getByText("← All PDF tools").click();
  await p.locator("button.panel", { hasText: "Unlock PDF" }).click();
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
  await p.locator("button.panel", { hasText: "Compare PDF" }).click();
  const ins = p.locator("input[type=file]");
  await ins.nth(0).setInputFiles(fixtures.c1); await ins.nth(1).setInputFiles(fixtures.c2);
  await p.getByRole("button", { name: "Compare", exact: true }).click();
  await p.getByText("1 of 2 pages differ").waitFor({ timeout: 60000 });
  assert.match(await p.locator(".note.i").first().innerText(), /\+2 words added.*1 removed/s);

  await p.goto(`${BASE}/tool/pdf`);
  await p.locator("button.panel", { hasText: "Remove pages" }).click();
  await p.locator("input[type=file]").setInputFiles(fixtures.a);
  await p.getByRole("button", { name: "Page 2" }).click();
  assert.equal(await p.getByPlaceholder("1-3, 5").inputValue(), "2");

  await p.goto(`${BASE}/tool/pdf`);
  await p.locator("button.panel", { hasText: "Sign PDF" }).click();
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
  await p.locator("button.panel", { hasText: "PDF to JPG" }).click();
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
  await p.getByText("Found in 1 breach").waitFor();
  assert.ok(await p.getByText("SENSITIVE").count() >= 1);
  await p.getByRole("tab", { name: "Password check" }).click();
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
  await p.getByRole("button", { name: "Check my IP & IPv6" }).click();
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

await scenario("Phone: validity and line type from libphonenumber", async (p) => {
  await p.goto(`${BASE}/tool/phone?n=${encodeURIComponent("+44 20 7183 8750")}`);
  await p.getByText("Valid number · Landline").waitFor({ timeout: 15000 });
});

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
