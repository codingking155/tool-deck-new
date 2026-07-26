// Thin client for the price-alert Edge Functions.
// functionsBase defaults to `${VITE_SUPABASE_URL}/functions/v1`.
// getToken() should return the signed-in customer's Supabase access token (or null).

export function createAlertsApi({ functionsBase, getToken } = {}) {
  const base =
    functionsBase ||
    (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SUPABASE_URL
      ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
      : "/functions/v1");

  async function call(path, { method = "GET", body, manageToken } = {}) {
    const headers = { "Content-Type": "application/json" };
    const token = getToken ? await getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (manageToken) headers["x-manage-token"] = manageToken;

    const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data.error && data.error.message) || "Request failed");
      err.code = data.error && data.error.code;
      err.fields = data.error && data.error.fields;
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
