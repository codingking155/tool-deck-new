import { preflight, json, fail, log } from "../_shared/http.ts";
import { serviceClient, env, requireEnv } from "../_shared/supabase.ts";
import { getEmailProvider, getWhatsappProvider } from "../_shared/providers.ts";
import { processAlert } from "../../../shared/priceAlertsCore/processAlert.mjs";
import { currentPrice } from "../../../shared/priceAlertsCore/pricing.mjs";
import { productLink, unsubscribeLink } from "../../../shared/priceAlertsCore/links.mjs";
import { makeManageToken } from "../../../shared/priceAlertsCore/tokens.mjs";

// Invoked on a timer (pg_cron) or manually. Protected by CRON_SECRET.
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;

  const secret = env("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return fail(401, "unauthorized", "Invalid cron secret.");
  }

  try {
    const body = await req.json().catch(() => ({}));
    const batch = Math.min(Number(body.batch ?? 100), 500);
    const db = serviceClient();

    // Atomically claim a batch of due alerts (skips rows locked by a concurrent run).
    const { data: claimed, error } = await db.rpc("claim_due_alerts", { p_batch: batch });
    if (error) { log("claim_error", { message: error.message }); return fail(500, "server_error", "Claim failed."); }

    const providers = { email: getEmailProvider(), whatsapp: getWhatsappProvider() };
    const base = env("APP_BASE_URL", "https://tooldeck.in");
    const fnBase = env("FUNCTIONS_BASE", `${requireEnv("SUPABASE_URL")}/functions/v1`);
    const tokenSecret = requireEnv("ALERT_TOKEN_SECRET");

    let processed = 0, triggered = 0, failedDeliveries = 0;

    for (const alert of claimed ?? []) {
      const tok = await makeManageToken(alert.id, tokenSecret);
      const deps = {
        getCurrentPrice: (a: any) => currentPrice(a.product_id, Date.now()),
        providers,
        productLink: (a: any) => productLink(base, a),
        unsubscribeLink: () => unsubscribeLink(fnBase, tok, "all"),
        now: Date.now(),
      };

      const { patch, deliveries } = await processAlert(alert, deps);

      // Persist result. next_check_at in the patch overrides the lease set at claim.
      const { error: upErr } = await db.from("price_alerts").update(patch).eq("id", alert.id);
      if (upErr) log("update_error", { id: alert.id, message: upErr.message });

      if (deliveries.length) {
        await db.from("price_alert_deliveries").insert(deliveries.map((d: any) => ({ ...d, alert_id: alert.id })));
        failedDeliveries += deliveries.filter((d: any) => d.status === "failed").length;
      }
      if (patch.status === "triggered") triggered++;
      processed++;
    }

    log("check_run", { processed, triggered, failedDeliveries });
    return json({ processed, triggered, failedDeliveries });
  } catch (e) {
    log("check_error", { message: String((e as Error).message ?? e) });
    return fail(500, "server_error", "Check job failed.");
  }
});
