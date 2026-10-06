import { useState, useMemo, useRef, useDeferredValue } from "react";
import {
  Braces, Minimize2, ListTree, TextSearch, GitCompareArrows, ArrowRightLeft, Wand2, Undo2, FolderOpen,
  FileJson, Eraser, Download, ArrowLeftRight, CircleCheck, CircleAlert, CircleDashed, Crosshair, LoaderCircle,
} from "lucide-react";
import {
  parseJSON, repairJSON, formatJSON, minifyJSON, toYAML, toCSV, toTypeScript, toJSONSchema,
  queryPath, stats, innerJSON,
} from "../lib/jsonCore.js";
import { formatBytes } from "../lib/pageRanges.js";
import { saveBlob } from "../lib/zip.js";
import CodeEditor from "../components/CodeEditor.jsx";
import { CopyButton, Notice, EmptyState } from "../components/ui.jsx";
import { JsonTree, JsonDiff } from "./JsonParts.jsx";
import "./css/json.css";

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
  ["format", "Beautify", Braces],
  ["minify", "Minify", Minimize2],
  ["tree", "Tree", ListTree],
  ["path", "Query", TextSearch],
  ["diff", "Compare", GitCompareArrows],
  ["convert", "Convert", ArrowRightLeft],
];
const CONVERTERS = {
  yaml: ["YAML", "yaml", "text/yaml", "YAML"],
  csv: ["CSV (array of objects)", "csv", "text/csv", "CSV"],
  ts: ["TypeScript interfaces", "ts", "text/plain", "TypeScript"],
  schema: ["JSON Schema", "schema.json", "application/schema+json", "JSON Schema"],
  string: ["Escaped string (for embedding)", "txt", "text/plain", "Escaped string"],
};
const PATH_EXAMPLES = ["$.items[*].sku", "$..id", "$.items[-1]", "$.customer.*"];
const OUT_LABEL = { format: "Beautified", minify: "Minified", path: "Query result", convert: "Converted", tree: "Tree" };
const bytes = (s) => new TextEncoder().encode(s).length;
const countLines = (s) => { let n = 1; for (let i = s.indexOf("\n"); i !== -1; i = s.indexOf("\n", i + 1)) n++; return n; };
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

