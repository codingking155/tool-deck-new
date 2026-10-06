import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { createAlertsApi } from "./api.js";
import { validateAlertInput } from "../../../shared/priceAlertsCore/validation.mjs";

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

  const host = (typeof document !== "undefined" && (document.querySelector(".app") || document.body)) || null;
  const dialog = (
    <div className="pa-overlay" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="pa-dialog" role="dialog" aria-modal="true" aria-label="Set price alert" ref={boxRef}>
        <div className="pa-head">
          <h2>Set price alert <span className="pa-beta">Beta</span></h2>
          <button className="pa-x" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="pa-body">
          <div className="pa-prod">
            {product.image
              ? <img src={product.image} alt={product.name || "product"} />
              : <div className="pa-noimg">🛍️</div>}
            <div>
              <div className="pa-pname">{product.name || "Tracked product"}</div>
              <div className="pa-pcur">Current price {product.currentPrice != null ? money(product.currentPrice, cur) : "—"}</div>
            </div>
          </div>

          {state === "success" ? (
            <div className="pa-success" role="status">
              <div className="pa-tick">✓</div>
              <p style={{ fontWeight: 600, marginBottom: 6 }}>Alert set.</p>
              <p className="note i" style={{ display: "block", textAlign: "left" }}>
                We'll notify you when <b>{product.name || "this product"}</b> reaches{" "}
                <b>{money(form.targetPrice, cur)}</b> or less{form.emailEnabled && form.email ? <> at <b>{form.email}</b></> : null}
                {form.whatsappEnabled && form.phone ? <> and on WhatsApp at <b>{form.phone}</b></> : null}.
              </p>
              {manageLink && (
                <div style={{ textAlign: "left" }}>
                  <p style={{ fontSize: 12, color: "var(--tx2)", marginBottom: 4 }}>
                    Keep this private link to manage or cancel the alert (you're not signed in, so it won't be saved anywhere else):
                  </p>
                  <div className="pa-managelink">{manageLink}</div>
                </div>
              )}
              <button className="btn pri" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
            </div>
          ) : (
            <>
              {serverError && <div className="pa-formerr" role="alert"><b>Couldn't save.</b> {serverError}</div>}

              <div className="field">
                <label htmlFor="pa-target">Target price ({cur})</label>
                <input id="pa-target" type="number" min="1" inputMode="decimal"
                  className={errors.targetPrice ? "pa-invalid" : ""}
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
                  className={errors.phone ? "pa-invalid" : ""}
                  aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "pa-phone-err" : undefined}
                  value={form.phone} onChange={(e) => set("phone", e.target.value)}
                  placeholder="+91 98765 43210" />
                {errors.phone && <div id="pa-phone-err" className="pa-err" role="alert">{errors.phone}</div>}
              </div>

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

              <label className="pa-check" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={form.consent} onChange={(e) => set("consent", e.target.checked)}
                  aria-invalid={!!errors.consent} aria-describedby={errors.consent ? "pa-consent-err" : undefined} />
                <span>I agree to receive price-alert messages at the contact details above and understand I can unsubscribe anytime.</span>
              </label>
              {errors.consent && <div id="pa-consent-err" className="pa-err" role="alert">{errors.consent}</div>}

              <button className="btn pri" style={{ marginTop: 14 }} disabled={state === "submitting"} onClick={submit}>
                {state === "submitting" ? "Setting alert…" : "Set price alert"}
              </button>
              <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
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
