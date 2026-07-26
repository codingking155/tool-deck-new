// Framework-agnostic validation shared by the API, the UI, and the tests.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email) {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email.trim());
}

// Normalise to E.164 (+ then 8–15 digits). Returns the normalised string or null.
export function normalizePhoneE164(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/[()\-.\s]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) return null;
  const digits = s.slice(1);
  if (!/^\d{8,15}$/.test(digits)) return null;
  if (digits[0] === "0") return null; // country code can't start with 0
  return "+" + digits;
}

export function isValidE164(phone) {
  return normalizePhoneE164(phone) !== null;
}

export function validateTargetPrice(value) {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) && n > 0;
}

// Validate the full create/update payload.
// opts.signedIn — a signed-in customer may omit contact fields for a channel
// only if their account supplies them; the caller passes the resolved values in.
export function validateAlertInput(input = {}, opts = {}) {
  const errors = {};
  const emailEnabled = !!input.emailEnabled;
  const whatsappEnabled = !!input.whatsappEnabled;

  if (!validateTargetPrice(input.targetPrice)) {
    errors.targetPrice = "Enter a target price greater than 0.";
  }
  if (!emailEnabled && !whatsappEnabled) {
    errors.channels = "Choose at least one notification channel.";
  }
  const email = (input.email || "").trim();
  const phone = normalizePhoneE164(input.phone || "");

  // Email required when the email channel is on, or always for guests.
  if (emailEnabled || !opts.signedIn) {
    if (!email) errors.email = "Enter your email address.";
    else if (!isValidEmail(email)) errors.email = "That email address doesn't look right.";
  }
  // WhatsApp phone required when the WhatsApp channel is on, or always for guests.
  if (whatsappEnabled || !opts.signedIn) {
    if (!input.phone || !String(input.phone).trim()) {
      errors.phone = "Enter your WhatsApp number with country code.";
    } else if (!phone) {
      errors.phone = "Enter a valid number in international format, e.g. +919876543210.";
    }
  }
  if (!input.consent) {
    errors.consent = "Please accept the consent notice to continue.";
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok
      ? {
          productId: String(input.productId),
          productName: input.productName || null,
          productImage: input.productImage || null,
          productUrl: input.productUrl || null,
          email: email || null,
          phone: phone || null,
          targetPrice: Math.round(Number(input.targetPrice) * 100) / 100,
          currency: input.currency || "INR",
          originalPrice: input.originalPrice != null ? Number(input.originalPrice) : null,
          emailEnabled,
          whatsappEnabled,
        }
      : null,
  };
}

// Canonical key used to reason about duplicates in code (the DB also enforces this
// with a partial unique index on active rows).
export function dedupeKey({ productId, userId, email, phone, targetPrice }) {
  return [
    String(productId),
    userId || "",
    (email || "").toLowerCase(),
    phone || "",
    Number(targetPrice).toFixed(2),
  ].join("|");
}
