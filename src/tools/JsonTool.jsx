import { useState, useMemo, useRef, useDeferredValue } from "react";
import {
  parseJSON, repairJSON, formatJSON, minifyJSON, toYAML, toCSV, toTypeScript, toJSONSchema,
  queryPath, stats, innerJSON,
} from "../lib/jsonCore.js";
import { formatBytes } from "../lib/pageRanges.js";
import { saveBlob } from "../lib/zip.js";
import CodeEditor from "../components/CodeEditor.jsx";
import { JsonTree, JsonDiff } from "./JsonParts.jsx";

const SAMPLE = `{
  "orderId": 98765432109876543210,
  "status": "shipped",
  "customer": { "id": 42, "name": "Asha Rao", "email": "asha@example.com" },
  "items": [
    { "id": 1, "sku": "TEA-500", "qty": 2, "price": 349.5 },
    { "id": 2, "sku": "MUG-01", "qty": 1, "price": 199, "gift": true }
  ],
  "notes": null
}`;
const SAMPLE_B = `{
  "orderId": 98765432109876543210,
  "status": "delivered",
  "customer": { "id": 42, "name": "Asha Rao", "phone": "+91 98450 00000" },
  "items": [
    { "id": 2, "sku": "MUG-01", "qty": 2, "price": 199, "gift": true },
    { "id": 1, "sku": "TEA-500", "qty": 2, "price": 349.5 },
    { "id": 3, "sku": "SPOON", "qty": 1, "price": 49 }
  ]
}`;

const MODES = [
  ["format", "Beautify"],
  ["minify", "Minify"],
  ["tree", "Tree"],
  ["path", "Query"],
  ["diff", "Compare"],
  ["convert", "Convert"],
];
const CONVERTERS = {
  yaml: ["YAML", "yaml", "text/yaml"],
  csv: ["CSV (array of objects)", "csv", "text/csv"],
  ts: ["TypeScript interfaces", "ts", "text/plain"],
  schema: ["JSON Schema", "schema.json", "application/schema+json"],
  string: ["Escaped string (for embedding)", "txt", "text/plain"],
};
const PATH_EXAMPLES = ["$.items[*].sku", "$..id", "$.items[-1]", "$.customer.*"];
const bytes = (s) => new TextEncoder().encode(s).length;

async function copyText(text, notify, what = "Copied") {
  try { await navigator.clipboard.writeText(text); notify(what); }
  catch { notify("Copy failed — select the text and copy manually"); }
}

