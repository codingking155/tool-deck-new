import { useState, useEffect, useMemo } from "react";
import { Phone, X, CircleCheck, CircleAlert, CircleX, Loader2, MessageCircle, PhoneCall, Link2, Clock, Info } from "lucide-react";
import { analyzeNumber, validityText, nationalToE164 } from "../lib/phoneCheck.js";
import { detectPhone, nationalDigits, REGION_INFO, REGION_LIST } from "../lib/phone.js";
import { fmtLocal, offsetLabel, offsetMinutes, zoneParts, DAYS, USER_TZ } from "../lib/time.js";
import { callWindow, diffText } from "../lib/phoneCall.js";
import PhoneBatch from "./PhoneBatch.jsx";
import { useNow, readParams, writeParams } from "../hooks/index.js";
import { Notice, StatusBadge, CopyButton } from "../components/ui.jsx";
import RecentChecks from "../components/RecentChecks.jsx";
import { addRecent, loadRecent, saveRecent } from "../lib/recentChecks.js";
import "./css/phone.css";

const RECENT_KEY = "toolDeck.phoneRecent";
const EXAMPLES = ["+91 98765 43210", "+1 416 555 0199", "+44 20 7183 8750", "+81 3 1234 5678"];
const REGION_KEY = "toolDeck.phoneRegion";
const isRegion = (v) => typeof v === "string" && Object.prototype.hasOwnProperty.call(REGION_INFO, v);

/* Country for numbers typed without +: the share link's ?cc= wins, then the last one picked on this device. */
function initialRegion() {
  const cc = readParams().get("cc");
  if (isRegion(cc)) return cc;
  try { const v = localStorage.getItem(REGION_KEY); return isRegion(v) ? v : ""; } catch { return ""; }
}

/* Ticks every second — a leaf so the input and result don't re-render with it. */
function ZoneNow({ zone }) {
  const now = useNow(1000);
  const p = zoneParts(now, zone);
  const dow = DAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  const [tone, text] = callWindow(p.hour);
  const diff = offsetMinutes(zone, now) - offsetMinutes(USER_TZ, now);
  return (
    <>
      <div className="kv ph-tz">
        <span className="k"><Clock size={13} aria-hidden="true" />Local time</span>
        <span className="v">{dow} {fmtLocal(now, zone)} <span className="ph-off">{offsetLabel(zone, now)} · {diffText(diff)}</span></span>
      </div>
      <div className="kv ph-tz"><span className="k">Timezone</span><span className="v">{zone}</span></div>
      <div className={`ph-call ${tone}`}><span className="dot" aria-hidden="true" />{text}</div>
    </>
  );
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
  const [mode, setMode] = useState(() => (readParams().get("mode") === "batch" ? "batch" : "single"));
  return (
    <div className="ph-tool">
      <div className="seg ph-mode" role="group" aria-label="Mode">
        <button type="button" aria-pressed={mode === "single"} onClick={() => { setMode("single"); writeParams({ mode: null }); }}>Single number</button>
        <button type="button" aria-pressed={mode === "batch"} onClick={() => { setMode("batch"); writeParams({ mode: "batch", n: null, cc: null }); }}>Batch</button>
      </div>
      {mode === "single" ? <Single notify={notify} /> : <PhoneBatch notify={notify} />}
      <Notice tone="i" title="What this shows" className="ph-note">
        The numbering country or region a number belongs to. It can never reveal the owner, the live location,
        or where the phone physically is right now. Numbers are checked in your browser and never sent anywhere.
      </Notice>
    </div>
  );
}

function Single({ notify }) {
  const [input, setInput] = useState(() => readParams().get("n") || "");
  useEffect(() => { writeParams({ n: input.trim() || null }); }, [input]);
  const raw = useMemo(() => detectPhone(input), [input]);
  const [region, setRegion] = useState(initialRegion);
  const pickRegion = (iso) => {
    setRegion(iso);
    try { if (iso) localStorage.setItem(REGION_KEY, iso); else localStorage.removeItem(REGION_KEY); } catch { /* storage unavailable */ }
  };
  // No + / 00 typed: re-read the digits as a national number of the picked country.
  const natDigits = nationalDigits(raw);
  const natKey = natDigits && region ? `${region}:${natDigits}` : "";
  const [nat, setNat] = useState(null); // { key, e164 } for the last resolved natKey
  useEffect(() => { writeParams({ cc: natDigits && region ? region : null }); }, [natDigits, region]);
  useEffect(() => {
    if (!natKey) return;
    let live = true;
    nationalToE164(natDigits, region).then((e164) => live && setNat({ key: natKey, e164 }))
      .catch(() => live && setNat({ key: natKey, e164: null }));
    return () => { live = false; };
  }, [natKey]); // natKey encodes natDigits + region
  const det = useMemo(() => {
    if (!natKey) return raw;
    if (!nat || nat.key !== natKey) return raw.trunk ? null : raw; // resolving
    const d = nat.e164 && detectPhone(nat.e164);
    if (d && d.e164) return { ...d, ext: raw.ext, fromRegion: region };
    // Not a possible number there: a trunk number has nothing to fall back on; an assumed one keeps the prefix guess.
    return raw.trunk ? { error: `This isn't a possible number in ${REGION_INFO[region].name}. Check the digits, pick another country, or add the international prefix.` } : raw;
  }, [raw, natKey, nat, region]);
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
    <>
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
        {natDigits && (
          <div className="field ph-region">
            <label htmlFor="ph-cc">{raw.trunk ? "Country this number is from" : "No + typed — country it's from"}</label>
            <select id="ph-cc" value={region} onChange={(e) => pickRegion(e.target.value)}>
              <option value="">{raw.trunk ? "Choose a country…" : "None — read the first digits as the country code"}</option>
              {REGION_LIST.map((r) => <option key={r.iso} value={r.iso}>{r.name}</option>)}
            </select>
          </div>
        )}
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
                  {det.fromRegion && <StatusBadge icon={Info}>{`Read as a ${REGION_INFO[det.fromRegion].name} number`}</StatusBadge>}
                </div>
              </div>
            </div>

            <div className="ph-fmts">
              <FormatRow label="International" value={det.intl} notify={notify} toast="International format copied." />
              <FormatRow label="E.164" value={det.e164} notify={notify} toast="Number copied." />
              {info && info.valid && <FormatRow label="National" value={info.national} notify={notify} toast="National format copied." />}
            </div>

            <ZoneNow zone={det.zone} />

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

    </>
  );
}
