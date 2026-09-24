// Thin client for the price-alert Edge Functions.
// functionsBase defaults to `${VITE_SUPABASE_URL}/functions/v1`.
// getToken() should return the signed-in customer's Supabase access token (or null).

export function createAlertsApi({ functionsBase, getToken } = {}) {
  const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
  const base = functionsBase || (env.VITE_SUPABASE_URL ? `${env.VITE_SUPABASE_URL}/functions/v1` : null);
  const anonKey = env.VITE_SUPABASE_ANON_KEY || "";

  async function call(path, { method = "GET", body, manageToken } = {}) {
    if (!base) {
      const err = new Error("Price alerts aren't configured on this deployment (VITE_SUPABASE_URL is not set).");
      err.code = "not_configured"; err.status = 0;
      throw err;
    }
    const headers = { "Content-Type": "application/json" };
    const token = getToken ? await getToken() : null;
    /* Supabase's gateway verifies a JWT on every function call; guests use the anon key. */
    if (anonKey) headers.apikey = anonKey;
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (anonKey) headers.Authorization = `Bearer ${anonKey}`;
    if (manageToken) headers["x-manage-token"] = manageToken;

    const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const ctype = res.headers.get("content-type") || "";
    const data = /json/i.test(ctype) ? await res.json().catch(() => null) : null;
    if (!res.ok || data == null) {
      /* an HTML page (SPA rewrite) or non-JSON body is never a success */
      const err = new Error((data && data.error && data.error.message) || (data == null ? "The alerts API did not answer (is the backend deployed?)" : "Request failed"));
      err.code = data && data.error && data.error.code;
      err.fields = data && data.error && data.error.fields;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    create: (input) => call("/price-alerts", { method: "POST", body: input }),
    list: () => call("/price-alerts"),
    getByToken: (manageToken) => call(`/price-alerts?token=${encodeURIComponent(manageToken)}`),
    get: (id) => call(`/price-alerts?id=${encodeURIComponent(id)}`),
    update: (id, input, manageToken) =>
      call(`/price-alerts?id=${encodeURIComponent(id)}`, { method: "PATCH", body: input, manageToken }),
    pause: (id, manageToken) =>
      call(`/price-alerts?id=${encodeURIComponent(id)}&action=pause`, { method: "POST", manageToken }),
    reactivate: (id, manageToken) =>
      call(`/price-alerts?id=${encodeURIComponent(id)}&action=reactivate`, { method: "POST", manageToken }),
    remove: (id, manageToken) =>
      call(`/price-alerts?id=${encodeURIComponent(id)}`, { method: "DELETE", manageToken }),
  };
}
