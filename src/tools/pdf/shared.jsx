import { useRef, useEffect, useState, useId } from "react";
import { FileUp, FileText, FileImage, ShieldCheck } from "lucide-react";
import { Notice } from "../../components/ui.jsx";

export const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

export async function readFile(f) { return new Uint8Array(await f.arrayBuffer()); }

const accepts = (accept, f) => accept.split(",").includes(f.type) || (accept.includes("pdf") && /\.pdf$/i.test(f.name));

/** Single-file picker: a compact drop target that names the chosen file. */
export function FilePick({ label, accept = "application/pdf", file, onFile, hint }) {
  const ref = useRef(null);
  const id = useId();
  const [over, setOver] = useState(false);
  const [bad, setBad] = useState("");
  const pdf = accept.includes("pdf");
  const take = (f) => { if (!f) return; if (!accepts(accept, f)) { setBad(`${f.name} isn't ${pdf ? "a PDF" : "a PNG or JPG image"}.`); return; } setBad(""); onFile(f); };
  return (
    <div className="field pdfw-pick">
      <div className="lbl" id={`${id}-l`}>{label}</div>
      <button type="button" className={`pdfw-pickbtn${over ? " is-over" : ""}${file ? " has-file" : ""}`} onClick={() => ref.current?.click()}
        aria-label={file ? `${label}: ${file.name} selected — choose a different file` : `${label}: choose a file`}
        aria-describedby={bad ? `${id}-e` : undefined}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}>
        {file ? (pdf ? <FileText aria-hidden="true" /> : <FileImage aria-hidden="true" />) : <FileUp aria-hidden="true" />}
        <span className="pdfw-pickname">{file ? file.name : pdf ? "Choose PDF" : "Choose image"}</span>
        <span className="pdfw-picksub">{file ? `${kb(file.size)} · change` : "or drop it here"}</span>
      </button>
      <input ref={ref} type="file" accept={accept} hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
      {bad && <div className="err-tx" id={`${id}-e`} role="alert">{bad}</div>}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Live status line + bar. value in 0..1 → determinate; null → indeterminate. */
export function Progress({ label, value }) {
  const pct = value == null ? null : Math.max(2, Math.min(100, Math.round(value * 100)));
  return (
    <div className="pdfw-progress" role="status" aria-live="polite">
      <div className="pdfw-progtx"><span>{label}</span>{pct != null && <span className="pdfw-pct">{pct}%</span>}</div>
      <div className={`prog${pct == null ? " ind" : ""}`} aria-hidden="true"><i style={pct == null ? undefined : { width: `${pct}%` }} /></div>
    </div>
  );
}

/** "Page 3 of 10…" → 0.3, so progress strings from the libs drive a determinate bar. */
export const fraction = (s) => { const m = /(\d+) of (\d+)/.exec(s || ""); return m && +m[2] ? +m[1] / +m[2] : null; };

/** Download list that owns (and revokes) its object URLs. */
export function Results({ items }) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    const u = items.map((i) => URL.createObjectURL(i.blob));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [items]);
  if (!items.length) return null;
  return (
    <section className="pdfw-out" aria-label="Results">
      <Notice tone="ok" className="pdfw-done" role="status" title="Done · ">{items.length} file{items.length > 1 ? "s" : ""} ready to download</Notice>
      <ul className="pdfw-files">
        {items.map((it, i) => (
          <li key={it.name} className="pdfw-file">
            <FileText className="pdfw-fic" aria-hidden="true" />
            <span className="pdfw-fmeta"><span className="pdfw-fname" title={it.name}>{it.name}</span><span className="pdfw-fsub">{kb(it.blob.size)}</span></span>
            {urls[i] && <a className="btn sm pdfw-dl" href={urls[i]} download={it.name}>⬇ Download</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Slim sub-tool header: back control, name, one-line hint. The page h1 belongs to the ToolShell. */
export function SubHead({ icon: Icon, title, desc, onBack }) {
  return (
    <header className="pdfw-head">
      <button type="button" className="btn gh sm pdfw-back" onClick={onBack}>← All PDF tools</button>
      <div className="pdfw-title">
        {Icon && <span className="pdfw-tico" aria-hidden="true"><Icon /></span>}
        <div className="pdfw-ttx"><h2>{title}</h2><p>{desc}</p></div>
      </div>
    </header>
  );
}

export function LocalNote() {
  return <span className="pdfw-local"><ShieldCheck aria-hidden="true" />Stays on this device</span>;
}

export function Shell({ icon, title, desc, onBack, children, wide }) {
  return (
    <div className={`pdfw${wide ? " wide" : ""}`}>
      <SubHead icon={icon} title={title} desc={desc} onBack={onBack} />
      <div className="panel"><div className="pb">{children}</div></div>
    </div>
  );
}
