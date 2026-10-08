import { useState, useMemo, useRef, useEffect } from "react";
import { Square, Mail, Code2, FileText, Megaphone, GraduationCap, Download, Check, Plus, Sparkles, ExternalLink, Link2, Undo2 } from "lucide-react";
import { saveBlob } from "../lib/zip.js";
import { makeShareLink, shareBase, decodeShare, readHashParam, readStored, writeStored } from "../lib/shareState.js";
import { AI_TARGETS, PROMPT_URL_MAX, aiOpenPlan, packDraft, unpackDraft } from "../lib/promptCore.js";
import { CopyButton, Notice, EmptyState } from "../components/ui.jsx";
import "./css/prompt.css";

const PRESETS = {
  blank: { label: "Blank", icon: Square, role: "", task: "", context: "", audience: "", tone: "", format: "", length: "", constraints: "", example: "" },
  email: {
    label: "Email",
    icon: Mail,
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
    icon: Code2,
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
    icon: FileText,
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
    icon: Megaphone,
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
    icon: GraduationCap,
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

/* [key, label, placeholder, multiline, essential, short chip name] */
const FIELDS = [
  ["task", "Task — what do you want?", "e.g. Write a product description for…", true, true, "Task"],
  ["context", "Context / input", "Background, data or text the AI needs", true, true, "Context"],
  ["format", "Desired output format", "e.g. bullet list, table, JSON, code block", false, true, "Format"],
  ["role", "Role — who should the AI act as?", "e.g. a senior data analyst", false, false, "Role"],
  ["audience", "Audience", "e.g. beginners, executives, customers", false, false, "Audience"],
  ["tone", "Tone / style", "e.g. friendly, formal, concise", false, false, "Tone"],
  ["length", "Length", "e.g. under 200 words, 5 items", false, false, "Length"],
  ["constraints", "Constraints / rules", "Things to do or avoid", true, false, "Rules"],
  ["example", "Example of a good answer", "Paste a sample output to imitate", true, false, "Example"],
];
const ESSENTIAL = FIELDS.filter((x) => x[4]);
const OPTIONAL = FIELDS.filter((x) => !x[4]);
/* Chip order mirrors how the prompt is assembled. */
const CHIP_ORDER = ["role", "task", "context", "audience", "tone", "format", "length", "constraints", "example"];
const STYLES = [["plain", "Plain text"], ["markdown", "Markdown"], ["xml", "XML tags"]];

/* Pasted text containing one of our own section tags (e.g. "</context>") would
   close that section early, so only those tags are escaped; other markup and
   code stay as typed. */
const OWN_TAG = /<(\/?)(task|context|requirements|constraints|example)\b/gi;
const escapeOwnTags = (t) => t.replace(OWN_TAG, "&lt;$1$2");

function buildPrompt(f, style, extras) {
  const v = (k) => f[k].trim();
  if (!v("task")) return "";

  if (style === "xml") {
    const x = (k) => escapeOwnTags(v(k));
    const parts = [];
    if (v("role")) parts.push(`You are ${x("role")}.`);
    parts.push(`<task>\n${x("task")}\n</task>`);
    if (v("context")) parts.push(`<context>\n${x("context")}\n</context>`);
    const req = [
      v("audience") && `Audience: ${x("audience")}`,
      v("tone") && `Tone: ${x("tone")}`,
      v("format") && `Format: ${x("format")}`,
      v("length") && `Length: ${x("length")}`,
    ].filter(Boolean);
    if (req.length) parts.push(`<requirements>\n${req.map((r) => `- ${r}`).join("\n")}\n</requirements>`);
    if (v("constraints")) parts.push(`<constraints>\n${x("constraints")}\n</constraints>`);
    if (v("example")) parts.push(`<example>\n${x("example")}\n</example>`);
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

const DRAFT_KEY = "toolDeck.promptDraft";
const VOCAB = { presets: Object.keys(PRESETS), fields: FIELDS.map((x) => x[0]), styles: STYLES.map((x) => x[0]), extras: EXTRAS.map((x) => x[0]) };
/* A preset minus its label/icon, i.e. just the field values. */
const fieldsOf = (p) => Object.fromEntries(FIELDS.map(([k]) => [k, p[k]]));
const dropHash = () => { try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch { /* ignore */ } };

/* Prefill links open directly; assistants without prefill (or prompts too long for a URL)
   get the prompt via the clipboard, then open in a new tab. */
function OpenIn({ prompt, notify }) {
  const open = (plan) => async (e) => {
    if (!plan.copy) return;
    e.preventDefault();
    try { await navigator.clipboard.writeText(prompt); notify(`Prompt copied — paste it in ${plan.label}`); }
    catch { notify(`Couldn't copy — copy the prompt, then paste it in ${plan.label}`); }
    window.open(plan.url, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="pg-open" role="group" aria-label="Open in an AI assistant">
      <span className="pg-eyebrow">Open in</span>
      {AI_TARGETS.map(([id]) => {
        const plan = aiOpenPlan(id, prompt);
        return (
          <a key={id} className="pill" href={plan.url} target="_blank" rel="noopener noreferrer" onClick={open(plan)}
            title={plan.copy ? `Copies the prompt, then opens ${plan.label} — paste it in` : `Opens ${plan.label} with this prompt filled in`}>
            {plan.label}<ExternalLink size={13} aria-hidden="true" />
          </a>
        );
      })}
    </div>
  );
}

function Field({ k, label, ph, multi, value, onChange, required }) {
  return (
    <div className="field">
      <label htmlFor={`pg-${k}`}>{label}{required && <span className="pg-req"> · required</span>}</label>
      {multi
        ? <textarea id={`pg-${k}`} className={k === "task" ? "pg-ta tall" : "pg-ta"} value={value} onChange={onChange} placeholder={ph} aria-required={required || undefined} />
        : <input id={`pg-${k}`} value={value} onChange={onChange} placeholder={ph} />}
    </div>
  );
}

export default function PromptTool({ notify }) {
  const [saved] = useState(() => unpackDraft(readStored(DRAFT_KEY), VOCAB));
  const [preset, setPreset] = useState(saved?.preset ?? "email");
  const [f, setF] = useState(() => saved?.f ?? fieldsOf(PRESETS.email));
  const [style, setStyle] = useState(saved?.style ?? "plain");
  const [extras, setExtras] = useState(saved?.extras ?? {});
  const [moreOpen, setMoreOpen] = useState(false);
  const [undo, setUndo] = useState(null);
  const moreRef = useRef(null);
  const cur = useRef(null);
  cur.current = { preset, f, style, extras };

  const apply = (d) => { setPreset(d.preset); setF(d.f); setStyle(d.style); setExtras(d.extras); };

  /* Draft survives reloads; debounced so typing doesn't hammer storage. */
  useEffect(() => {
    const t = setTimeout(() => writeStored(DRAFT_KEY, packDraft({ preset, f, style, extras })), 400);
    return () => clearTimeout(t);
  }, [preset, f, style, extras]);

  /* A shared link (#p=…) replaces the draft, with Undo; the hash is dropped so a reload keeps later edits. */
  useEffect(() => {
    let live = true;
    const load = async () => {
      const payload = readHashParam(window.location.hash, "p");
      if (!payload) return;
      try {
        const d = unpackDraft(JSON.parse(await decodeShare(payload, { maxBytes: 200000 })), VOCAB);
        if (!d) throw new Error("bad draft");
        if (!live) return;
        setUndo({ msg: "Loaded the shared prompt.", prev: cur.current });
        apply(d);
      } catch { if (live) notify("That prompt link is damaged or incomplete."); }
      if (live) dropHash();
    };
    load();
    window.addEventListener("hashchange", load);
    return () => { live = false; window.removeEventListener("hashchange", load); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const extraLines = EXTRAS.filter(([k]) => extras[k]).map(([, line]) => line);
  const prompt = useMemo(() => buildPrompt(f, style, extraLines), [f, style, extraLines.join("|")]);
  const words = prompt ? prompt.trim().split(/\s+/).length : 0;
  const tokens = Math.ceil(prompt.length / 4);
  const missing = ["role", "context", "format"].filter((k) => !f[k].trim());
  const filled = (k) => !!f[k].trim();
  const optFilled = OPTIONAL.filter(([k]) => filled(k)).length + extraLines.length;

  const edited = FIELDS.some(([k]) => f[k] !== PRESETS[preset][k]);
  /* Switch at once; edits are only a click away via Undo. */
  const pick = (k) => {
    if (k === preset && !edited) return;
    setUndo(edited ? { msg: `Switched to the ${PRESETS[k].label} template.`, prev: { preset, f } } : null);
    setPreset(k); setF(fieldsOf(PRESETS[k]));
  };
  const restore = () => { if (undo) { apply({ ...cur.current, ...undo.prev }); setUndo(null); } };
  const set = (k) => (e) => { setF((p) => ({ ...p, [k]: e.target.value })); setUndo(null); };

  /* The draft travels in the hash, so the link works without anything being uploaded. */
  const copyLink = async () => {
    try {
      const { url } = await makeShareLink(shareBase(window.location), "p", JSON.stringify(packDraft({ preset, f, style, extras })));
      if (url.length > PROMPT_URL_MAX) { notify("Too long to share as a link — copy or download the prompt instead."); return; }
      await navigator.clipboard.writeText(url);
      notify("Link copied — it opens with this prompt filled in");
    } catch { notify("Couldn't copy the link."); }
  };

  /* Chips jump to their field, opening "More options" first when needed. */
  const focusField = (k) => {
    const essential = ESSENTIAL.some(([x]) => x === k);
    if (!essential && moreRef.current && !moreRef.current.open) { moreRef.current.open = true; setMoreOpen(true); }
    requestAnimationFrame(() => document.getElementById(`pg-${k}`)?.focus());
  };

  const download = () => saveBlob(new Blob([prompt], { type: "text/plain" }), "prompt.txt");
  const fieldMeta = Object.fromEntries(FIELDS.map((x) => [x[0], x]));

  return (
    <div className="pg">
      <div className="pg-tpl">
        <span className="pg-eyebrow" id="pg-tpl-l">Start from</span>
        <div className="modes pg-modes" role="group" aria-label="Start from a template">
          {Object.entries(PRESETS).map(([k, p]) => {
            const Icon = p.icon;
            return (
              <button key={k} type="button" aria-pressed={preset === k} className={preset === k ? "on" : ""} onClick={() => pick(k)}>
                {Icon && <Icon size={15} aria-hidden="true" />}{p.label}
              </button>
            );
          })}
        </div>
      </div>
      {undo && (
        <Notice tone="i" role="status" className="pg-undo" actions={
          <>
            <button type="button" className="pill" onClick={restore}><Undo2 size={14} aria-hidden="true" />Undo</button>
            <button type="button" className="pill" onClick={() => setUndo(null)}>Dismiss</button>
          </>
        }>{undo.msg}</Notice>
      )}

      <div className="pg-grid">
        <section className="pg-ess" aria-labelledby="pg-ess-h">
          <div className="pg-sech">
            <h2 id="pg-ess-h">Essentials</h2>
            <p>Only the task is required. Every field you fill makes the answer more precise.</p>
          </div>
          {ESSENTIAL.map(([k, label, ph, multi]) => (
            <Field key={k} k={k} label={label} ph={ph} multi={multi} value={f[k]} onChange={set(k)} required={k === "task"} />
          ))}
        </section>

        <aside className="pg-out" aria-labelledby="pg-out-h">
          <div className="pg-out-h">
            <h2 id="pg-out-h">Your prompt</h2>
            <div className="seg pg-style" role="group" aria-label="Structure">
              {STYLES.map(([k, l]) => (
                <button key={k} type="button" aria-pressed={style === k} onClick={() => setStyle(k)}>{l}</button>
              ))}
            </div>
          </div>
          <ul className="pg-chips" aria-label="Prompt sections">
            {CHIP_ORDER.map((k) => {
              const on = filled(k);
              const name = fieldMeta[k][5];
              return (
                <li key={k}>
                  <button type="button" className={`pg-chip${on ? " on" : ""}`} onClick={() => focusField(k)} title={on ? `Edit ${name}` : `Add ${name}`}>
                    {on ? <Check size={12} aria-hidden="true" strokeWidth={2.8} /> : <Plus size={12} aria-hidden="true" strokeWidth={2.4} />}
                    {name}<span className="sr-only">{on ? " (filled, edit)" : " (empty, add)"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {prompt ? (
            <>
              <pre className="pg-pre" tabIndex={0} aria-label="Generated prompt">{prompt}</pre>
              <div className="pg-count" aria-live="polite">{words.toLocaleString()} words · ~{tokens.toLocaleString()} tokens · {prompt.length.toLocaleString()} characters</div>
              <div className="pg-acts">
                <CopyButton text={() => prompt} label="Copy prompt" done="Copied" className="btn pri" notify={notify} toast="Prompt copied" />
                <button type="button" className="btn gh" onClick={download}><Download size={15} aria-hidden="true" />Download .txt</button>
                <button type="button" className="btn gh" onClick={copyLink} title="The prompt is stored in the link itself — nothing is uploaded"><Link2 size={15} aria-hidden="true" />Copy link</button>
              </div>
              <OpenIn prompt={prompt} notify={notify} />
              <p className="pg-where">Or paste it into any other assistant. Your draft is saved in this browser.</p>
              {missing.length > 0 && (
                <Notice tone="i" title="Tip" className="pg-tip">
                  Adding {missing.join(", ")} usually gives a noticeably better answer.
                </Notice>
              )}
            </>
          ) : (
            <EmptyState icon={Sparkles} title="Describe the task to generate a prompt.">
              Your prompt builds here, live, as you fill in the fields.
            </EmptyState>
          )}
        </aside>

        <details className="more pg-more" ref={moreRef} open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
          <summary>
            More options
            <span className="pg-more-s">Role, audience, tone, length, rules, example, extra instructions</span>
            {optFilled > 0 && <span className="pg-more-n">{optFilled} set</span>}
          </summary>
          <div className="pg-more-b">
            {OPTIONAL.map(([k, label, ph, multi]) => (
              <Field key={k} k={k} label={label} ph={ph} multi={multi} value={f[k]} onChange={set(k)} />
            ))}
            <fieldset className="pg-x">
              <legend>Extra instructions</legend>
              {EXTRAS.map(([k, line]) => (
                <label key={k} className="pg-xr">
                  <input type="checkbox" checked={!!extras[k]} onChange={(e) => setExtras((x) => ({ ...x, [k]: e.target.checked }))} />
                  <span>{line}</span>
                </label>
              ))}
            </fieldset>
          </div>
        </details>
      </div>

      {prompt && (
        <div className="pg-dock">
          <CopyButton text={() => prompt} label="Copy prompt" done="Copied" className="btn pri" notify={notify} toast="Prompt copied" />
        </div>
      )}
    </div>
  );
}
