import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn("[v0] Supabase env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) are not set.");
}

// Singleton browser client — import this wherever you need Supabase on the frontend.
export const supabase = createClient(url ?? "", anonKey ?? "", {
  auth: { persistSession: true, autoRefreshToken: true },
});
