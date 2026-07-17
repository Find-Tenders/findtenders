import { supabaseAdmin } from './supabaseAdmin.mjs';

// Every scraper calls this first so the admin Sources tab always has a
// row to show, even before that source has ever run successfully.
export async function getOrCreateSource({ name, category, frequencyLabel, cronSchedule }) {
  const { data: existing, error: selectError } = await supabaseAdmin
    .from('sources')
    .select('*')
    .eq('name', name)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from('sources')
    .insert({
      name,
      category,
      frequency_label: frequencyLabel,
      cron_schedule: cronSchedule,
      enabled: true,
      state: 'off',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markSourceResult(sourceId, { ok, message }) {
  await supabaseAdmin
    .from('sources')
    .update({
      last_check_at: new Date().toISOString(),
      last_result: message,
      state: ok ? 'active' : 'error',
    })
    .eq('id', sourceId);
}

// ignoreDuplicates means re-running the scraper (or overlap between
// sources) never overwrites a tender an admin has already hand-edited.
export async function upsertTenders(rows) {
  if (!rows.length) return { inserted: 0 };
  const { data, error } = await supabaseAdmin
    .from('tenders')
    .upsert(rows, { onConflict: 'fingerprint', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  return { inserted: data?.length ?? 0 };
}
