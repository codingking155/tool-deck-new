import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { CopyButton } from "./ui.jsx";

/* Stays mounted so screen readers pick up the live region — toggling the whole
   element in and out of the DOM means the announcement is never heard. */
export function Toast({ msg }) {
  return (
    <div className={`toast ${msg ? "show" : ""}`} role="status" aria-live="polite" aria-atomic="true">
      {msg && <span className="tic" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>}
      {msg}
    </div>
  );
}

export function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      className={`sw ${on ? "on" : ""}`} onClick={() => onChange(!on)}><i /></button>
  );
}

/** Clipboard write that never throws (no clipboard API / insecure context / permission denied). */
export async function copyText(text, notify, ok) {
  try { await navigator.clipboard.writeText(text); notify && notify(ok); }
  catch { notify && notify("Couldn't copy — select and copy manually."); }
}

export function ShareLink({ notify }) {
  return (
    <CopyButton text={() => window.location.href} label="Share link" done="Link copied" icon={false}
      notify={notify} toast="Link copied — it reopens this exact result." title="Copy a link that reproduces this result"
      className="btn gh sharebtn" />
  );
}
ShareLink.Icon = Link2;

export function FaqSection({ tool }) {
  const [open, setOpen] = useState(-1);
  return (
    <section className="faqwrap" aria-labelledby="faq-h">
      <div>
        <h2 className="faqh" id="faq-h">Questions</h2>
        <p>About {tool.name}</p>
      </div>
      <div>
        {tool.faqs.map(([q, a], i) => (
          <div className="faqitem" key={q}>
            <h3 className="faqqh">
              <button className="faqq" aria-expanded={open === i} aria-controls={`faq-a-${i}`} onClick={() => setOpen(open === i ? -1 : i)}>
                <span>{q}</span><span className="faqsign" aria-hidden="true" />
              </button>
            </h3>
            <div className="faqa" id={`faq-a-${i}`} hidden={open !== i}>{a}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
