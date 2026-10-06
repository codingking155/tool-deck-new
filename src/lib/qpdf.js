/* PDF encryption / decryption with qpdf compiled to WebAssembly (Apache-2.0).
   Runs entirely in the browser. `rt` lets callers/tests supply how the engine and wasm are located. */

/** rt = { factory?, env? }. In Node the package's own entry works; the browser build must pass `factory` (see browserQpdfFactory). */
export async function loadQpdf(rt = {}) {
  const create = rt.factory || (await import("@jspawn/qpdf-wasm")).default;
  const err = [];
  const mod = await create({ print: () => {}, printErr: (s) => err.push(String(s)), ...(rt.env || {}) });
  return { mod, err };
}

let factoryPromise = null;
/** Bundlers break the package's ES wrapper (it relies on a global). Load the Emscripten script as a classic script instead
    and read the factory it registers on `exports`, exactly as the wrapper does. */
export function browserQpdfFactory(scriptUrl) {
  if (!factoryPromise) {
    factoryPromise = new Promise((resolve, reject) => {
      const prev = globalThis.exports;
      globalThis.exports = {};
      const s = document.createElement("script");
      s.src = scriptUrl;
      const restore = () => { if (prev === undefined) delete globalThis.exports; else globalThis.exports = prev; };
      s.onload = () => { const f = globalThis.exports.Module; restore(); f ? resolve(f) : reject(new Error("The encryption engine did not initialise.")); };
      s.onerror = () => { restore(); reject(new Error("Couldn't load the encryption engine.")); };
      document.head.appendChild(s);
    }).catch((e) => { factoryPromise = null; throw e; });
  }
  return factoryPromise;
}

function call({ mod, err }, args) {
  err.length = 0;
  try { return mod.callMain(args); } catch (e) { return typeof e?.status === "number" ? e.status : 2; }
}

function run(q, args) {
  const { err } = q;
  const rc = call(q, args);
  // qpdf exits 3 for "completed with warnings" — output is still valid.
  if (rc !== 0 && rc !== 3) throw new Error(err.join(" ").trim() || `qpdf failed (exit ${rc}).`);
}

const randomPassword = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** AES-256 encryption. A user password is required to open; restrictions apply on top (and are enforced by a random owner password if none is given). */
export async function protectPdf(bytes, { userPassword = "", ownerPassword = "", allowPrint = true, allowCopy = true, allowModify = true } = {}, rt) {
  if (!userPassword && allowPrint && allowCopy && allowModify) throw new Error("Set a password or turn off at least one permission.");
  const q = await loadQpdf(rt);
  q.mod.FS.writeFile("in.pdf", bytes);
  const args = ["--encrypt", userPassword, ownerPassword || randomPassword(), "256",
    `--print=${allowPrint ? "full" : "none"}`, `--extract=${allowCopy ? "y" : "n"}`, `--modify=${allowModify ? "all" : "none"}`,
    "--", "in.pdf", "out.pdf"];
  run(q, args);
  return q.mod.FS.readFile("out.pdf");
}

/** Removes encryption and restrictions. `password` is only needed if the PDF requires one to open. */
export async function unlockPdf(bytes, password = "", rt) {
  const q = await loadQpdf(rt);
  q.mod.FS.writeFile("in.pdf", bytes);
  const pw = password ? [`--password=${password}`] : [];
  // --requires-password exits 3 when the file opens with the given password (or none). Any other result means
  // either "needs a password" or "not encrypted"; the /Encrypt marker tells those apart.
  const opens = call(q, [...pw, "--requires-password", "in.pdf"]) === 3;
  if (!opens && new TextDecoder("latin1").decode(bytes).includes("/Encrypt")) {
    throw new Error(password ? "That password is incorrect." : "This PDF needs a password to open. Enter it and try again.");
  }
  run(q, [...pw, "--decrypt", "in.pdf", "out.pdf"]);
  return q.mod.FS.readFile("out.pdf");
}
