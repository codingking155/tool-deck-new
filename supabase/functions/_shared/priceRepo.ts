// Supabase implementation of the tracker `repo` (see shared/priceTrackerCore/tracker.mjs).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAGE = 1000;              // PostgREST's default max rows per request
const MAX_OBSERVATIONS = 20000; // ~5 years of hourly-changing prices; far above normal

export function supabaseRepo(db: SupabaseClient) {
  async function findProduct(marketplace: string, externalId: string) {
    const { data, error } = await db.from("tracked_products").select("*")
      .eq("marketplace", marketplace).eq("external_id", externalId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function createProduct(row: { marketplace: string; external_id: string; canonical_url: string }) {
    // Concurrent first lookups of the same product race here; the unique
    // (marketplace, external_id) constraint makes the loser a no-op.
    const { error } = await db.from("tracked_products")
      .upsert(row, { onConflict: "marketplace,external_id", ignoreDuplicates: true });
    if (error) throw error;
    return findProduct(row.marketplace, row.external_id);
  }

  async function updateProduct(id: string, patch: Record<string, unknown>) {
    const { data, error } = await db.from("tracked_products").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  async function latestObservation(productId: string) {
    const { data, error } = await db.from("price_observations").select("*")
      .eq("product_id", productId).order("observed_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function insertObservations(rows: Record<string, unknown>[]) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("price_observations")
        .upsert(rows.slice(i, i + 500), { onConflict: "product_id,observed_at,source", ignoreDuplicates: true });
      if (error) throw error;
    }
  }

  async function listObservations(productId: string, sinceIso: string | null) {
    const out: any[] = [];
    for (let from = 0; from < MAX_OBSERVATIONS; from += PAGE) {
      let q = db.from("price_observations")
        .select("price, original_price, currency, availability, seller, observed_at, source")
        .eq("product_id", productId).order("observed_at", { ascending: true }).range(from, from + PAGE - 1);
      if (sinceIso) q = q.gte("observed_at", sinceIso);
      const { data, error } = await q;
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  return { findProduct, createProduct, updateProduct, latestObservation, insertObservations, listObservations };
}