function ErrorBox({ parsed, repair, onJump, onRepair }) {
  const e = parsed.error;
  return (
    <Notice tone="w" title={`Invalid JSON${e.line ? ` · line ${e.line}, column ${e.col}` : ""}`}
      actions={(e.pos != null || repair?.ok) && <>
        {e.pos != null && <button type="button" className="btn gh sm" onClick={onJump}><Crosshair size={15} aria-hidden="true" />Jump to error</button>}
        {repair?.ok && <button type="button" className="btn sm jx-fix" onClick={onRepair}><Wand2 size={15} aria-hidden="true" />Auto-fix ({repair.fixes.length} fix{repair.fixes.length === 1 ? "" : "es"})</button>}
      </>}>
      {e.message}
      {repair?.ok && <div className="hint">Will apply: {repair.fixes.join(" · ")}</div>}
      {repair && !repair.ok && <div className="hint">Auto-fix can't repair this one: {repair.error.message}{repair.error.line ? ` (line ${repair.error.line})` : ""}.</div>}
    </Notice>
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

/* Status line under an editor: validity (icon + word, announced), then cheap counts. */
function StatusBar({ id, text, parsed, info, pending }) {
  const lines = useMemo(() => countLines(text), [text]);
  const size = useMemo(() => (info ? info.bytes : bytes(text)), [info, text]);
  const state = pending ? "busy" : parsed.ok ? "ok" : parsed.empty ? "empty" : "bad";
  const Icon = { busy: LoaderCircle, ok: CircleCheck, empty: CircleDashed, bad: CircleAlert }[state];
  const word = { busy: "Checking…", ok: "Valid JSON", empty: "Empty", bad: "Invalid JSON" }[state];
  return (
    <div className={`jx-status ${state}`} id={id}>
      <span className="jx-st-v" aria-hidden="true"><Icon size={14} strokeWidth={2.4} />{word}</span>
      <span className="sr-only" role="status">{parsed.ok ? "Valid JSON" : parsed.empty ? "" : "Invalid JSON"}</span>
      {state === "bad" && parsed.error?.line ? <span>Ln {parsed.error.line}:{parsed.error.col}</span> : null}
      <span>{plural(lines, "line")}</span>
      <span>{plural(text.length, "char")}</span>
      <span>{formatBytes(size)}</span>
      {info && !pending && <><span>{plural(info.keys, "key")}</span><span>depth {info.depth}</span></>}
    </div>
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
  const infoB = useMemo(() => { try { return parsedB?.ok ? stats(parsedB.value, dInputB) : null; } catch { return null; } }, [parsedB, dInputB]);
  const inner = useMemo(() => { try { return parsed.ok ? innerJSON(parsed.value) : null; } catch { return null; } }, [parsed]);

  const out = useMemo(() => {
    if (!parsed.ok || mode === "tree" || mode === "diff") return null;
    try { return buildOutput(parsed.value, { mode, indent, sortKeys, path, conv, rootName }); }
    catch (e) { return { note: `Couldn't produce this output: ${e?.message || e}` }; }
  }, [parsed, mode, indent, sortKeys, path, conv, rootName]);

  const shownOut = useMemo(() => (out?.text != null ? previewOf(out.text) : null), [out]);
  const outBytes = useMemo(() => (out?.text != null ? bytes(out.text) : 0), [out]);

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
  const pendingB = dInputB !== inputB;
  /* Only take over drops that carry files; dropped text keeps the browser's default insert. */
  const dropTo = (setter) => (e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); loadFile(e.dataTransfer.files[0], setter); } };
  const openA = () => fileA.current?.click();
  const loadExample = () => replaceInput(SAMPLE);
  const isDiff = mode === "diff";
  const hasOut = !!(parsed.ok && out && out.text != null);
  const hasMsgs = (!parsed.ok && !parsed.empty) || applied || (parsed.ok && parsed.bigNumbers > 0) || inner;

  return (
    <div className="jx">
      <div className="jx-bar">
        <div className="modes jx-modes" role="group" aria-label="Output">
          {MODES.map(([k, label, Icon]) => (
            <button key={k} type="button" aria-pressed={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>
              <Icon size={15} aria-hidden="true" />{label}
            </button>
          ))}
        </div>
        <div className="jx-acts">
          {hasOut && (
            <>
              <CopyButton text={() => out.text} label="Copy" className="btn gh sm" notify={notify} toast="Copied" title="Copy the full output" />
              <button type="button" className="btn gh sm" onClick={() => saveBlob(new Blob([out.text], { type: out.file[1] }), out.file[0])} title={`Download ${out.file[0]}`}>
                <Download size={15} aria-hidden="true" />Download
              </button>
            </>
          )}
          <button type="button" className="btn gh sm" onClick={() => replaceInput("")} disabled={!input} title="Clear the input (Undo brings it back)">
            <Eraser size={15} aria-hidden="true" />Clear
          </button>
        </div>
      </div>

      <div className="jx-work">
        <section className="jx-pane" aria-labelledby="jx-in-h">
          <header className="jx-ph">
            <h2 id="jx-in-h">{isDiff ? "Original (A)" : "Input"}</h2>
            <span className="jx-kbd">
              <kbd className="kbd">Ctrl/⌘</kbd><kbd className="kbd">Enter</kbd> beautifies in place
            </span>
            <div className="jx-ph-a">
              {undo !== null && <button type="button" className="btn qt sm" onClick={() => { setInput(undo); setUndo(null); setApplied(null); }}><Undo2 size={15} aria-hidden="true" />Undo</button>}
              <button type="button" className="btn qt sm" onClick={openA}><FolderOpen size={15} aria-hidden="true" />Open file</button>
              <input ref={fileA} type="file" aria-label="Open JSON file" accept=".json,.ndjson,.jsonl,.txt,.map,application/json,text/plain" hidden onChange={(e) => { loadFile(e.target.files[0], setInput); e.target.value = ""; }} />
              <button type="button" className="btn qt sm" onClick={loadExample}><FileJson size={15} aria-hidden="true" />Sample</button>
            </div>
          </header>
          <CodeEditor id="json-in" label="JSON input" value={input} onChange={onType} taRef={inputRef} onKeyDown={onKeyDown} height={440}
            errorLine={!parsed.ok && !pending ? parsed.error?.line : null} placeholder='{"paste": "JSON here"} — or drop a .json file'
            invalid={!parsed.ok && !parsed.empty && !pending} describedBy="jx-st-a"
            onDrop={dropTo(setInput)} />
          <StatusBar id="jx-st-a" text={dInput} parsed={parsed} info={info} pending={pending} />
          {parsed.ok && (
            <div className="jx-inplace" role="group" aria-label="Rewrite the input in place">
              <span className="jx-lab">In place</span>
              <button type="button" className="btn gh sm" onClick={beautifyInPlace}><Braces size={15} aria-hidden="true" />Beautify input</button>
              <button type="button" className="btn gh sm" onClick={() => replaceInput(minifyJSON(parsed.value), "Minified")}><Minimize2 size={15} aria-hidden="true" />Minify input</button>
              {!sortKeys && <button type="button" className="btn gh sm" onClick={() => replaceInput(formatJSON(parsed.value, indent, true), "Keys sorted")}>Sort keys</button>}
            </div>
          )}
          {hasMsgs && (
            <div className="jx-msgs">
              {!parsed.ok && !parsed.empty && <ErrorBox parsed={parsed} repair={repair} onJump={jumpToError} onRepair={doRepair} />}
              {applied && (
                <Notice tone="i" title="Repaired">
                  Check the result — fixes are best guesses.
                  <ul className="jx-fixes">{applied.map((f, i) => <li key={i}>{f}</li>)}</ul>
                </Notice>
              )}
              {parsed.ok && parsed.bigNumbers > 0 && (
                <Notice tone="i" title={`${parsed.bigNumbers} large number${parsed.bigNumbers === 1 ? "" : "s"} kept exactly`}>
                  Values like IDs beyond 2⁵³ are rounded by JavaScript's JSON.parse. This tool preserves their original digits in every output.
                </Notice>
              )}
              {inner && (
                <Notice tone="i" title="This is JSON inside a string"
                  actions={<button type="button" className="btn gh sm" onClick={() => replaceInput(formatJSON(inner.value, indent), "Unwrapped")}>Unwrap it</button>}>
                  It was encoded as a string; unwrap it to work with the real structure.
                </Notice>
              )}
            </div>
          )}
        </section>

        {isDiff ? (
          <section className="jx-pane" aria-labelledby="jx-b-h">
            <header className="jx-ph">
              <h2 id="jx-b-h">Changed (B)</h2>
              <div className="jx-ph-a">
                <button type="button" className="btn qt sm" onClick={() => { const a = input; setInput(inputB); setInputB(a); }}><ArrowLeftRight size={15} aria-hidden="true" />Swap A and B</button>
                <button type="button" className="btn qt sm" onClick={() => fileB.current?.click()}><FolderOpen size={15} aria-hidden="true" />Open file</button>
                <input ref={fileB} type="file" aria-label="Open JSON file for B" accept=".json,application/json,text/plain" hidden onChange={(e) => { loadFile(e.target.files[0], setInputB); e.target.value = ""; }} />
              </div>
            </header>
            <CodeEditor id="json-b" label="JSON to compare" value={inputB} onChange={(e) => setInputB(e.target.value)} height={440}
              errorLine={parsedB && !parsedB.ok && !pendingB ? parsedB.error?.line : null} placeholder="Paste the version to compare against A"
              invalid={!!parsedB && !parsedB.ok && !parsedB.empty && !pendingB} describedBy="jx-st-b"
              onDrop={dropTo(setInputB)} />
            {parsedB && <StatusBar id="jx-st-b" text={dInputB} parsed={parsedB} info={infoB} pending={pendingB} />}
          </section>
        ) : (
          <section className="jx-pane jx-out" aria-labelledby="jx-out-h">
            <header className="jx-ph">
              <h2 id="jx-out-h">{OUT_LABEL[mode]}</h2>
              {mode === "convert" && <span className="jx-ph-sub">→ {CONVERTERS[conv][3]}</span>}
              <div className="jx-ph-a jx-meta">
                {hasOut && out.count > 1 && <span>{out.count.toLocaleString()} matches</span>}
                {hasOut && <span>{formatBytes(outBytes)}</span>}
                {hasOut && mode === "minify" && info && <span>{Math.max(0, Math.round((1 - outBytes / info.bytes) * 100))}% smaller than the input</span>}
              </div>
            </header>

            {(mode === "format" || mode === "minify") && (
              <div className="jx-opts">
                {mode === "format" && (
                  <div className="jx-opt">
                    <label htmlFor="json-ind">Indent</label>
                    <select id="json-ind" value={indent} onChange={(e) => setIndent(e.target.value)}>
                      <option value="2">2 spaces</option><option value="4">4 spaces</option><option value="tab">Tab</option>
                    </select>
                  </div>
                )}
                <div className="jx-opt">
                  <label htmlFor="json-sort">Keys</label>
                  <select id="json-sort" value={sortKeys ? "sort" : "keep"} onChange={(e) => setSortKeys(e.target.value === "sort")}>
                    <option value="keep">Original order</option><option value="sort">Sort A → Z (deep)</option>
                  </select>
                </div>
              </div>
            )}
            {mode === "path" && (
              <div className="jx-opts col">
                <div className="jx-opt grow">
                  <label htmlFor="json-path">Path</label>
                  <input id="json-path" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} autoCapitalize="off" placeholder="$.users[0].name" aria-describedby="json-path-h" />
                </div>
                <div className="jx-ex" role="group" aria-label="Example paths">
                  {PATH_EXAMPLES.map((p) => <button key={p} type="button" className="pill" aria-pressed={path === p} onClick={() => setPath(p)}>{p}</button>)}
                </div>
                <div className="hint" id="json-path-h"><code>.key</code> child · <code>[0]</code> / <code>[-1]</code> index · <code>[*]</code> or <code>.*</code> every child · <code>..key</code> search all depths · <code>['a b']</code> keys with spaces</div>
              </div>
            )}
            {mode === "convert" && (
              <div className="jx-opts">
                <div className="seg jx-conv" role="group" aria-label="Convert to">
                  {Object.entries(CONVERTERS).map(([k, [l, , , short]]) => (
                    <button key={k} type="button" aria-pressed={conv === k} title={l} onClick={() => setConv(k)}>{short}</button>
                  ))}
                </div>
                {conv === "ts" && (
                  <div className="jx-opt">
                    <label htmlFor="json-root">Root type name</label>
                    <input id="json-root" value={rootName} onChange={(e) => setRootName(e.target.value)} spellCheck={false} autoCapitalize="off" />
                  </div>
                )}
              </div>
            )}

            <div className="jx-body">
              {!parsed.ok ? (
                parsed.empty ? (
                  <EmptyState icon={FileJson} title="Paste JSON to start"
                    actions={<>
                      <button type="button" className="btn gh sm" onClick={loadExample}><FileJson size={15} aria-hidden="true" />Load example</button>
                      <button type="button" className="btn gh sm" onClick={openA}><FolderOpen size={15} aria-hidden="true" />Open file</button>
                    </>}>
                    Paste or drop JSON into the input. It's checked as you type and never leaves your device.
                  </EmptyState>
                ) : (
                  <EmptyState icon={CircleAlert} title="Fix the input to see the output"
                    actions={repair?.ok && <button type="button" className="btn gh sm" onClick={doRepair}><Wand2 size={15} aria-hidden="true" />Auto-fix</button>}>
                    {repair?.ok ? "Fix it by hand, or let Auto-fix repair it." : "The error is marked in the input."}
                  </EmptyState>
                )
              ) : mode === "tree" ? (
                <JsonTree value={parsed.value} notify={notify} onQuery={(p) => { setPath(p); setMode("path"); }} />
              ) : out.note ? (
                <Notice tone="i" title="Note">{out.note}</Notice>
              ) : (
                <>
                  <CodeEditor id="json-out" label="Output" value={shownOut.text} readOnly height={mode === "path" || mode === "convert" ? 340 : 390} />
                  {shownOut.cut && <div className="hint jx-cut">Large result — showing a preview. Copy and Download include everything.</div>}
                </>
              )}
            </div>
          </section>
        )}
      </div>

      {isDiff && (
        <section className="jx-diff" aria-labelledby="jx-diff-h">
          <h2 id="jx-diff-h" className="jx-diff-h">Differences</h2>
          {!parsed.ok ? <EmptyState icon={CircleAlert} title="Fix A to compare.">The original (A) needs to be valid JSON first.</EmptyState>
            : parsedB && !parsedB.ok ? (
              parsedB.empty ? <EmptyState icon={GitCompareArrows} title="Paste B to compare">Add the changed version on the right.</EmptyState>
                : <Notice tone="w" title={`B is invalid${parsedB.error.line ? ` · line ${parsedB.error.line}` : ""}`}>{parsedB.error.message}</Notice>
            )
              : parsedB && <JsonDiff a={parsed.value} b={parsedB.value} notify={notify} />}
        </section>
      )}
    </div>
  );
}
