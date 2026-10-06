import { useRef, useEffect, useState } from "react";

export const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

export async function readFile(f) { return new Uint8Array(await f.arrayBuffer()); }

export function FilePick({ label, accept = "application/pdf", file, onFile, hint }) {
  const ref = useRef(null);
  return (
    <div className="field">
      <label>{label}</label>
      <button type="button" className="btn gh" style={{ width: "100%", justifyContent: "center" }} onClick={() => ref.current?.click()}
        aria-label={file ? `${label}: ${file.name} selected — choose a different file` : `${label}: choose a file`}>
        {file ? `${file.name} · ${kb(file.size)} — change` : "Choose a file"}
      </button>
      <input ref={ref} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

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
    <div style={{ marginTop: 16 }}>
      <div className="note i"><b>Done · </b>{items.length} file{items.length > 1 ? "s" : ""}</div>
      {items.map((it, i) => (
        <div key={it.name} className="kv" style={{ alignItems: "center", gap: 8, marginTop: 8 }}>
          <span className="k" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</span>
          <span className="v">{kb(it.blob.size)}</span>
          {urls[i] && <a className="pill" style={{ textDecoration: "none" }} href={urls[i]} download={it.name}>⬇ Download</a>}
        </div>
      ))}
    </div>
  );
}

export function Shell({ title, desc, onBack, children }) {
  return (
    <div className="panel rise d1" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="ph">
        <button className="btn gh" onClick={onBack} style={{ float: "right" }}>← All PDF tools</button>
        <h2>{title}</h2><p>{desc}</p>
      </div>
      <div className="pb">{children}</div>
    </div>
  );
}
