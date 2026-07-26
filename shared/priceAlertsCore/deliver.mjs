import { buildEmail, buildWhatsapp } from "./templates.mjs";

// Attempts each enabled channel independently and returns a per-channel result.
// A WhatsApp failure never throws — email still sends and the run continues
// (beta requirement: the feature keeps working if WhatsApp is unavailable).
export async function deliverAlert(alert, ctx, providers = {}) {
  const results = { email: { status: "skipped" }, whatsapp: { status: "skipped" } };

  if (alert.email_enabled && alert.email && providers.email) {
    try {
      const m = buildEmail(alert, ctx);
      const r = await providers.email.send({ to: alert.email, subject: m.subject, html: m.html, text: m.text });
      results.email = r.ok
        ? { status: "sent", id: r.id, provider: r.provider }
        : { status: "failed", error: r.error, provider: r.provider };
    } catch (e) {
      results.email = { status: "failed", error: errMsg(e) };
    }
  }

  if (alert.whatsapp_enabled && alert.phone && providers.whatsapp) {
    try {
      const m = buildWhatsapp(alert, ctx);
      const r = await providers.whatsapp.send({ to: alert.phone, body: m.body, templateParams: m.templateParams });
      results.whatsapp = r.ok
        ? { status: "sent", id: r.id, provider: r.provider }
        : { status: "failed", error: r.error, provider: r.provider };
    } catch (e) {
      results.whatsapp = { status: "failed", error: errMsg(e) };
    }
  }

  return results;
}

function errMsg(e) { return String((e && e.message) || e); }
