import { preflight, json, fail, log } from "../_shared/http.ts";
import { serviceClient, userFromRequest, env, requireEnv } from "../_shared/supabase.ts";
import { rateLimit, clientIp } from "../_shared/ratelimit.ts";
import { validateAlertInput } from "../../../shared/priceAlertsCore/validation.mjs";
import { makeManageToken, verifyManageToken } from "../../../shared/priceAlertsCore/tokens.mjs";

const TOKEN_SECRET = () => requireEnv("ALERT_TOKEN_SECRET");

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const action = url.searchParams.get("action");
    const token = url.searchParams.get("token") ?? req.headers.get("x-manage-token") ?? "";

    const user = await userFromRequest(req);
    const db = serviceClient();

    // Resolve the alert id the token grants access to (if any).
    const tokenAlertId = token ? await verifyManageToken(token, TOKEN_SECRET()) : null;

    if (req.method === "POST" && !action) return await create(req, db, user);
    if (req.method === "GET") return await read(db, user, id, tokenAlertId);
    if (req.method === "PATCH") return await update(req, db, user, id, tokenAlertId);
    if (req.method === "POST" && action) return await pauseResume(db, user, id, tokenAlertId, action);
    if (req.method === "DELETE") return await remove(db, user, id, tokenAlertId);

    return fail(405, "method_not_allowed", "Unsupported method.");
  } catch (e) {
    log("price_alerts_error", { message: String((e as Error).message ?? e) });
    return fail(500, "server_error", "Something went wrong. Please try again.");
  }
});

async function create(req: Request, db: any, user: { id: string; email?: string } | null) {
  const rl = rateLimit(`create:${clientIp(req)}`);
  if (!rl.ok) return fail(429, "rate_limited", "Too many requests. Please wait and try again.");

  const body = await req.json().catch(() => null);
  if (!body || !body.productId) return fail(400, "bad_request", "Missing product.");

  // Signed-in: fill contact from the account when the customer left it blank.
  let email = body.email, phone = body.phone;
  if (user) {
    if (!email) email = user.email;
    if (!phone) {
      const { data: profile } = await db.from("profiles").select("phone").eq("id", user.id).maybeSingle();
      if (profile?.phone) phone = profile.phone;
    }
  }

  const v = validateAlertInput({ ...body, email, phone }, { signedIn: !!user });
  if (!v.ok) return json({ error: { code: "validation", message: "Please fix the highlighted fields.", fields: v.errors } }, 422);

  const row = {
    product_id: v.value.productId, product_name: v.value.productName,
    product_image: v.value.productImage, product_url: v.value.productUrl,
    user_id: user?.id ?? null,
    email: v.value.email, phone: v.value.phone,
    target_price: v.value.targetPrice, currency: v.value.currency, original_price: v.value.originalPrice,
    email_enabled: v.value.emailEnabled, whatsapp_enabled: v.value.whatsappEnabled,
    consent_at: new Date().toISOString(), status: "active",
  };

  const { data, error } = await db.from("price_alerts").insert(row).select().single();
  if (error) {
    if (String(error.code) === "23505")
      return fail(409, "duplicate", "You already have an active alert for this product at that price.");
    log("insert_error", { code: error.code, message: error.message });
    return fail(500, "server_error", "Could not create the alert.");
  }

  const manageToken = await makeManageToken(data.id, TOKEN_SECRET());
  log("alert_created", { id: data.id, guest: !user });
  // Return the management token so guests (and unsubscribe links) can manage later.
  return json({ alert: present(data), manageToken }, 201);
}

async function read(db: any, user: any, id: string | null, tokenAlertId: string | null) {
  if (tokenAlertId) {
    const { data } = await db.from("price_alerts").select("*").eq("id", tokenAlertId).maybeSingle();
    return data ? json({ alert: present(data) }) : fail(404, "not_found", "Alert not found.");
  }
  if (!user) return fail(401, "unauthorized", "Sign in or use your management link.");
  if (id) {
    const { data } = await db.from("price_alerts").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
    return data ? json({ alert: present(data) }) : fail(404, "not_found", "Alert not found.");
  }
  const { data } = await db.from("price_alerts").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  return json({ alerts: (data ?? []).map(present) });
}

