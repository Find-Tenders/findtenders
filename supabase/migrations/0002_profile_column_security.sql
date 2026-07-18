-- Row Level Security restricts which ROWS a user can touch, not which
-- COLUMNS. As migration 0001 left it, "profiles update own" would let a
-- signed-in user set their own plan/role/searches_used directly via a
-- plain PATCH request — completely bypassing payment review. Lock the
-- sensitive columns down at the Postgres privilege level so only the
-- SECURITY DEFINER RPCs (which run with the function owner's privileges,
-- not the caller's) can change them.

revoke update on profiles from authenticated;
grant update (full_name, selected_sectors, notify_email) on profiles to authenticated;

-- Admin suspend/activate now goes through an RPC instead of a raw column
-- update, since account_status is no longer directly writable by anyone.
create or replace function admin_set_account_status(target_user uuid, new_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if new_status not in ('active', 'suspended') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  update profiles set account_status = new_status where id = target_user;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function admin_set_account_status(uuid, text) to authenticated;

-- ============================================================
-- STORAGE — payment receipt uploads for the wallet upgrade flow
-- ============================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Files are stored at "{user_id}/{filename}" so ownership is just the
-- first path segment — a user can upload/read their own, admins can read all.
create policy "receipts insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "receipts select own or admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
