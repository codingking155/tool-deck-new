import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Package, X } from "lucide-react";
import { BetaBadge, CopyButton, Notice } from "../../components/ui.jsx";
import { createAlertsApi } from "./api.js";
import { validateAlertInput } from "../../../shared/priceAlertsCore/validation.mjs";
import "./alerts.css";

function money(n, currency = "INR") {
  try { return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(Number(n)); }
  catch { return `${currency} ${n}`; }
}

export default function SetPriceAlert({
  product,                 // { id, trackedProductId, name, image, url, currentPrice, currency, originalPrice }
  signedIn = false,
  defaultEmail = "",
  defaultPhone = "",
  functionsBase,
  getToken,
  manageBaseUrl,           // for building the guest manage link shown on success
  initialTarget,           // target price already typed in the tool (optional)
  onClose,
  onCreated,
}) {

  const api = createAlertsApi({ functionsBase, getToken });
  const cur = product.currency || "INR";

  const [form, setForm] = useState({
    targetPrice: Number(initialTarget) > 0 ? Number(initialTarget)
      : product.currentPrice ? Math.max(1, Math.floor(product.currentPrice * 0.9)) : "",
    email: defaultEmail, phone: defaultPhone,
    emailEnabled: true, whatsappEnabled: false, consent: false,
  });
  const [errors, setErrors] = useState({});
  const [state, setState] = useState("idle"); // idle | submitting | success | error
  const [serverError, setServerError] = useState("");
  const [result, setResult] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setServerError("");
    const payload = {
      productId: product.id, trackedProductId: product.trackedProductId, productName: product.name, productImage: product.image,
      productUrl: product.url, currency: cur, originalPrice: product.originalPrice ?? null,
      ...form,
    };
    const v = validateAlertInput(payload, { signedIn });
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({});
    setState("submitting");
    try {
      const res = await api.create(payload);
      setResult(res);
      setState("success");
      onCreated && onCreated(res.alert);
    } catch (e) {
      if (e.fields) { setErrors(e.fields); setState("idle"); }
      else { setServerError(e.message || "Could not create the alert."); setState("error"); }
    }
  }

  const manageLink = result?.manageToken && manageBaseUrl
    ? `${manageBaseUrl}?t=${encodeURIComponent(result.manageToken)}`
    : null;

  /* Portal to the app root: rendered in place, an ancestor's transform/backdrop-filter
     re-anchors position:fixed (cutting the dialog off) and traps it under page layers.
     Mounting inside .app (not <body>) keeps the light/dark theme variables. */
  /* keyboard: Escape closes, focus moves into the dialog, Tab stays inside it,
     and focus returns to whatever opened it */
  const boxRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const opener = document.activeElement;
    const focusables = () => [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    (box.querySelector("input") || focusables()[0])?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    box.addEventListener("keydown", onKey);
    return () => { box.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, []);   // once per open — onClose is often a fresh inline function

  /* the form (and its focused control) unmounts on success — keep focus inside the dialog */
  useEffect(() => {
    if (state === "success") boxRef.current?.querySelector(".pa-success .pa-submit")?.focus();
  }, [state]);

  const host = (typeof document !== "undefined" && (document.querySelector(".app") || document.body)) || null;
  const dialog = (
    <div className="pa-overlay" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="pa-dialog" role="dialog" aria-modal="true" aria-label="Set price alert" ref={boxRef}>
        <div className="pa-head">
          <h2>Set price alert <BetaBadge /></h2>
          <button type="button" className="btn qt ico sm pa-x" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>

        <div className="pa-body">
          <div className="pa-prod">
            {product.image
              ? <img src={product.image} alt={product.name || "product"} referrerPolicy="no-referrer" />
              : <div className="pa-noimg" aria-hidden="true"><Package size={22} strokeWidth={1.7} /></div>}
            <div className="pa-pmeta">
              <div className="pa-pname">{product.name || "Tracked product"}</div>
              <div className="pa-pcur">Current price {product.currentPrice != null ? money(product.currentPrice, cur) : "—"}</div>
            </div>
          </div>

          {state === "success" ? (
            <div className="pa-success" role="status">
              <div className="pa-tick" aria-hidden="true"><Check size={24} strokeWidth={2.6} /></div>
              <p className="pa-success-h">Alert set.</p>
              <Notice tone="i" className="pa-success-note"><p>
                We'll notify you when <b>{product.name || "this product"}</b> reaches{" "}
                <b>{money(form.targetPrice, cur)}</b> or less{form.emailEnabled && form.email ? <> at <b>{form.email}</b></> : null}
                {form.whatsappEnabled && form.phone ? <> and on WhatsApp at <b>{form.phone}</b></> : null}.
              </p></Notice>
              {manageLink && (
                <div className="pa-manage">
                  <p className="pa-manage-tx">
                    Keep this private link to manage or cancel the alert (you're not signed in, so it won't be saved anywhere else):
                  </p>
                  <div className="pa-managelink">{manageLink}</div>
                  <CopyButton text={manageLink} label="Copy link" done="Link copied" className="btn gh sm pa-copy" />
                </div>
              )}
              <button type="button" className="btn pri pa-submit" onClick={onClose}>Done</button>
            </div>
          ) : (
            <>
              {serverError && (
                <Notice tone="e" title="Couldn't save." className="pa-formerr">{serverError}</Notice>
              )}

              <div className="field">
                <label htmlFor="pa-target">Target price ({cur})</label>
                <input id="pa-target" type="number" min="1" inputMode="decimal"
                  className={`mono${errors.targetPrice ? " pa-invalid" : ""}`}
                  aria-invalid={!!errors.targetPrice} aria-describedby={errors.targetPrice ? "pa-target-err" : undefined}
                  value={form.targetPrice}
                  onChange={(e) => set("targetPrice", e.target.value)}
                  placeholder="e.g. 4999" />
                {errors.targetPrice && <div id="pa-target-err" className="pa-err" role="alert">{errors.targetPrice}</div>}
              </div>

              <div className="field">
                <label htmlFor="pa-email">Email address</label>
                <input id="pa-email" type="email" autoComplete="email"
                  className={errors.email ? "pa-invalid" : ""}
                  aria-invalid={!!errors.email} aria-describedby={errors.email ? "pa-email-err" : undefined}
                  value={form.email} onChange={(e) => set("email", e.target.value)}
                  placeholder="you@example.com" />
                {errors.email && <div id="pa-email-err" className="pa-err" role="alert">{errors.email}</div>}
              </div>

              <div className="field">
                <label htmlFor="pa-phone">WhatsApp number (with country code)</label>
                <input id="pa-phone" type="tel" autoComplete="tel"
                  className={`mono${errors.phone ? " pa-invalid" : ""}`}
                  aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "pa-phone-err" : undefined}
                  value={form.phone} onChange={(e) => set("phone", e.target.value)}
                  placeholder="+91 98765 43210" />
                {errors.phone && <div id="pa-phone-err" className="pa-err" role="alert">{errors.phone}</div>}
              </div>

              <fieldset className="pa-channels">
                <legend>Notify me by</legend>
                <label className="pa-check">
                  <input type="checkbox" checked={form.emailEnabled} onChange={(e) => set("emailEnabled", e.target.checked)}
                    aria-invalid={!!errors.channels} aria-describedby={errors.channels ? "pa-channels-err" : undefined} />
                  <span>Notify me by email</span>
                </label>
                <label className="pa-check">
                  <input type="checkbox" checked={form.whatsappEnabled} onChange={(e) => set("whatsappEnabled", e.target.checked)}
                    aria-invalid={!!errors.channels} aria-describedby={errors.channels ? "pa-channels-err" : undefined} />
                  <span>Notify me on WhatsApp</span>
                </label>
                {errors.channels && <div id="pa-channels-err" className="pa-err" role="alert">{errors.channels}</div>}
              </fieldset>

              <label className="pa-check pa-consent">
                <input type="checkbox" checked={form.consent} onChange={(e) => set("consent", e.target.checked)}
                  aria-invalid={!!errors.consent} aria-describedby={errors.consent ? "pa-consent-err" : undefined} />
                <span>I agree to receive price-alert messages at the contact details above and understand I can unsubscribe anytime.</span>
              </label>
              {errors.consent && <div id="pa-consent-err" className="pa-err" role="alert">{errors.consent}</div>}

              <button type="button" className="btn pri pa-submit" disabled={state === "submitting"} onClick={submit}>
                {state === "submitting" ? "Setting alert…" : "Set price alert"}
              </button>
              <p className="hint pa-foot">
                We compare your target with the live Amazon price on every check. Prices can change between our check and your purchase.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
  return host ? createPortal(dialog, host) : dialog;
}
