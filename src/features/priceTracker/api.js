// Client for the `price-tracker` Edge Function. Provider keys never reach the
// browser — this only sends the pasted link and receives real observations.

export const UNAVAILABLE = "Unable to retrieve the latest price right now.";

export async function lookupPrice(url, { signal } = {}) {
  const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
  const base = env.VITE_SUPABASE_URL ? `${env.VITE_SUPABASE_URL}/functions/v1` : null;
  if (!base) {
    const err = new Error(UNAVAILABLE);
    err.code = "not_configured";
    err.detail = "The price service isn't connected on this deployment.";
    throw err;
  }
  const headers = { "Content-Type": "application/json" };
  if (env.VITE_SUPABASE_ANON_KEY) {
    headers.apikey = env.VITE_SUPABASE_ANON_KEY;
    headers.Authorization = `Bearer ${env.VITE_SUPABASE_ANON_KEY}`;
  }
  let res;
  try {
    res = await fetch(`${base}/price-tracker`, { method: "POST", headers, body: JSON.stringify({ url }), signal });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    const err = new Error(UNAVAILABLE);
    err.code = "network";
    err.detail = "The price service couldn't be reached. Check your connection and try again.";
    throw err;
  }
  const data = /json/i.test(res.headers.get("content-type") || "") ? await res.json().catch(() => null) : null;
  if (!res.ok || !data?.product) {
    const err = new Error(data?.error?.message || UNAVAILABLE);
    err.code = data?.error?.code || `http_${res.status}`;
    err.status = res.status;
    throw err;
  }
  return data.product;
}
