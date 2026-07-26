// Real email provider (Resend). Credentials come from env only.
export function createResendProvider() {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM") ?? "ToolDeck Alerts <alerts@tooldeck.in>";
  return {
    name: "resend",
    async send(msg: { to: string; subject: string; html: string; text: string }) {
      if (!apiKey) return { ok: false, error: "email provider not configured", provider: "resend" };
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
        });
        if (!res.ok) return { ok: false, error: `resend ${res.status}`, provider: "resend" };
        const data = await res.json().catch(() => ({}));
        return { ok: true, id: data.id ?? null, provider: "resend" };
      } catch (e) {
        return { ok: false, error: String((e as Error).message ?? e), provider: "resend" };
      }
    },
  };
}
