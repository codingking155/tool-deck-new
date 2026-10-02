import { preflight, json, fail, log } from "../_shared/http.ts";
import { serviceClient, env, requireEnv } from "../_shared/supabase.ts";
import { getEmailProvider, getWhatsappProvider } from "../_shared/providers.ts";
import { supabaseRepo } from "../_shared/priceRepo.ts";
import { processAlert } from "../../../shared/priceAlertsCore/processAlert.mjs";
import { productLink, unsubscribeLink } from "../../../shared/priceAlertsCore/links.mjs";
import { makeManageToken } from "../../../shared/priceAlertsCore/tokens.mjs";
import { providerConfig, isConfigured } from "../../../shared/priceTrackerCore/provider.mjs";
import {
  refreshProducts, importMissingHistory, identify, alertPrice, defaultIntervals,
} from "../../../shared/priceTrackerCore/tracker.mjs";

// Scheduled job (pg_cron → every 5 min). Protected by CRON_SECRET.
//   1. Refresh live prices for due tracked products (real provider readings only).
//   2. Evaluate due alerts against those real readings. An alert with no fresh
//      real price is left untouched — it is never evaluated against a guess.
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;

  // Fail CLOSED: with no CRON_SECRET configured nobody can trigger the job.
  const secret = env("CRON_SECRET");
  if (!secret) { log("check_misconfigured", { reason: "CRON_SECRET unset" }); return fail(503, "not_configured", "CRON_SECRET is not set."); }
  if (req.headers.get("x-cron-secret") !== secret) {
    return fail(401, "unauthorized", "Invalid cron secret.");
  }

  try {
    const body = await req.json().catch(() => ({}));
    const batch = Math.min(Number(body.batch ?? 100), 500);
    const productBatch = Math.min(Number(body.productBatch ?? 50), 200);
    const db = serviceClient();
    const repo = supabaseRepo(db);
    const getEnv = (k: string) => Deno.env.get(k) ?? "";
    const cfg = providerConfig(getEnv);
    const intervals = defaultIntervals(getEnv);

    // ── 1. product refresh ────────────────────────────────────────────────
    const { data: due, error: claimProductsErr } = await db.rpc("claim_due_products", { p_batch: productBatch });
    if (claimProductsErr) { log("claim_products_error", { message: claimProductsErr.message }); return fail(500, "server_error", "Claim failed."); }
    let refreshed = 0, refreshFailed = 0;
    if (due?.length) {
      const { data: watched } = await db.from("price_alerts").select("tracked_product_id")
        .in("tracked_product_id", due.map((p: any) => p.id)).eq("status", "active");
      const watchedIds = new Set((watched ?? []).map((w: any) => w.tracked_product_id));
      const intervalMsFor = (p: any) => (watchedIds.has(p.id) ? intervals.alertCheckMs : intervals.checkMs);

      const checkable = due.filter((p: any) => isConfigured(cfg, p.marketplace));
      for (const p of due.filter((p: any) => !isConfigured(cfg, p.marketplace))) {
        await repo.updateProduct(p.id, {
          last_checked_at: new Date().toISOString(), last_check_status: "error",
          last_error: "No live price provider is configured.", next_check_at: new Date(Date.now() + intervals.retryMs).toISOString(),
        });
        refreshFailed++;
      }
      const results = await refreshProducts(checkable, { repo, cfg, fetchImpl: fetch, intervalMsFor });
      for (const r of results.values()) r.ok ? refreshed++ : refreshFailed++;
      await importMissingHistory(checkable, { repo, cfg, fetchImpl: fetch });
    }

    // ── 2. alert evaluation ───────────────────────────────────────────────
    const { data: claimed, error } = await db.rpc("claim_due_alerts", { p_batch: batch });
    if (error) { log("claim_error", { message: error.message }); return fail(500, "server_error", "Claim failed."); }

    const providers = { email: getEmailProvider(), whatsapp: getWhatsappProvider() };
    const base = env("APP_BASE_URL", "https://tooldeck.in");
    const fnBase = env("FUNCTIONS_BASE", `${requireEnv("SUPABASE_URL")}/functions/v1`);
    const tokenSecret = requireEnv("ALERT_TOKEN_SECRET");

    const productCache = new Map<string, any>();
    const loadProduct = async (id: string) => {
      if (!productCache.has(id)) {
        const { data } = await db.from("tracked_products").select("*").eq("id", id).maybeSingle();
        productCache.set(id, data);
      }
      return productCache.get(id);
    };

    let processed = 0, triggered = 0, failedDeliveries = 0, skippedNoPrice = 0, linked = 0, paused = 0, errored = 0;

    // One alert's failure (e.g. a short-link host timing out) must not abort the
    // run: the rest of the claimed batch would sit leased and unchecked.
    for (const alert of claimed ?? []) try {
      // Alerts created before real prices existed have no product link yet:
      // resolve their stored URL to the real product, or pause with a reason.
      if (!alert.tracked_product_id) {
        const id = await identify(alert.product_url || alert.product_id, { cfg, fetchImpl: fetch });
        if (!id.ok) {
          await db.from("price_alerts").update({
            status: "paused",
            last_error: `Paused: this alert's product link can't be tracked with live prices (${id.message}). Create the alert again from the Price Tracker.`,
          }).eq("id", alert.id);
          paused++;
          continue;
        }
        const product = await repo.findProduct(id.marketplace, id.asin)
          || await repo.createProduct({ marketplace: id.marketplace, external_id: id.asin, canonical_url: id.canonicalUrl });
        await db.from("price_alerts").update({ tracked_product_id: product.id }).eq("id", alert.id);
        alert.tracked_product_id = product.id;
        productCache.set(product.id, product);
        linked++;
      }

      const product = await loadProduct(alert.tracked_product_id);
      // A target set in one currency can't be compared with a price in another.
      if (product?.currency && alert.currency && product.currency !== alert.currency) {
        await db.from("price_alerts").update({
          status: "paused",
          last_error: `Paused: this product is priced in ${product.currency}, but the alert's target is in ${alert.currency}. Create the alert again from the Price Tracker.`,
        }).eq("id", alert.id);
        paused++;
        continue;
      }
      const price = alertPrice(product);
      if (price == null) skippedNoPrice++;

      const tok = await makeManageToken(alert.id, tokenSecret);
      const deps = {
        getCurrentPrice: () => price,
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
    } catch (e) {
      errored++;
      log("alert_error", { id: alert.id, message: String((e as Error).message ?? e) });
    }

    const summary = { refreshed, refreshFailed, processed, triggered, failedDeliveries, skippedNoPrice, linked, paused, errored };
    log("check_run", summary);
    return json(summary);
  } catch (e) {
    log("check_error", { message: String((e as Error).message ?? e) });
    return fail(500, "server_error", "Check job failed.");
  }
});
