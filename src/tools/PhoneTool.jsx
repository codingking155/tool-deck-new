import { useState, useEffect, useMemo } from "react";
import { Phone, X, CircleCheck, CircleAlert, CircleX, Loader2, MessageCircle, PhoneCall, Link2, Clock, Info } from "lucide-react";
import { analyzeNumber, validityText } from "../lib/phoneCheck.js";
import { detectPhone } from "../lib/phone.js";
import { fmtLocal, offsetLabel } from "../lib/time.js";
import { useNow, readParams, writeParams } from "../hooks/index.js";
import { Notice, StatusBadge, CopyButton } from "../components/ui.jsx";
import RecentChecks from "../components/RecentChecks.jsx";
import { addRecent, loadRecent, saveRecent } from "../lib/recentChecks.js";
import "./css/phone.css";

const RECENT_KEY = "toolDeck.phoneRecent";
const EXAMPLES = ["+91 98765 43210", "+1 416 555 0199", "+44 20 7183 8750", "+81 3 1234 5678"];

/* Ticks every second — a leaf so the input and result don't re-render with it. */
function ZoneNow({ zone }) {
  const now = useNow(1000);
  return <>{fmtLocal(now, zone)} <span className="ph-off">{offsetLabel(zone, now)}</span></>;
}

function Verdict({ det, info }) {
  if (info === undefined) return <StatusBadge icon={Loader2}>Checking · {det.valid}</StatusBadge>;
  if (!info) return <StatusBadge>{`${det.valid} · ${det.type}`}</StatusBadge>;
  const tone = info.valid ? "ok" : info.possible ? "warn" : "bad";
  const icon = info.valid ? CircleCheck : info.possible ? CircleAlert : CircleX;
  return <StatusBadge tone={tone} icon={icon}>{`${validityText(info)} · ${info.typeLabel || "Type unknown"}`}</StatusBadge>;
}

function FormatRow({ label, value, notify, toast }) {
  return (
    <div className="ph-fmt">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      <CopyButton text={value} className="btn gh sm" notify={notify} toast={toast}
        label={<>Copy<span className="sr-only"> {label}</span></>} done="Copied" />
    </div>
  );
}

export default function PhoneTool({ notify }) {
  const [input, setInput] = useState(() => readParams().get("n") || "");
  useEffect(() => { writeParams({ n: input.trim() || null }); }, [input]);
  const det = useMemo(() => detectPhone(input), [input]);
  const [info, setInfo] = useState(undefined); // undefined = checking, null = no libphonenumber verdict
  const [recent, setRecent] = useState(() => loadRecent(RECENT_KEY));
  const e164 = det && det.e164;
  useEffect(() => {
    setInfo(undefined);
    if (!e164) return;
    let live = true;
    analyzeNumber(e164).then((a) => live && setInfo(a)).catch(() => live && setInfo(null));
    return () => { live = false; };
  }, [e164]);
  // Remember valid numbers once typing settles, so half-typed numbers never land in the list.
  useEffect(() => {
    if (!info || !info.valid || !det || !det.name) return;
    const id = setTimeout(() => setRecent((l) => { const n = addRecent(l, { host: det.e164, label: `${det.flag} ${det.name}` }); saveRecent(RECENT_KEY, n); return n; }), 1200);
    return () => clearTimeout(id);
  }, [info]); // det is derived from the same input that produced info

  const showError = det && det.error && input.trim();
  const found = det && det.name;
  // Announced once per change (the visible result holds a ticking clock, so it is not itself live).
  const liveMsg = showError ? `Can't detect the country. ${det.error}`
    : found ? `${det.name}, +${det.dial}${info ? `. ${validityText(info)}, ${info.typeLabel || "type unknown"}` : ""}` : "";

  return (
    <div className="ph-tool">
      <div className="ph-hero rise d1">
        <label htmlFor="ph-n" className="ph-lbl">Phone number</label>
        <div className="ph-field">
          <Phone size={18} aria-hidden="true" className="ph-ic" />
          <input id="ph-n" className="inp ph-inp" type="tel" inputMode="tel" autoComplete="off" spellCheck={false}
            placeholder="+44 20 7183 8750" value={input} aria-describedby="ph-hint"
            aria-invalid={showError ? "true" : undefined} onChange={(e) => setInput(e.target.value)} />
          {input && (
            <button type="button" className="ph-x" aria-label="Clear phone number" onClick={() => { setInput(""); document.getElementById("ph-n")?.focus(); }}>
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="hint" id="ph-hint">Start with + and the country code. Spaces, dashes and brackets are fine.</p>
        {!input.trim() && (
          <div className="ph-try">
            <span className="ph-try-l" id="ph-try-l">Try</span>
            <div className="ph-try-r" role="group" aria-labelledby="ph-try-l">
              {EXAMPLES.map((s) => <button key={s} type="button" className="pill" onClick={() => setInput(s)}>{s}</button>)}
            </div>
          </div>
        )}
        <RecentChecks items={recent} onPick={setInput} onClear={() => { setRecent([]); saveRecent(RECENT_KEY, []); }} />
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">{liveMsg}</p>
      <div className="ph-out">
        {showError && <Notice tone="w" title="Can't detect the country">{det.error}</Notice>}

        {found && (
          <section className="panel ph-res" aria-labelledby="ph-country">
            <div className="ph-head">
              <span className="ph-flag" aria-hidden="true">{det.flag}</span>
              <div className="ph-id">
                <h2 id="ph-country">{det.name}</h2>
                <div className="ph-meta">
                  <span className="ph-dial">+{det.dial}{det.area ? ` · area ${det.area}` : ""}</span>
                  <Verdict det={det} info={info} />
                  {det.assumed && <StatusBadge tone="warn" icon={Info}>Prefix assumed</StatusBadge>}
                </div>
              </div>
            </div>

            <div className="ph-fmts">
              <FormatRow label="International" value={det.intl} notify={notify} toast="International format copied." />
              <FormatRow label="E.164" value={det.e164} notify={notify} toast="Number copied." />
              {info && info.valid && <FormatRow label="National" value={info.national} notify={notify} toast="National format copied." />}
            </div>

            <div className="kv ph-tz">
              <span className="k"><Clock size={13} aria-hidden="true" />Local time</span>
              <span className="v">{det.zone} · now <ZoneNow zone={det.zone} /></span>
            </div>

            <div className="actions ph-acts">
              <a className="btn gh sm" href={`https://wa.me/${det.dial}${det.national}`} target="_blank" rel="noreferrer">
                <MessageCircle size={14} aria-hidden="true" />WhatsApp<span className="sr-only"> (opens in a new tab)</span>
              </a>
              <a className="btn gh sm" href={`tel:${det.e164}`}><PhoneCall size={14} aria-hidden="true" />Call</a>
              <CopyButton text={() => window.location.href} icon={false} className="btn gh sm" notify={notify} toast="Link copied — reopens this number."
                label={<><Link2 size={14} aria-hidden="true" />Share link</>} done="Link copied" />
            </div>
          </section>
        )}
      </div>

      <Notice tone="i" title="What this shows" className="ph-note">
        The numbering country or region a number belongs to. It can never reveal the owner, the live location,
        or where the phone physically is right now.
      </Notice>
    </div>
  );
}
