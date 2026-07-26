import { useState } from "react";
import { createAlertsApi } from "./api.js";
import { validateAlertInput } from "../../../shared/priceAlertsCore/validation.mjs";

function money(n, currency = "INR") {
  try { return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(Number(n)); }
  catch { return `${currency} ${n}`; }
}

export default function SetPriceAlert({
  product,                 // { id, name, image, url, currentPrice, currency, originalPrice }
  signedIn = false,
  defaultEmail = "",
  defaultPhone = "",
  functionsBase,
  getToken,
  manageBaseUrl,           // for building the guest manage link shown on success
  onClose,
  onCreated,
}) {

  const api = createAlertsApi({ functionsBase, getToken });
  const cur = product.currency || "INR";

  const [form, setForm] = useState({
    targetPrice: product.currentPrice ? Math.max(1, Math.floor(product.currentPrice * 0.9)) : "",
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
      productId: product.id, productName: product.name, productImage: product.image,
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

  return (
    <div className="pa-overlay" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="pa-dialog" role="dialog" aria-modal="true" aria-label="Set price alert">
        <div className="pa-head">
          <h3>Set price alert <span className="pa-beta">Beta</span></h3>
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
            <div className="pa-success">
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
              {serverError && <div className="pa-formerr"><b>Couldn't save.</b> {serverError}</div>}

              <div className="field">
                <label htmlFor="pa-target">Target price ({cur})</label>
                <input id="pa-target" type="number" min="1" inputMode="decimal"
                  className={errors.targetPrice ? "pa-invalid" : ""}
                  value={form.targetPrice}
                  onChange={(e) => set("targetPrice", e.target.value)}
                  placeholder="e.g. 4999" />
                {errors.targetPrice && <div className="pa-err">{errors.targetPrice}</div>}
              </div>

              <div className="field">
                <label htmlFor="pa-email">Email address</label>
                <input id="pa-email" type="email" autoComplete="email"
                  className={errors.email ? "pa-invalid" : ""}
                  value={form.email} onChange={(e) => set("email", e.target.value)}
                  placeholder="you@example.com" />
                {errors.email && <div className="pa-err">{errors.email}</div>}
              </div>

              <div className="field">
                <label htmlFor="pa-phone">WhatsApp number (with country code)</label>
                <input id="pa-phone" type="tel" autoComplete="tel"
                  className={errors.phone ? "pa-invalid" : ""}
                  value={form.phone} onChange={(e) => set("phone", e.target.value)}
                  placeholder="+91 98765 43210" />
                {errors.phone && <div className="pa-err">{errors.phone}</div>}
              </div>

              <label className="pa-check">
                <input type="checkbox" checked={form.emailEnabled} onChange={(e) => set("emailEnabled", e.target.checked)} />
                <span>Notify me by email</span>
              </label>
              <label className="pa-check">
                <input type="checkbox" checked={form.whatsappEnabled} onChange={(e) => set("whatsappEnabled", e.target.checked)} />
                <span>Notify me on WhatsApp</span>
              </label>
              {errors.channels && <div className="pa-err">{errors.channels}</div>}

              <label className="pa-check" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={form.consent} onChange={(e) => set("consent", e.target.checked)} />
                <span>I agree to receive price-alert messages at the contact details above and understand I can unsubscribe anytime.</span>
              </label>
              {errors.consent && <div className="pa-err">{errors.consent}</div>}

              <button className="btn pri" style={{ marginTop: 14 }} disabled={state === "submitting"} onClick={submit}>
                {state === "submitting" ? "Setting alert…" : "Set price alert"}
              </button>
              <p className="note w" style={{ marginTop: 12, marginBottom: 0 }}>
                Beta: the current price shown here comes from ToolDeck's demo price source, so alerts are for trying the flow, not live buying decisions.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
