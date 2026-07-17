// Supabase project connection info.
//
// The values below are NOT secret — the "anon/publishable" key is designed
// by Supabase to be embedded in client-side code; it only grants whatever
// access the database's Row Level Security policies allow (see
// supabase/migrations/0001_init.sql). The real secrets — the service_role
// key, Stripe secret key, and any email-sending API key — are never put in
// this folder; those live in Netlify/GitHub Actions/Supabase environment
// variables instead.
export const SUPABASE_URL = "https://zlllygfbqbqwpdcqrpgt.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_atTiJVdj-eGBe9UYBuTMjg_uB6Ra6Wc";
