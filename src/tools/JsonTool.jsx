import { useState, useMemo, useRef } from "react";
import { parseJSON, formatJSON, minifyJSON, toYAML, toCSV, queryPath, stats } from "../lib/jsonCore.js";
import { formatBytes } from "../lib/pageRanges.js";

const SAMPLE = '{"users":[{"id":1,"name":"Asha","roles":["admin","editor"],"active":true},{"id":2,"name":"Ravi","roles":[],"active":false}],"total":2}';

const MODES = [
  ["format", "Beautify"],
  ["minify", "Minify"],
  ["yaml", "YAML"],
  ["csv", "CSV"],
  ["path", "Query"],
];

function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function JsonTool({ notify }) {
  const [input, setInput] = useState(SAMPLE);
  const [mode, setMode] = useState("format");
  const [indent, setIndent] = useState("2");
  const [sortKeys, setSortKeys] = useState(false);
  const [path, setPath] = useState("$.users[*].name");
  const inputRef = useRef(null);

  const parsed = useMemo(() => parseJSON(input), [input]);

  const out = useMemo(() => {
    if (!parsed.ok) return { text: "", note: null };
    const v = parsed.value;
    if (mode === "format") return { text: formatJSON(v, indent, sortKeys), ext: "json", type: "application/json" };
    if (mode === "minify") return { text: minifyJSON(v, sortKeys), ext: "json", type: "application/json" };
    if (mode === "yaml") return { text: toYAML(v), ext: "yaml", type: "text/yaml" };
    if (mode === "csv") {
      const csv = toCSV(v);
      return csv == null ? { text: "", note: "CSV needs an array of objects, e.g. [{\"a\":1},{\"a\":2}]." } : { text: csv, ext: "csv", type: "text/csv" };
    }
    const q = queryPath(v, path);
    if (!q.ok) return { text: "", note: q.error };
    if (!q.matches.length) return { text: "", note: "No match for this path." };
    return { text: formatJSON(q.matches.length === 1 ? q.matches[0] : q.matches, 2), ext: "json", type: "application/json", count: q.matches.length };
  }, [parsed, mode, indent, sortKeys, path]);

  const info = parsed.ok ? stats(parsed.value, input) : null;

  const jumpToError = () => {
    const el = inputRef.current;
    if (!el || parsed.error?.pos == null) return;
    el.focus();
    el.setSelectionRange(parsed.error.pos, Math.min(parsed.error.pos + 1, input.length));
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(out.text); notify("Copied"); }
    catch { notify("Copy failed — select the text and copy manually"); }
  };

  const pasteFile = (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { notify("That file is over 20 MB — too large to edit in the browser"); return; }
    file.text().then(setInput);
  };

  return (
    <div>
      <div className="modes" role="tablist" aria-label="Output">
        {MODES.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{label}</button>
        ))}
      </div>

      <div className="grid2">
        <div className="panel rise d1">
          <div className="ph"><h3>Input</h3><p>Paste JSON, or open a .json file. Checked as you type.</p></div>
          <div className="pb">
            <div className="field" style={{ marginBottom: 10 }}>
              <label htmlFor="json-in" className="sr-only">JSON input</label>
              <textarea id="json-in" ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                spellCheck={false} placeholder='{"example": true}' style={{ height: 380 }}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pasteFile(e.dataTransfer.files[0]); }} />
            </div>
            {parsed.ok ? (
              <div className="hint" style={{ color: "var(--good)" }}>
                ✓ Valid JSON · {info.keys.toLocaleString()} keys · depth {info.depth} · {formatBytes(info.bytes)}
              </div>
            ) : parsed.empty ? (
              <div className="hint">{parsed.error.message}</div>
            ) : (
              <div className="note w" style={{ marginBottom: 0 }}>
                <b>Invalid JSON{parsed.error.line ? ` · line ${parsed.error.line}, column ${parsed.error.col}` : ""} · </b>
                {parsed.error.message}
                {parsed.error.pos != null && (
                  <div><button className="pill" style={{ marginTop: 8 }} onClick={jumpToError}>Jump to error</button></div>
                )}
              </div>
            )}
            <div className="pillrow" style={{ marginTop: 12 }}>
              <label className="pill" style={{ cursor: "pointer" }}>
                Open file
                <input type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => { pasteFile(e.target.files[0]); e.target.value = ""; }} />
              </label>
              <button className="pill" onClick={() => setInput(SAMPLE)}>Sample</button>
              <button className="pill" onClick={() => setInput("")}>Clear</button>
              {parsed.ok && <button className="pill" onClick={() => setInput(formatJSON(parsed.value, indent, sortKeys))}>Beautify input in place</button>}
            </div>
          </div>
        </div>

        <div className="panel rise d2">
          <div className="ph"><h3>Output</h3><p>{mode === "path" ? "Query with $.key, [0], [-1], [*] or ['key name']." : "Updates live."}</p></div>
          <div className="pb">
            {(mode === "format" || mode === "minify") && (
              <div className="two">
                {mode === "format" ? (
                  <div className="field">
                    <label htmlFor="json-ind">Indent</label>
                    <select id="json-ind" value={indent} onChange={(e) => setIndent(e.target.value)}>
                      <option value="2">2 spaces</option><option value="4">4 spaces</option><option value="tab">Tab</option>
                    </select>
                  </div>
                ) : <div />}
                <div className="field">
                  <label htmlFor="json-sort">Keys</label>
                  <select id="json-sort" value={sortKeys ? "sort" : "keep"} onChange={(e) => setSortKeys(e.target.value === "sort")}>
                    <option value="keep">Keep original order</option><option value="sort">Sort A → Z</option>
                  </select>
                </div>
              </div>
            )}
            {mode === "path" && (
              <div className="field">
                <label htmlFor="json-path">Path</label>
                <input id="json-path" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} placeholder="$.users[0].name" />
              </div>
            )}

            {!parsed.ok ? (
              <div className="empty">Fix the input to see the output.</div>
            ) : out.note ? (
              <div className="note i"><b>Note · </b>{out.note}</div>
            ) : (
              <>
                <div className="field" style={{ marginBottom: 10 }}>
                  <label htmlFor="json-out" className="sr-only">Output</label>
                  <textarea id="json-out" readOnly value={out.text} spellCheck={false} style={{ height: mode === "format" || mode === "minify" ? 300 : 340 }} />
                </div>
                <div className="hint" style={{ marginBottom: 12 }}>
                  {out.count > 1 ? `${out.count} matches · ` : ""}{formatBytes(new TextEncoder().encode(out.text).length)}
                  {mode === "minify" && info ? ` · ${Math.max(0, Math.round((1 - new TextEncoder().encode(out.text).length / info.bytes) * 100))}% smaller than input` : ""}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn pri" onClick={copy}>Copy</button>
                  <button className="btn gh" style={{ whiteSpace: "nowrap" }} onClick={() => download(out.text, `data.${out.ext}`, out.type)}>Download .{out.ext}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
