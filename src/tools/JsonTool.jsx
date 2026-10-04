import { useState, useCallback } from "react";
import { useDocumentMeta } from "../hooks/index.js";

function validateJSON(str) {
  try {
    const parsed = JSON.parse(str);
    return { valid: true, error: null, parsed };
  } catch (e) {
    return { valid: false, error: e.message, parsed: null };
  }
}

function formatJSON(str, indent = 2) {
  const result = validateJSON(str);
  if (!result.valid) return str;
  try {
    return JSON.stringify(result.parsed, null, indent);
  } catch {
    return str;
  }
}

function minifyJSON(str) {
  const result = validateJSON(str);
  if (!result.valid) return str;
  try {
    return JSON.stringify(result.parsed);
  } catch {
    return str;
  }
}

function jsonToYAML(obj, indent = 0) {
  const spaces = " ".repeat(indent);
  if (obj === null) return "null";
  if (typeof obj === "boolean") return String(obj);
  if (typeof obj === "number") return String(obj);
  if (typeof obj === "string") return `"${obj.replace(/"/g, '\\"')}"`;
  if (Array.isArray(obj)) {
    return obj.map((item, i) =>
      `${i === 0 ? "" : spaces}- ${jsonToYAML(item, indent + 2)}`
    ).join("\n");
  }
  if (typeof obj === "object") {
    return Object.entries(obj).map(([k, v]) =>
      `${spaces}${k}: ${jsonToYAML(v, indent + 2)}`
    ).join("\n");
  }
  return String(obj);
}