function ErrorBox({ parsed, repair, onJump, onRepair }) {
  const e = parsed.error;
  return (
    <div className="note w" style={{ marginBottom: 0 }}>
      <b>Invalid JSON{e.line ? ` · line ${e.line}, column ${e.col}` : ""} · </b>{e.message}
      <div className="pillrow" style={{ marginTop: 8 }}>
        {e.pos != null && <button className="pill" onClick={onJump}>Jump to error</button>}
        {repair?.ok && <button className="pill" onClick={onRepair} style={{ color: "var(--pri2)", borderColor: "var(--pri-line)" }}>✨ Auto-fix ({repair.fixes.length} fix{repair.fixes.length === 1 ? "" : "es"})</button>}
      </div>
      {repair?.ok && <div className="hint" style={{ marginTop: 6 }}>Will apply: {repair.fixes.join(" · ")}</div>}
      {repair && !repair.ok && <div className="hint" style={{ marginTop: 6 }}>Auto-fix can't repair this one: {repair.error.message}{repair.error.line ? ` (line ${repair.error.line})` : ""}.</div>}
    </div>
  );
}

/* Browsers take seconds to lay out multi-MB textareas, so big results show a
   preview; Copy and Download always use the full text. */
const PREVIEW_CHARS = 400000;
function previewOf(text) {
  if (text.length <= PREVIEW_CHARS) return { text, cut: false };
  const nl = text.lastIndexOf("\n", PREVIEW_CHARS);
  return { text: `${text.slice(0, nl > PREVIEW_CHARS / 2 ? nl : PREVIEW_CHARS)}\n…`, cut: true };
}

function OutputActions({ text, file, notify }) {
  return (
    <>
      <div className="hint" style={{ marginBottom: 12 }}>{formatBytes(bytes(text))}</div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn pri" onClick={() => copyText(text, notify)}>Copy</button>
        <button className="btn gh" style={{ whiteSpace: "nowrap" }} onClick={() => saveBlob(new Blob([text], { type: file[1] }), file[0])}>Download</button>
      </div>
    </>
  );
}

function buildOutput(v, { mode, indent, sortKeys, path, conv, rootName }) {
  if (mode === "format") return { text: formatJSON(v, indent, sortKeys), file: ["data.json", "application/json"] };
  if (mode === "minify") return { text: minifyJSON(v, sortKeys), file: ["data.min.json", "application/json"] };
  if (mode === "path") {
    const q = queryPath(v, path);
    if (!q.ok) return { note: q.error };
    if (!q.matches.length) return { note: "No match for this path." };
    return { text: formatJSON(q.matches.length === 1 ? q.matches[0] : q.matches, 2), count: q.matches.length, file: ["query.json", "application/json"] };
  }
  const [, ext, type] = CONVERTERS[conv];
  if (conv === "yaml") return { text: toYAML(v), file: [`data.${ext}`, type] };
  if (conv === "csv") {
    const csv = toCSV(v);
    return csv == null ? { note: "CSV needs a top-level array of objects, e.g. [{\"a\":1},{\"a\":2}]. Tip: use Query to pick one out, e.g. $.items." } : { text: csv, file: [`data.${ext}`, type] };
  }
  if (conv === "ts") return { text: toTypeScript(v, /^[A-Za-z_$][\w$]*$/.test(rootName) ? rootName : "Root"), file: [`types.${ext}`, type] };
  if (conv === "schema") return { text: JSON.stringify(toJSONSchema(v), null, 2), file: [ext, type] };
  return { text: JSON.stringify(minifyJSON(v)), file: [`escaped.${ext}`, type] };
}

export default function JsonTool({ notify }) {
  const [input, setInput] = useState(SAMPLE);
  const [inputB, setInputB] = useState(SAMPLE_B);
  const [mode, setMode] = useState("format");
  const [indent, setIndent] = useState("2");
  const [sortKeys, setSortKeys] = useState(false);
  const [path, setPath] = useState("$.items[*].sku");
  const [conv, setConv] = useState("ts");
  const [rootName, setRootName] = useState("Root");
  const [undo, setUndo] = useState(null);
  const [applied, setApplied] = useState(null);
  const inputRef = useRef(null);
  const fileA = useRef(null), fileB = useRef(null);

  const dInput = useDeferredValue(input);
  const dInputB = useDeferredValue(inputB);
  const parsed = useMemo(() => parseJSON(dInput), [dInput]);
  const parsedB = useMemo(() => (mode === "diff" ? parseJSON(dInputB) : null), [dInputB, mode]);
  const repair = useMemo(() => (!parsed.ok && !parsed.empty ? repairJSON(dInput) : null), [parsed, dInput]);
  const info = useMemo(() => { try { return parsed.ok ? stats(parsed.value, dInput) : null; } catch { return null; } }, [parsed, dInput]);
  const inner = useMemo(() => { try { return parsed.ok ? innerJSON(parsed.value) : null; } catch { return null; } }, [parsed]);

  const out = useMemo(() => {
    if (!parsed.ok || mode === "tree" || mode === "diff") return null;
    try { return buildOutput(parsed.value, { mode, indent, sortKeys, path, conv, rootName }); }
    catch (e) { return { note: `Couldn't produce this output: ${e?.message || e}` }; }
  }, [parsed, mode, indent, sortKeys, path, conv, rootName]);

  const shownOut = useMemo(() => (out?.text != null ? previewOf(out.text) : null), [out]);

  const replaceInput = (next, msg) => {
    setUndo(input);
    setInput(next);
    if (msg) notify(msg);
  };
  const onType = (e) => { setInput(e.target.value); setUndo(null); setApplied(null); };

  const jumpToError = () => {
    const el = inputRef.current;
    const pos = parsed.error?.pos;
    if (!el || pos == null) return;
    el.focus();
    el.setSelectionRange(pos, Math.min(pos + 1, input.length));
    const line = parsed.error.line || 1;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    el.scrollTop = Math.max(0, (line - 4) * lh);
  };

  const doRepair = () => {
    if (!repair?.ok) return;
    replaceInput(formatJSON(repair.value, indent), "JSON repaired");
    setApplied(repair.fixes);
  };

  const beautifyInPlace = () => {
    if (parsed.ok) replaceInput(formatJSON(parsed.value, indent, sortKeys), "Beautified");
    else if (repair?.ok) doRepair();
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); beautifyInPlace(); }
  };

  const loadFile = (file, setter) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { notify("That file is over 25 MB — too large to edit in the browser"); return; }
    file.text().then((t) => { setter(t); setUndo(null); setApplied(null); }).catch(() => notify("Couldn't read that file — is it a text file?"));
  };

  const pending = dInput !== input;
  /* Only take over drops that carry files; dropped text keeps the browser's default insert. */
  const dropTo = (setter) => (e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); loadFile(e.dataTransfer.files[0], setter); } };

  return (
    <div>
      <div className="modes" role="group" aria-label="Output">
        {MODES.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{label}</button>
        ))}
      </div>

      <div className="grid2">
        <div className="panel rise d1">
          <div className="ph"><h2>{mode === "diff" ? "Original (A)" : "Input"}</h2><p>Paste, drop or open a file. <kbd>Ctrl/⌘ + Enter</kbd> beautifies in place.</p></div>
          <div className="pb">
            <CodeEditor id="json-in" label="JSON input" value={input} onChange={onType} taRef={inputRef} onKeyDown={onKeyDown}
              errorLine={!parsed.ok && !pending ? parsed.error?.line : null} placeholder='{"paste": "JSON here"}'
              onDrop={dropTo(setInput)} />
            <div style={{ marginTop: 10 }}>
              {parsed.ok ? (
                <div className="hint" style={{ color: "var(--good)", marginTop: 0 }}>
                  ✓ Valid JSON{info && <> · {info.keys.toLocaleString()} keys · {info.nodes.toLocaleString()} values · depth {info.depth} · {formatBytes(info.bytes)}</>}
                </div>
              ) : parsed.empty ? (
                <div className="hint" style={{ marginTop: 0 }}>{parsed.error.message}</div>
              ) : (
                <ErrorBox parsed={parsed} repair={repair} onJump={jumpToError} onRepair={doRepair} />
              )}
              {applied && (
                <div className="note i" style={{ marginTop: 10, marginBottom: 0 }}>
                  <b>Repaired · </b>{applied.join(" · ")}. Check the result — fixes are best guesses.
                </div>
              )}
              {parsed.ok && parsed.bigNumbers > 0 && (
                <div className="note i" style={{ marginTop: 10, marginBottom: 0 }}>
                  <b>{parsed.bigNumbers} large number{parsed.bigNumbers === 1 ? "" : "s"} kept exactly · </b>
                  Values like IDs beyond 2⁵³ are rounded by JavaScript's JSON.parse. This tool preserves their original digits in every output.
                </div>
              )}
              {inner && (
                <div className="note i" style={{ marginTop: 10, marginBottom: 0 }}>
                  <b>This is JSON inside a string · </b>
                  <button className="pill" onClick={() => replaceInput(formatJSON(inner.value, indent), "Unwrapped")}>Unwrap it</button>
                </div>
              )}
            </div>
            <div className="pillrow" style={{ marginTop: 12 }}>
              <button type="button" className="pill" onClick={() => fileA.current?.click()}>Open file</button>
              <input ref={fileA} type="file" accept=".json,.ndjson,.jsonl,.txt,.map,application/json,text/plain" hidden onChange={(e) => { loadFile(e.target.files[0], setInput); e.target.value = ""; }} />
              <button className="pill" onClick={() => replaceInput(SAMPLE)}>Sample</button>
              <button className="pill" onClick={() => replaceInput("")}>Clear</button>
              {parsed.ok && <button className="pill" onClick={beautifyInPlace}>Beautify input</button>}
              {parsed.ok && <button className="pill" onClick={() => replaceInput(minifyJSON(parsed.value), "Minified")}>Minify input</button>}
              {parsed.ok && !sortKeys && <button className="pill" onClick={() => replaceInput(formatJSON(parsed.value, indent, true), "Keys sorted")}>Sort keys</button>}
              {undo !== null && <button className="pill" onClick={() => { setInput(undo); setUndo(null); setApplied(null); }}>↶ Undo</button>}
            </div>
          </div>
        </div>

        <div className="panel rise d2">
          {mode === "diff" ? (
            <>
              <div className="ph"><h2>Changed (B)</h2><p>Paste the version to compare against A.</p></div>
              <div className="pb">
                <CodeEditor id="json-b" label="JSON to compare" value={inputB} onChange={(e) => setInputB(e.target.value)} height={240}
                  errorLine={parsedB && !parsedB.ok ? parsedB.error?.line : null}
                  onDrop={dropTo(setInputB)} />
                <div className="pillrow" style={{ marginTop: 10 }}>
                  <button type="button" className="pill" onClick={() => fileB.current?.click()}>Open file</button>
                  <input ref={fileB} type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => { loadFile(e.target.files[0], setInputB); e.target.value = ""; }} />
                  <button className="pill" onClick={() => { const a = input; setInput(inputB); setInputB(a); }}>⇄ Swap A and B</button>
                </div>
                {!parsed.ok ? <div className="empty">Fix A to compare.</div>
                  : parsedB && !parsedB.ok ? <div className="note w" style={{ marginTop: 12 }}><b>B is invalid{parsedB.error.line ? ` · line ${parsedB.error.line}` : ""} · </b>{parsedB.error.message}</div>
                  : parsedB && <JsonDiff a={parsed.value} b={parsedB.value} notify={notify} />}
              </div>
            </>
          ) : (
            <>
              <div className="ph">
                <h2>{mode === "tree" ? "Tree" : "Output"}</h2>
                <p>{mode === "path" ? "Pick values with JSONPath-style queries." : mode === "tree" ? "Browse, search and copy paths." : mode === "convert" ? "Generate types, schemas and other formats." : "Updates live."}</p>
              </div>
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
                        <option value="keep">Original order</option><option value="sort">Sort A → Z (deep)</option>
                      </select>
                    </div>
                  </div>
                )}
                {mode === "path" && (
                  <div className="field">
                    <label htmlFor="json-path">Path</label>
                    <input id="json-path" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} autoCapitalize="off" placeholder="$.users[0].name" />
                    <div className="pillrow" style={{ marginTop: 8 }}>
                      {PATH_EXAMPLES.map((p) => <button key={p} className="pill" onClick={() => setPath(p)}>{p}</button>)}
                    </div>
                    <div className="hint"><code>.key</code> child · <code>[0]</code> / <code>[-1]</code> index · <code>[*]</code> or <code>.*</code> every child · <code>..key</code> search all depths · <code>['a b']</code> keys with spaces</div>
                  </div>
                )}
                {mode === "convert" && (
                  <div className={conv === "ts" ? "two" : ""}>
                    <div className="field">
                      <label htmlFor="json-conv">Convert to</label>
                      <select id="json-conv" value={conv} onChange={(e) => setConv(e.target.value)}>
                        {Object.entries(CONVERTERS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </div>
                    {conv === "ts" && (
                      <div className="field">
                        <label htmlFor="json-root">Root type name</label>
                        <input id="json-root" value={rootName} onChange={(e) => setRootName(e.target.value)} spellCheck={false} autoCapitalize="off" />
                      </div>
                    )}
                  </div>
                )}

                {!parsed.ok ? (
                  <div className="empty">{parsed.empty ? "Paste JSON on the left to start." : "Fix the input to see the output — or try ✨ Auto-fix."}</div>
                ) : mode === "tree" ? (
                  <JsonTree value={parsed.value} notify={notify} onQuery={(p) => { setPath(p); setMode("path"); }} />
                ) : out.note ? (
                  <div className="note i"><b>Note · </b>{out.note}</div>
                ) : (
                  <>
                    {out.count > 1 && <div className="hint" style={{ margin: "0 0 8px" }}>{out.count.toLocaleString()} matches</div>}
                    <CodeEditor id="json-out" label="Output" value={shownOut.text} readOnly height={mode === "format" || mode === "minify" ? 330 : 300} />
                    {shownOut.cut && <div className="hint">Large result — showing a preview. Copy and Download include everything.</div>}
                    {mode === "minify" && info && (
                      <div className="hint">{Math.max(0, Math.round((1 - bytes(out.text) / info.bytes) * 100))}% smaller than the input</div>
                    )}
                    <div style={{ marginTop: 6 }}><OutputActions text={out.text} file={out.file} notify={notify} /></div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
