import { useState, useMemo } from "react";
import { saveBlob } from "../lib/zip.js";

const PRESETS = {
  blank: { label: "Blank", role: "", task: "", context: "", audience: "", tone: "", format: "", length: "", constraints: "", example: "" },
  email: {
    label: "Email",
    role: "an experienced business communication writer",
    task: "Write an email to a customer apologising for a delayed order and offering a 10% discount code.",
    context: "The order shipped 5 days late because of a warehouse issue that is now fixed.",
    audience: "An existing customer who has ordered before",
    tone: "Warm, professional, concise",
    format: "Subject line, then the email body",
    length: "Under 150 words",
    constraints: "Do not blame the courier. Include the code SORRY10 once.",
    example: "",
  },
  code: {
    label: "Code",
    role: "a senior software engineer",
    task: "Write a function that removes duplicate objects from an array by their `id` field, keeping the first occurrence.",
    context: "JavaScript (ES2022), runs in the browser. Arrays can hold up to 100k items.",
    audience: "Other developers on my team",
    tone: "",
    format: "A single code block, followed by a 2–3 sentence explanation and its time complexity",
    length: "",
    constraints: "No external libraries. Handle an empty array.",
    example: "",
  },
  summary: {
    label: "Summarise",
    role: "an expert analyst",
    task: "Summarise the text I paste below.",
    context: "[Paste the text here]",
    audience: "A busy executive with no background on the topic",
    tone: "Neutral and factual",
    format: "3–5 bullet points, then one line of recommended next steps",
    length: "Under 120 words",
    constraints: "Only use information from the text. Say so if something important is missing.",
    example: "",
  },
  marketing: {
    label: "Marketing",
    role: "a direct-response copywriter",
    task: "Write 5 headline options for a product landing page.",
    context: "Product: a browser toolkit with a UTC scheduler, speed test, price tracker and more. Free, no sign-up.",
    audience: "Developers and small online store owners",
    tone: "Punchy, clear, no hype words",
    format: "Numbered list",
    length: "Each headline under 10 words",
    constraints: "Avoid exclamation marks.",
    example: "",
  },
  learn: {
    label: "Explain",
    role: "a patient teacher",
    task: "Explain how public-key encryption works.",
    context: "",
    audience: "A curious 15-year-old with no technical background",
    tone: "Friendly, uses everyday analogies",
    format: "Short paragraphs, then a 3-question quiz with answers at the end",
    length: "About 300 words",
    constraints: "Avoid maths notation.",
    example: "",
  },
};

const FIELDS = [
  ["role", "Role — who should the AI act as?", "e.g. a senior data analyst", false],
  ["task", "Task — what do you want?", "e.g. Write a product description for…", true],
  ["context", "Context / input", "Background, data or text the AI needs", true],
  ["audience", "Audience", "e.g. beginners, executives, customers", false],
  ["tone", "Tone / style", "e.g. friendly, formal, concise", false],
  ["format", "Output format", "e.g. bullet list, table, JSON, code block", false],
  ["length", "Length", "e.g. under 200 words, 5 items", false],
  ["constraints", "Constraints / rules", "Things to do or avoid", true],
  ["example", "Example of a good answer (optional)", "Paste a sample output to imitate", true],
];

function buildPrompt(f, style, extras) {
  const v = (k) => f[k].trim();
  if (!v("task")) return "";

  if (style === "xml") {
    const parts = [];
    if (v("role")) parts.push(`You are ${v("role")}.`);
    parts.push(`<task>\n${v("task")}\n</task>`);
    if (v("context")) parts.push(`<context>\n${v("context")}\n</context>`);
    const req = [
      v("audience") && `Audience: ${v("audience")}`,
      v("tone") && `Tone: ${v("tone")}`,
      v("format") && `Format: ${v("format")}`,
      v("length") && `Length: ${v("length")}`,
    ].filter(Boolean);
    if (req.length) parts.push(`<requirements>\n${req.map((r) => `- ${r}`).join("\n")}\n</requirements>`);
    if (v("constraints")) parts.push(`<constraints>\n${v("constraints")}\n</constraints>`);
    if (v("example")) parts.push(`<example>\n${v("example")}\n</example>`);
    if (extras.length) parts.push(extras.join("\n"));
    return parts.join("\n\n");
  }

  if (style === "markdown") {
    const parts = [];
    if (v("role")) parts.push(`# Role\nYou are ${v("role")}.`);
    parts.push(`# Task\n${v("task")}`);
    if (v("context")) parts.push(`# Context\n${v("context")}`);
    const req = [
      v("audience") && `- **Audience:** ${v("audience")}`,
      v("tone") && `- **Tone:** ${v("tone")}`,
      v("format") && `- **Format:** ${v("format")}`,
      v("length") && `- **Length:** ${v("length")}`,
    ].filter(Boolean);
    if (req.length) parts.push(`# Requirements\n${req.join("\n")}`);
    if (v("constraints")) parts.push(`# Constraints\n${v("constraints")}`);
    if (v("example")) parts.push(`# Example\n${v("example")}`);
    if (extras.length) parts.push(`# Notes\n${extras.map((e) => `- ${e}`).join("\n")}`);
    return parts.join("\n\n");
  }

  const s = [];
  if (v("role")) s.push(`You are ${v("role")}.`);
  s.push(v("task"));
  if (v("context")) s.push(`\nContext:\n${v("context")}\n`);
  if (v("audience")) s.push(`The audience is ${v("audience")}.`);
  if (v("tone")) s.push(`Use this tone: ${v("tone")}.`);
  if (v("format")) s.push(`Format the answer as: ${v("format")}.`);
  if (v("length")) s.push(`Length: ${v("length")}.`);
  if (v("constraints")) s.push(`\nRules:\n${v("constraints")}`);
  if (v("example")) s.push(`\nHere is an example of a good answer:\n${v("example")}`);
  if (extras.length) s.push(`\n${extras.join(" ")}`);
  return s.join(" ").replace(/ \n/g, "\n").replace(/\n /g, "\n").trim();
}

