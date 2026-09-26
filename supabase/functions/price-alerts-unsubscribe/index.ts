import { preflight, json, fail, CORS, log } from "../_shared/http.ts";
import { serviceClient, requireEnv } from "../_shared/supabase.ts";
import { verifyManageToken } from "../../../shared/priceAlertsCore/tokens.mjs";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    const channel = (url.searchParams.get("channel") ?? "all").toLowerCase();

    const alertId = token ? await verifyManageToken(token, requireEnv("ALERT_TOKEN_SECRET")) : null;
    if (!alertId) return page(400, "This unsubscribe link is invalid or has expired.");

    const db = serviceClient();
    const { data: alert } = await db.from("price_alerts").select("*").eq("id", alertId).maybeSingle();
    if (!alert) return page(404, "That alert no longer exists — you're already unsubscribed.");

    // Mail clients and link scanners prefetch GET links; a GET must not change state.
    if (req.method === "GET") {
      const what = channel === "email" ? "email" : channel === "whatsapp" ? "WhatsApp" : "all";
      return page(200, `Stop ${what} notifications for <b>${escapeHtml(alert.product_name || alert.product_id)}</b>?`,
        `<form method="post" style="margin-top:14px"><button type="submit" style="padding:10px 18px;border-radius:10px;border:0;background:#FFB454;color:#07090F;font-weight:700;cursor:pointer">Yes, unsubscribe</button></form>`);
    }
    if (req.method !== "POST") return fail(405, "method_not_allowed", "Use GET to confirm or POST to unsubscribe.");

    const patch: Record<string, unknown> = {};
    if (channel === "email") patch.email_enabled = false;
    else if (channel === "whatsapp") patch.whatsapp_enabled = false;
    else { patch.email_enabled = false; patch.whatsapp_enabled = false; }

    const stillOn = (channel === "email" ? alert.whatsapp_enabled : channel === "whatsapp" ? alert.email_enabled : false);
    if (!stillOn) patch.status = "cancelled";

    await db.from("price_alerts").update(patch).eq("id", alertId);
    log("unsubscribed", { id: alertId, channel });

    const wantsHtml = /text\/html/i.test(req.headers.get("accept") ?? "") || /form-urlencoded/i.test(req.headers.get("content-type") ?? "");
    if (wantsHtml) return page(200, "You've been unsubscribed. You won't receive further notifications for this alert.");
    return json({ ok: true });
  } catch (e) {
    log("unsub_error", { message: String((e as Error).message ?? e) });
    return fail(500, "server_error", "Something went wrong.");
  }
});

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function page(status: number, message: string, extra = ""): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ToolDeck price alerts</title>
  <body style="margin:0;font-family:Inter,Arial,sans-serif;background:#07090F;color:#EAEEF7;display:grid;place-items:center;min-height:100vh">
    <div style="max-width:440px;padding:28px;border:1px solid #20293E;border-radius:16px;background:#101625;text-align:center">
      <div style="font-weight:700;color:#FFB454;margin-bottom:8px">ToolDeck BLR · Price Alerts</div>
      <p style="color:#95A1B8;line-height:1.6">${message}</p>${extra}
    </div>
  </body>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
}
