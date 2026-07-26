import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function env(key: string, fallback = ""): string {
  return Deno.env.get(key) ?? fallback;
}
export function requireEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}

// Full-access client for background work and guest flows (bypasses RLS).
export function serviceClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Client scoped to the caller's JWT, so RLS applies. Returns null if unauthenticated.
export async function userFromRequest(req: Request): Promise<{ id: string; email?: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}
