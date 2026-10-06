import { useState } from "react";
import { FilePick, Results, Shell, readFile } from "./shared.jsx";

const LANGS = [["eng", "English"], ["spa", "Spanish"], ["fra", "French"], ["deu", "German"], ["ita", "Italian"], ["por", "Portuguese"],
  ["nld", "Dutch"], ["hin", "Hindi"], ["kan", "Kannada"], ["tam", "Tamil"], ["ara", "Arabic"], ["rus", "Russian"], ["chi_sim", "Chinese (Simplified)"], ["jpn", "Japanese"]];

export default function OcrPdf({ notify, onBack }) {
  const [file, setFile] = useState(null);
  const [lang, setLang] = useState("eng");
  const [busy, setBusy] = useState("");
  const [out, setOut] = useState([]);

  const run = async () => {
    if (!file) return notify("Choose a PDF first.");
    setOut([]); setBusy("Loading OCR engine…");
    try {
      const { ocrPdf } = await import("../../lib/pdfRender.js");
      const bytes = await readFile(file);
      const r = await ocrPdf(bytes, { lang, onProgress: (i, n) => setBusy(`Reading page ${i} of ${n}…`) });
      const base = file.name.replace(/\.[^.]+$/, "");
      setOut([
        { name: `${base}-searchable.pdf`, blob: new Blob([r.pdf], { type: "application/pdf" }) },
        { name: `${base}.txt`, blob: new Blob([r.text], { type: "text/plain" }) },
      ]);
      if (!r.text) notify("Finished, but no text was recognised. Try another language.");
    } catch (e) {
      const msg = String(e?.message || e || "");
      notify(/importScripts|failed to load|fetch|network|traineddata/i.test(msg)
        ? "Couldn't load the OCR engine or language data. Check your connection and try again."
        : `OCR failed: ${msg || "unknown error"}`);
    } finally { setBusy(""); }
  };

  return (
    <Shell title="🔎 OCR PDF" desc="Turn a scanned PDF into a searchable one, plus a plain-text export." onBack={onBack}>
      <FilePick label="Scanned PDF" file={file} onFile={(f) => { setFile(f); setOut([]); }} />
      <div className="field"><label htmlFor="ocrlang">Language of the document</label>
        <select id="ocrlang" value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
      <button className="btn" style={{ width: "100%" }} disabled={!file || !!busy} onClick={run}>{busy || "Run OCR"}</button>
      <Results items={out} />
      <div className="note i" style={{ marginTop: 16 }}>
        <b>How it works · </b>your PDF is read on your device. The first run downloads the language model (a few MB) from the OCR engine's CDN.
        Output pages are image-based, so file size grows, and recognition quality depends on scan quality.
      </div>
    </Shell>
  );
}
