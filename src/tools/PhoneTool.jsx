import { useState, useEffect, useMemo } from "react";
import { detectPhone } from "../lib/phone.js";
import { fmtLocal, offsetLabel } from "../lib/time.js";
import { useNow, readParams, writeParams } from "../hooks/index.js";

export default function PhoneTool({ notify }) {
  const [input, setInput] = useState(() => readParams().get("n") || "");
  useEffect(() => { writeParams({ n: input.trim() || null }); }, [input]);
  const now = useNow(1000);
  const det = useMemo(() => detectPhone(input), [input]);
  const copy = (t, l) => navigator.clipboard.writeText(t).then(() => notify(`${l} copied.`)).catch(() => notify("Copy blocked."));
  return (
    <div className="grid2" style={{ gridTemplateColumns: "1fr", maxWidth: 660, margin: "0 auto" }}>
      <div className="panel rise d1">
        <div className="ph"><h3>Enter a phone number</h3><p>Detection uses the international dialing prefix — indexed for instant lookup.</p></div>
        <div className="pb">
          <input className="inp" style={{ height: 56, fontSize: 20 }} inputMode="tel" placeholder="+91 98765 43210" value={input}
            aria-label="Phone number" onChange={(e) => setInput(e.target.value)} />
          <div className="pillrow">
            {["+91 98765 43210", "+1 416 555 0199", "+44 20 7183 8750", "+81 3 1234 5678"].map((s) => (
              <button key={s} className="pill" onClick={() => setInput(s)}>{s}</button>
            ))}
          </div>

          {det && det.error && input.trim() && <div className="note w" style={{ marginTop: 16 }}><b>Can't detect · </b>{det.error}</div>}

          {det && det.name && (
            <div style={{ marginTop: 16 }}>
              <div className="phbox">
                <div className="phflag">{det.flag}</div>
                <div>
                  <h4>{det.name}</h4>
                  <div className="m">+{det.dial}{det.area ? ` (area ${det.area})` : ""} · {det.valid} · {det.type}{det.assumed ? " · prefix assumed" : ""}</div>
                </div>
              </div>
              <div className="panel" style={{ marginTop: 12 }}>
                <div className="kv"><span className="k">International format</span><span className="v hl">{det.intl}</span></div>
                <div className="kv"><span className="k">E.164</span><span className="v">{det.e164}</span></div>
                <div className="kv"><span className="k">Timezone</span><span className="v">{det.zone} · now {fmtLocal(now, det.zone)} ({offsetLabel(det.zone, now)})</span></div>
              </div>
              <div className="pillrow" style={{ marginTop: 12 }}>
                <button className="pill" onClick={() => copy(det.e164, "Number")}>⧉ Copy number</button>
                <a className="pill" style={{ textDecoration: "none" }} href={`https://wa.me/${det.dial}${det.national}`} target="_blank" rel="noreferrer">WhatsApp link ↗</a>
                <a className="pill" style={{ textDecoration: "none" }} href={`tel:${det.e164}`}>Click to call</a>
                <button className="pill" onClick={() => navigator.clipboard.writeText(window.location.href).then(() => notify("Link copied — reopens this number.")).catch(() => notify("Copy blocked."))}>🔗 Share link</button>
              </div>
            </div>
          )}
          <div className="note i" style={{ marginTop: 18 }}>
            <b>What this shows · </b>the numbering country or region a number belongs to. It can never reveal the owner,
            the live location, or where the phone physically is right now.
          </div>
        </div>
      </div>
    </div>
  );
}
