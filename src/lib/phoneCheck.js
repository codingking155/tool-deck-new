/* Validity and line type from libphonenumber-js (full metadata), loaded only when a number is detected. */

const TYPE_LABEL = {
  MOBILE: "Mobile", FIXED_LINE: "Landline", FIXED_LINE_OR_MOBILE: "Landline or mobile", TOLL_FREE: "Toll-free",
  PREMIUM_RATE: "Premium-rate", SHARED_COST: "Shared-cost", VOIP: "VoIP", PERSONAL_NUMBER: "Personal number",
  PAGER: "Pager", UAN: "Universal access number", VOICEMAIL: "Voicemail",
};

export async function analyzeNumber(e164) {
  const { parsePhoneNumberFromString } = await import("libphonenumber-js/max");
  const p = parsePhoneNumberFromString(String(e164));
  if (!p) return null;
  const type = p.getType() ?? null;
  return {
    valid: p.isValid(), possible: p.isPossible(), type, typeLabel: type ? TYPE_LABEL[type] || type : null,
    country: p.country ?? null, national: p.formatNational(), international: p.formatInternational(),
  };
}

export const validityText = (a) => (a.valid ? "Valid number" : a.possible ? "Right length, but not a valid number" : "Not a valid number");