function jsonToCSV(obj) {
  if (!Array.isArray(obj) || !obj.length) return "";
  const headers = Object.keys(obj[0]);
  const rows = obj.map(row =>
    headers.map(h => {
      const v = row[h];
      const str = typeof v === "string" ? v : JSON.stringify(v);
      return `"${str.replace(/"/g, '""')}"`;
    }).join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

function getJSONPath(obj, path) {
  if (!path) return obj;
  const parts = path.match(/\$\.?([^\.\[]*)/g) || [];
  let current = obj;
  for (const part of parts) {
    const key = part.replace(/^\$\.?/, "").replace(/[\[\]"]/g, "");
    if (key && current && typeof current === "object") {
      current = current[key];
    }
  }
  return current;
}

export default function JsonTool({ notify }) {
  const [input, setInput] = useState('{\n  "hello": "world",\n  "number": 42\n}');
  const [indent, setIndent] = useState(2);
  const [mode, setMode] = useState("format"); // format, minify, validate, yaml, csv, path
  const [searchPath, setSearchPath] = useState("$.hello");
  const tool = { name: "JSON Validator & Formatter", blurb: "Validate, format, minify, and convert JSON" };
  useDocumentMeta(tool);

  const validation = validateJSON(input);
  let output = "";
  let pathResult = null;

  switch (mode) {
    case "format":
      output = formatJSON(input, parseInt(indent));
      break;
    case "minify":
      output = minifyJSON(input);
      break;
    case "yaml":
      output = validation.valid ? jsonToYAML(validation.parsed) : input;
      break;
    case "csv":
      output = validation.valid ? jsonToCSV(validation.parsed) : "Invalid JSON for CSV export";
      break;
    case "path":
      pathResult = validation.valid ? getJSONPath(validation.parsed, searchPath) : null;
      break;
    default:
      output = validation.valid ? "Valid JSON ✓" : `Invalid: ${validation.error}`;
  }

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(output || "");
    notify("Copied to clipboard");
  }, [output, notify]);

  const handleDownload = useCallback((format) => {
    let content = output;
    let filename = "data";
    let type = "application/json";

    if (format === "yaml") {
      filename = "data.yaml";
      type = "text/yaml";
    } else if (format === "csv") {
      filename = "data.csv";
      type = "text/csv";
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Downloaded ${filename}`);
  }, [output, notify]);

  return (
    <div className="grid2">
      <div className="panel">
        <div className="ph">
          <h3>Input JSON</h3>
          <p>Paste or type JSON to validate and transform</p>
        </div>
        <div className="pb">
          <textarea
            className="field"
            style={{ height: "380px", fontFamily: "var(--mono)", fontSize: "12px" }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='{"example": "json"}'
          />
          <div className="hint" style={{ marginTop: "8px" }}>
            {validation.valid ? (
              <span style={{ color: "var(--good)" }}>✓ Valid JSON</span>
            ) : (
              <span style={{ color: "var(--bad)" }}>✗ {validation.error}</span>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="ph">
          <h3>Tools & Output</h3>
          <p>Choose a transformation</p>
        </div>
        <div className="pb">
          <div className="modes" style={{ marginBottom: "14px" }}>
            <button
              className="btn gh"
              onClick={() => setMode("format")}
              style={{
                background: mode === "format" ? "var(--pri-soft)" : "transparent",
                color: mode === "format" ? "var(--pri2)" : "var(--tx2)",
                border: "none",
                padding: "7px 13px",
              }}
            >
              Format
            </button>
            <button
              className="btn gh"
              onClick={() => setMode("minify")}
              style={{
                background: mode === "minify" ? "var(--pri-soft)" : "transparent",
                color: mode === "minify" ? "var(--pri2)" : "var(--tx2)",
                border: "none",
                padding: "7px 13px",
              }}
            >
              Minify
            </button>
            <button
              className="btn gh"
              onClick={() => setMode("yaml")}
              style={{
                background: mode === "yaml" ? "var(--pri-soft)" : "transparent",
                color: mode === "yaml" ? "var(--pri2)" : "var(--tx2)",
                border: "none",
                padding: "7px 13px",
              }}
            >
              YAML
            </button>
            <button
              className="btn gh"
              onClick={() => setMode("csv")}
              style={{
                background: mode === "csv" ? "var(--pri-soft)" : "transparent",
                color: mode === "csv" ? "var(--pri2)" : "var(--tx2)",
                border: "none",
                padding: "7px 13px",
              }}
            >
              CSV
            </button>
            <button
              className="btn gh"
              onClick={() => setMode("path")}
              style={{
                background: mode === "path" ? "var(--pri-soft)" : "transparent",
                color: mode === "path" ? "var(--pri2)" : "var(--tx2)",
                border: "none",
                padding: "7px 13px",
              }}
            >
              Path
            </button>
          </div>

          {mode === "format" && (
            <div className="field" style={{ marginBottom: "12px" }}>
              <label>Indent Size</label>
              <input
                type="number"
                min="1"
                max="8"
                value={indent}
                onChange={(e) => setIndent(e.target.value)}
              />
            </div>
          )}

          {mode === "path" && (
            <div className="field" style={{ marginBottom: "12px" }}>
              <label>JSONPath (e.g., $.users[0].name)</label>
              <input
                type="text"
                value={searchPath}
                onChange={(e) => setSearchPath(e.target.value)}
                placeholder="$.key.subkey"
              />
            </div>
          )}

          <textarea
            className="field"
            style={{
              height: "280px",
              fontFamily: "var(--mono)",
              fontSize: "12px",
              color: mode === "validate" && !validation.valid ? "var(--bad)" : "var(--tx)",
              readOnly: true,
            }}
            value={
              mode === "path"
                ? pathResult !== null
                  ? typeof pathResult === "string"
                    ? pathResult
                    : JSON.stringify(pathResult, null, 2)
                  : "(value not found)"
                : output
            }
          />

          <div className="pillrow" style={{ marginTop: "12px" }}>
            <button className="pill" onClick={handleCopy}>
              📋 Copy
            </button>
            {(mode === "format" || mode === "minify") && (
              <button className="pill" onClick={() => handleDownload("json")}>
                ⬇ JSON
              </button>
            )}
            {mode === "yaml" && (
              <button className="pill" onClick={() => handleDownload("yaml")}>
                ⬇ YAML
              </button>
            )}
            {mode === "csv" && (
              <button className="pill" onClick={() => handleDownload("csv")}>
                ⬇ CSV
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
