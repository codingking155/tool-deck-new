// Real WhatsApp provider (Meta WhatsApp Cloud API). Uses an approved template
// when WHATSAPP_TEMPLATE_NAME is set, else a plain text message (session-window only).
// All credentials, the phone-number id and the template name come from env.
export function createMetaWhatsappProvider() {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const template = Deno.env.get("WHATSAPP_TEMPLATE_NAME");
  const lang = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "en";

  return {
    name: "meta",
    async send(msg: { to: string; body: string; templateParams?: string[] }) {
      if (!token || !phoneId) return { ok: false, error: "whatsapp provider not configured", provider: "meta" };
      const to = msg.to.replace(/^\+/, "");
      const payload = template
        ? {
            messaging_product: "whatsapp", to, type: "template",
            template: {
              name: template, language: { code: lang },
              components: [{ type: "body", parameters: (msg.templateParams ?? []).map((t) => ({ type: "text", text: t })) }],
            },
          }
        : { messaging_product: "whatsapp", to, type: "text", text: { body: msg.body } };
      try {
        const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) return { ok: false, error: `meta ${res.status}`, provider: "meta" };
        const data = await res.json().catch(() => ({}));
        return { ok: true, id: data?.messages?.[0]?.id ?? null, provider: "meta" };
      } catch (e) {
        return { ok: false, error: String((e as Error).message ?? e), provider: "meta" };
      }
    },
  };
}
