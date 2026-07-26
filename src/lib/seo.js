/** Dynamic <head> management: title, description, canonical, OG/Twitter, JSON-LD. */

export const SITE = "https://tooldeck.in"; /* ← set to your deployed origin */

export function setMeta(key, content, attr = "name") {
  if (content == null) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute("content", content);
}

export function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement("link"); el.setAttribute("rel", rel); document.head.appendChild(el); }
  el.setAttribute("href", href);
}

export function setJsonLd(id, obj) {
  let el = document.getElementById(id);
  if (!obj) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("script"); el.type = "application/ld+json"; el.id = id; document.head.appendChild(el); }
  el.textContent = JSON.stringify(obj);
}
