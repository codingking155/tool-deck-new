/* shared/ modules also run in Supabase Edge Functions; they only touch Deno behind a typeof guard. */
declare const Deno: any;