async function loadAuthorized(db: any, user: any, id: string | null, tokenAlertId: string | null) {
  const targetId = id ?? tokenAlertId;
  if (!targetId) return { error: fail(400, "bad_request", "Missing alert id.") };
  const { data } = await db.from("price_alerts").select("*").eq("id", targetId).maybeSingle();
  if (!data) return { error: fail(404, "not_found", "Alert not found.") };
  const owns = (user && data.user_id === user.id) || (tokenAlertId && tokenAlertId === data.id);
  if (!owns) return { error: fail(403, "forbidden", "You don't have access to this alert.") };
  return { alert: data };
}

async function update(req: Request, db: any, user: any, id: string | null, tokenAlertId: string | null) {
  const found = await loadAuthorized(db, user, id, tokenAlertId);
  if (found.error) return found.error;
  const alert = found.alert;

  const body = await req.json().catch(() => ({}));
  const merged = {
    productId: alert.product_id,
    targetPrice: body.targetPrice ?? alert.target_price,
    email: body.email ?? alert.email,
    phone: body.phone ?? alert.phone,
    emailEnabled: body.emailEnabled ?? alert.email_enabled,
    whatsappEnabled: body.whatsappEnabled ?? alert.whatsapp_enabled,
    consent: true, currency: alert.currency,
  };
  const v = validateAlertInput(merged, { signedIn: !!user });
  if (!v.ok) return json({ error: { code: "validation", message: "Please fix the highlighted fields.", fields: v.errors } }, 422);

  // If price target or channels changed, re-arm the alert so it can fire again.
  const rearm = Number(v.value.targetPrice) !== Number(alert.target_price)
    || v.value.emailEnabled !== alert.email_enabled
    || v.value.whatsappEnabled !== alert.whatsapp_enabled;

  const patch: Record<string, unknown> = {
    target_price: v.value.targetPrice, email: v.value.email, phone: v.value.phone,
    email_enabled: v.value.emailEnabled, whatsapp_enabled: v.value.whatsappEnabled,
  };
  if (rearm && alert.status === "triggered") {
    patch.status = "active"; patch.triggered_at = null; patch.attempts = 0;
    patch.notification_status = { email: "pending", whatsapp: "pending" };
    patch.next_check_at = new Date().toISOString();
  }

  const { data, error } = await db.from("price_alerts").update(patch).eq("id", alert.id).select().single();
  if (error) {
    if (String(error.code) === "23505") return fail(409, "duplicate", "That change would duplicate an existing active alert.");
    return fail(500, "server_error", "Could not update the alert.");
  }
  return json({ alert: present(data) });
}

async function pauseResume(db: any, user: any, id: string | null, tokenAlertId: string | null, action: string) {
  const found = await loadAuthorized(db, user, id, tokenAlertId);
  if (found.error) return found.error;
  const status = action === "pause" ? "paused" : action === "reactivate" ? "active" : null;
  if (!status) return fail(400, "bad_request", "Unknown action.");
  const patch: Record<string, unknown> = { status };
  if (status === "active") { patch.attempts = 0; patch.next_check_at = new Date().toISOString(); }
  const { data, error } = await db.from("price_alerts").update(patch).eq("id", found.alert.id).select().single();
  if (error) return fail(500, "server_error", "Could not change the alert.");
  return json({ alert: present(data) });
}

async function remove(db: any, user: any, id: string | null, tokenAlertId: string | null) {
  const found = await loadAuthorized(db, user, id, tokenAlertId);
  if (found.error) return found.error;
  const { error } = await db.from("price_alerts").delete().eq("id", found.alert.id);
  if (error) return fail(500, "server_error", "Could not delete the alert.");
  return json({ ok: true });
}

// Shape a row for the client (no secrets are stored, so this is mostly passthrough).
function present(a: any) {
  return {
    id: a.id, productId: a.product_id, productName: a.product_name, productImage: a.product_image,
    productUrl: a.product_url, targetPrice: Number(a.target_price), currency: a.currency,
    originalPrice: a.original_price != null ? Number(a.original_price) : null,
    email: a.email, phone: a.phone, emailEnabled: a.email_enabled, whatsappEnabled: a.whatsapp_enabled,
    status: a.status, notificationStatus: a.notification_status, attempts: a.attempts,
    triggeredAt: a.triggered_at, lastCheckedAt: a.last_checked_at,
    createdAt: a.created_at, updatedAt: a.updated_at,
  };
}
