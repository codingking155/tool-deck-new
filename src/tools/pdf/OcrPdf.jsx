import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Notice } from "../../components/ui.jsx";
import { FilePick, Results, Shell, Progress, fraction, readFile } from "./shared.jsx";

const LANGS = [["eng", "English"], ["spa", "Spanish"], ["fra", "French"], ["deu", "German"], ["ita", "Italian"], ["por", "Portuguese"],
  ["nld", "Dutch"], ["hin", "Hindi"], ["kan", "Kannada"], ["tam", "Tamil"], ["ara", "Arabic"], ["rus", "Russian"], ["chi_sim", "Chinese (Simplified)"], ["jpn", "Japanese"]];

export default function OcrPdf({ notify, onBack, icon }) {
  const [file, setFile] = useState(null);
  const [lang, setLang] = useState("eng");
  const [busy, setBusy] = useState("");
  const [out, setOut] = useState([]);
  const [error, setError] = useState("");

  const run = async () => {
    if (!file) return notify("Choose a PDF first.");
    setOut([]); setError(""); setBusy("Loading OCR engine…");
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
      const m = /importScripts|failed to load|fetch|network|traineddata/i.test(msg)
        ? "Couldn't load the OCR engine or language data. Check your connection and try again."
        : `OCR failed: ${msg || "unknown error"}`;
      notify(m); setError(m);
    } finally { setBusy(""); }
  };

  return (
    <Shell icon={icon} title="OCR PDF" desc="Turn a scanned PDF into a searchable one, plus a plain-text export." onBack={onBack}>
      <FilePick label="Scanned PDF" file={file} onFile={(f) => { setFile(f); setOut([]); setError(""); }} />
      <div className="field"><label htmlFor="ocrlang">Language of the document</label>
        <select id="ocrlang" value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
      <div className="pdfw-act">
        <button className="btn pri" disabled={!file || !!busy} onClick={run}>
          {busy ? <><LoaderCircle className="spin" aria-hidden="true" />Working…</> : "Run OCR"}
        </button>
        {busy && <Progress label={busy} value={fraction(busy)} />}
      </div>
      {error && !busy && (
        <Notice tone="w" role="status" title={error}>
          {/connection/.test(error) ? "Only the OCR engine is downloaded — your PDF stays on this device." : "Try a different language, or a cleaner scan of the document."}
        </Notice>
      )}
      <Results items={out} />
      <Notice tone="i" title="How it works" className="pdfw-foot">
        Your PDF is read on your device and never uploaded. The OCR engine (tesseract.js) and its language model — several MB —
        are downloaded from a public CDN (jsDelivr) on first use, so the first run needs a connection.
        Output pages are image-based, so file size grows, and recognition quality depends on scan quality.
      </Notice>
    </Shell>
  );
}
