import { useState } from "react";

export function Toast({ msg }) { return msg ? <div className="toast">{msg}</div> : null; }

export function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      className={`sw ${on ? "on" : ""}`} onClick={() => onChange(!on)}><i /></button>
  );
}

export function ShareLink({ notify }) {
  const copy = () => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => notify && notify("Link copied — it reopens this exact result."))
      .catch(() => notify && notify("Copy blocked."));
  };
  return <button type="button" className="btn gh" onClick={copy} title="Copy a link that reproduces this result">🔗 Share link</button>;
}

export function FaqSection({ tool }) {
  const [open, setOpen] = useState(0);
  return (
    <section className="faqwrap rise d4" aria-label="Frequently asked questions">
      <h3 className="faqh">Frequently asked</h3>
      {tool.faqs.map(([q, a], i) => (
        <div className="faqitem" key={q}>
          <button className="faqq" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
            <span>{q}</span><span className="faqsign" aria-hidden="true">{open === i ? "−" : "+"}</span>
          </button>
          {open === i && <div className="faqa">{a}</div>}
        </div>
      ))}
    </section>
  );
}
