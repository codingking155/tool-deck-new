/* Minimal RFC 5545 calendar helpers (UTC times only). */

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (t) => String(t).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets are folded with CRLF + space. */
function fold(line) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let i = 0, limit = 75;
  while (i < bytes.length) {
    let end = Math.min(i + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // don't split a UTF-8 character
    parts.push(dec.decode(bytes.slice(i, end)));
    i = end; limit = 74;
  }
  return parts.join("\r\n ");
}

export function buildIcs({ title, startUtc, durationMin = 15, description = "", uid = `${Date.now()}@tooldeck.in`, now = new Date() }) {
  const end = new Date(startUtc.getTime() + durationMin * 60000);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ToolDeck//UTC Wait-Time Generator//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(startUtc)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`, ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, "TRIGGER:-PT10M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl({ title, startUtc, durationMin = 15, details = "" }) {
  const end = new Date(startUtc.getTime() + durationMin * 60000);
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${stamp(startUtc)}/${stamp(end)}`, details });
  return `https://calendar.google.com/calendar/render?${q}`;
}
