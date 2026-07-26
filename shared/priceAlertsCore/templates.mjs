// Message builders. No side effects, no provider coupling — providers receive
// the built payloads. Keeps templates unit-testable and provider-swappable.

import { computeSavings } from "./pricing.mjs";

function money(amount, currency = "INR") {
  const n = Number(amount);
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency", currency, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function buildEmail(alert, ctx) {
  const { currentPrice, productUrl, unsubscribeUrl } = ctx;
  const cur = alert.currency || "INR";
  const savings = computeSavings(alert.original_price ?? ctx.previousPrice, currentPrice);
  const subject = `Price drop: ${alert.product_name || "your product"} is now ${money(currentPrice, cur)}`;

  const text = [
    `${alert.product_name || "Your tracked product"} hit your target.`,
    ``,
    `Current price: ${money(currentPrice, cur)}`,
    `Your target:   ${money(alert.target_price, cur)}`,
    savings ? `You save:      ${money(savings.amount, cur)} (${savings.percent}%)` : ``,
    ``,
    `Buy now: ${productUrl}`,
    ``,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].filter(Boolean).join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Inter,Arial,sans-serif;color:#1b2333">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e8ec">
      <tr><td style="background:#07090F;color:#FFB454;padding:16px 22px;font-weight:700">ToolDeck BLR · Price Alert <span style="background:#FF8A2A;color:#2A1500;font-size:11px;padding:2px 8px;border-radius:99px;margin-left:6px">BETA</span></td></tr>
      ${alert.product_image ? `<tr><td style="padding:18px 22px 0"><img src="${esc(alert.product_image)}" alt="${esc(alert.product_name || "product")}" width="180" style="max-width:100%;border-radius:10px"></td></tr>` : ""}
      <tr><td style="padding:14px 22px 0"><h2 style="margin:0;font-size:18px">${esc(alert.product_name || "Your tracked product")}</h2></td></tr>
      <tr><td style="padding:12px 22px">
        <p style="margin:0 0 6px"><b style="color:#0f7d4a;font-size:20px">${money(currentPrice, cur)}</b> <span style="color:#6b7280">now</span></p>
        <p style="margin:0;color:#6b7280">Your target ${money(alert.target_price, cur)}${savings ? ` · you save <b style="color:#0f7d4a">${money(savings.amount, cur)} (${savings.percent}%)</b>` : ""}</p>
      </td></tr>
      <tr><td style="padding:6px 22px 20px"><a href="${esc(productUrl)}" style="display:inline-block;background:#FF8A2A;color:#2A1500;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:10px">Buy now →</a></td></tr>
      <tr><td style="padding:14px 22px;border-top:1px solid #eef0f3;color:#9aa2b1;font-size:12px">You're getting this because you set a price alert. <a href="${esc(unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>.</td></tr>
    </table>
  </td></tr></table></body></html>`;

  return { subject, text, html };
}

export function buildWhatsapp(alert, ctx) {
  const { currentPrice, productUrl } = ctx;
  const cur = alert.currency || "INR";
  const body =
    `🔔 *Price alert* (beta)\n` +
    `${alert.product_name || "Your product"} is now *${money(currentPrice, cur)}* ` +
    `(target ${money(alert.target_price, cur)}).\n` +
    `Buy now: ${productUrl}\n\n` +
    `Reply STOP to opt out.`;
  // Structured params also returned for providers that use approved templates.
  return {
    body,
    templateParams: [
      alert.product_name || "your product",
      money(currentPrice, cur),
      money(alert.target_price, cur),
      productUrl,
    ],
  };
}
