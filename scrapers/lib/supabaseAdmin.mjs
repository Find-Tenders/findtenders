import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

// service_role bypasses Row Level Security entirely — this key must only
// ever live in GitHub Actions secrets, never in the public/ folder.
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