const EXTRAS = [
  ["think", "Think step by step before answering."],
  ["ask", "If anything is unclear, ask me clarifying questions before you start."],
  ["noguess", "If you don't know something, say so instead of guessing."],
  ["review", "After answering, review your work and fix any mistakes."],
];

export default function PromptTool({ notify }) {
  const [preset, setPreset] = useState("email");
  const [f, setF] = useState(() => ({ ...PRESETS.email }));
  const [style, setStyle] = useState("plain");
  const [extras, setExtras] = useState({});

  const extraLines = EXTRAS.filter(([k]) => extras[k]).map(([, line]) => line);
  const prompt = useMemo(() => buildPrompt(f, style, extraLines), [f, style, extraLines.join("|")]);
  const words = prompt ? prompt.trim().split(/\s+/).length : 0;
  const tokens = Math.ceil(prompt.length / 4);
  const missing = ["role", "context", "format"].filter((k) => !f[k].trim());

  const edited = FIELDS.some(([k]) => f[k] !== PRESETS[preset][k]);
  const pick = (k) => {
    if (edited && !window.confirm(`Replace your edits with the ${PRESETS[k].label} template?`)) return;
    setPreset(k); setF({ ...PRESETS[k] });
  };
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); notify("Prompt copied"); }
    catch { notify("Copy failed — select the text and copy manually"); }
  };
  const download = () => saveBlob(new Blob([prompt], { type: "text/plain" }), "prompt.txt");

  return (
    <div>
      <div className="modes" role="group" aria-label="Start from a template">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} type="button" aria-pressed={preset === k} className={preset === k ? "on" : ""} onClick={() => pick(k)}>{p.label}</button>
        ))}
      </div>

      <div className="grid2">
        <div className="panel rise d1">
          <div className="ph"><h2>Describe what you need</h2><p>Only the task is required. Every field you fill makes the answer more precise.</p></div>
          <div className="pb">
            {FIELDS.map(([k, label, ph, multi]) => (
              <div className="field" key={k}>
                <label htmlFor={`pg-${k}`}>{label}</label>
                {multi
                  ? <textarea id={`pg-${k}`} value={f[k]} onChange={set(k)} placeholder={ph} style={{ height: k === "task" ? 90 : 80 }} />
                  : <input id={`pg-${k}`} value={f[k]} onChange={set(k)} placeholder={ph} />}
              </div>
            ))}
            <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 14px", minWidth: 0 }}>
              <legend style={{ padding: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--tx2)", marginBottom: 6 }}>Extra instructions</legend>
              {EXTRAS.map(([k, line]) => (
                <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", textTransform: "none", letterSpacing: 0, fontWeight: 500, fontSize: 13, color: "var(--tx2)", margin: "6px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!extras[k]} onChange={(e) => setExtras((x) => ({ ...x, [k]: e.target.checked }))} style={{ width: 18, height: 18, minHeight: 0, flexShrink: 0, margin: 0 }} />
                  {line}
                </label>
              ))}
            </fieldset>
          </div>
        </div>

        <div className="panel rise d2">
          <div className="ph"><h2>Your prompt</h2><p>Paste it into ChatGPT, Claude, Gemini or any other assistant.</p></div>
          <div className="pb">
            <div className="field">
              <label htmlFor="pg-style">Structure</label>
              <select id="pg-style" value={style} onChange={(e) => setStyle(e.target.value)}>
                <option value="plain">Plain text</option>
                <option value="markdown">Markdown sections</option>
                <option value="xml">XML tags</option>
              </select>
            </div>
            {prompt ? (
              <>
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--mono)", fontSize: 12.5, lineHeight: 1.6, background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, margin: "0 0 12px", maxHeight: 520, overflow: "auto", color: "var(--tx)" }}>{prompt}</pre>
                <div className="hint" style={{ marginBottom: 12 }}>{words} words · ~{tokens} tokens</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn pri" onClick={copy}>Copy prompt</button>
                  <button className="btn gh" onClick={download} style={{ whiteSpace: "nowrap" }}>Download .txt</button>
                </div>
                {missing.length > 0 && (
                  <div className="note i" style={{ marginTop: 14 }}>
                    <b>Tip · </b>Adding {missing.join(", ")} usually gives a noticeably better answer.
                  </div>
                )}
              </>
            ) : (
              <div className="empty">Describe the task to generate a prompt.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
