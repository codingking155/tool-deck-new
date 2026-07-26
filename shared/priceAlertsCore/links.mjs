// URL builders. `base` is APP_BASE_URL (e.g. https://tooldeck.in).

export function productLink(base, alert) {
  if (alert.product_url) return alert.product_url;
  return `${trim(base)}/tool/price?p=${encodeURIComponent(alert.product_id)}`;
}

export function manageLink(base, token) {
  return `${trim(base)}/tool/price/alerts?t=${encodeURIComponent(token)}`;
}

export function unsubscribeLink(functionsBase, token, channel = "all") {
  return `${trim(functionsBase)}/price-alerts-unsubscribe?token=${encodeURIComponent(token)}&channel=${channel}`;
}

function trim(u) {
  return String(u || "").replace(/\/+$/, "");
}
